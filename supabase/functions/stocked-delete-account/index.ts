// Current account system only; do not reuse the legacy delete-account function.
// Auth deletion triggers transactional cleanup from account-deletion.sql.
const headers={
  'Content-Type':'application/json','Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
};
const response=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(req.method!=='POST')return response({error:'POST required.'},405);
  const url=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_ANON_KEY'),service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if(!url||!key||!service)return response({error:'Account deletion is not configured.'},503);
  const authorization=req.headers.get('Authorization')||'';
  if(!/^Bearer /i.test(authorization))return response({error:'Sign in again.'},401);
  try{
    const body=await req.json();
    if(body.confirm!=='DELETE')return response({error:'Confirm account deletion.'},400);
    const userResponse=await fetch(url+'/auth/v1/user',{headers:{Authorization:authorization,apikey:key}});
    if(!userResponse.ok)return response({error:'Sign in again.'},401);
    const user=await userResponse.json();
    // JWT is verified above by Auth; only then inspect its authentication time.
    const segment=authorization.slice(7).split('.')[1].replace(/-/g,'+').replace(/_/g,'/');
    const claims=JSON.parse(atob(segment));
    const fresh=(claims.amr||[]).some((x:{method:string;timestamp:number})=>x.method==='password'&&x.timestamp>Date.now()/1000-300);
    if(!fresh)return response({error:'Re-enter your password before deleting your account.'},403);
    if((user.factors||[]).some((f:{status:string})=>f.status==='verified')&&claims.aal!=='aal2')
      return response({error:'Complete two-step verification first.'},403);
    const membership=await fetch(url+'/rest/v1/rpc/stocked_account_home',{
      method:'POST',headers:{Authorization:authorization,apikey:key,'Content-Type':'application/json'},body:'{}',
    });
    if(!membership.ok)return response({error:'Could not verify your household. Try again.'},403);
    const home=await membership.json();
    if(home?.role==='owner'&&home.members.length>1)return response({error:'Transfer household ownership before deleting your account.'},409);
    // Never accept a target user ID from the client.
    const deleted=await fetch(url+'/auth/v1/admin/users/'+encodeURIComponent(user.id),{
      method:'DELETE',headers:{Authorization:'Bearer '+service,apikey:service},
    });
    if(!deleted.ok)return response({error:'Deletion did not finish. Your account may still exist. Check household ownership and try again.'},502);
    return response({ok:true});
  }catch{return response({error:'Could not finish account deletion. Try again.'},502);}
});
