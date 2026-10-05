// Execute the actual Edge Function handler with controlled Auth responses.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {stripTypeScriptTypes}=require('node:module');
let handler,deleted=[],scenario={};
const source=fs.readFileSync(require('node:path').join(__dirname,'../supabase/functions/stocked-delete-account/index.ts'),'utf8');
const json=(data,status=200)=>new Response(JSON.stringify(data),{status});
vm.runInNewContext(stripTypeScriptTypes(source),{
  Deno:{env:{get:n=>({SUPABASE_URL:'https://test.supabase.co',SUPABASE_ANON_KEY:'public',SUPABASE_SERVICE_ROLE_KEY:'server-only'}[n])},serve:f=>handler=f},
  Request,Response,Date,JSON,atob,encodeURIComponent,
  fetch:async(url,options)=>{
    if(url.endsWith('/auth/v1/user'))return scenario.invalid?json({},401):json({id:'verified-caller',factors:scenario.mfa?[{status:'verified'}]:[]});
    if(url.endsWith('/rpc/stocked_account_home'))return scenario.denied?json({},403):json(scenario.owner?{role:'owner',members:[{},{}]}:null);
    assert.ok(url.endsWith('/admin/users/verified-caller'),'only verified user may be deleted');
    deleted.push({url,method:options.method});return scenario.failDelete?json({},500):json({});
  },
});
const token=claims=>'header.'+Buffer.from(JSON.stringify(claims)).toString('base64url')+'.signature';
async function call(claims,body={confirm:'DELETE'},method='POST'){
  return handler(new Request('https://test/functions/v1/stocked-delete-account',{method,headers:{Authorization:'Bearer '+token(claims),'Content-Type':'application/json'},...(method==='POST'?{body:JSON.stringify(body)}:{})}));
}
(async()=>{
  const fresh={amr:[{method:'password',timestamp:Math.floor(Date.now()/1000)}],aal:'aal1'};
  assert.equal((await call(fresh,{},'OPTIONS')).status,204);
  assert.equal((await call(fresh,{},'GET')).status,405);
  assert.equal((await call(fresh,{})).status,400);
  scenario={invalid:true};assert.equal((await call(fresh)).status,401);
  scenario={};assert.equal((await call({amr:[]})).status,403);
  scenario={mfa:true};assert.equal((await call(fresh)).status,403);
  scenario={denied:true};assert.equal((await call(fresh)).status,403);
  scenario={owner:true};assert.equal((await call(fresh)).status,409);
  assert.equal(deleted.length,0,'denied requests never call deletion API');
  scenario={mfa:true};assert.equal((await call({...fresh,aal:'aal2'},{confirm:'DELETE',user_id:'victim'})).status,200);
  assert.equal(deleted.length,1,'valid request deletes only caller');
  scenario={failDelete:true};assert.equal((await call(fresh)).status,502);
  console.log('PASS actual deletion handler: confirmation, fresh password, verified identity, MFA, ownership, caller-only target, failure reporting and preflight');
})().catch(e=>{console.error(e);process.exitCode=1;});
