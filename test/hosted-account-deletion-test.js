/* Destructive only to the explicitly named disposable example.test accounts.
   Run after hosted tests; this is their cleanup through the actual app. */
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.STOCKED_TEST_URL,key=process.env.STOCKED_TEST_KEY;
const people=['OWNER','MEMBER'].map(x=>({email:process.env[`STOCKED_TEST_${x}_EMAIL`],password:process.env[`STOCKED_TEST_${x}_PASSWORD`]}));
const root=path.resolve(__dirname,'..'),results=[];
const check=(v,n)=>{assert.ok(v,n);results.push(n);console.log('PASS '+n);};
async function request(route,user,body){const r=await fetch(base+route,{method:'POST',headers:{apikey:key,'Content-Type':'application/json',...(user?{Authorization:'Bearer '+user.access_token}:{})},body:JSON.stringify(body)});return {status:r.status,ok:r.ok,data:await r.json()};}
async function rpc(u,n,b={}){const r=await request('/rest/v1/rpc/'+n,u,b);if(!r.ok)throw new Error(n+': '+r.data?.message);return r.data;}
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css'};
const server=http.createServer((req,res)=>{
  const u=new URL(req.url,'http://local');if(u.pathname==='/cloud-config.js'){res.setHeader('Content-Type','text/javascript');return res.end('window.STOCKED_CLOUD_CONFIG='+JSON.stringify({enabled:true,accountDeletion:true,supabaseUrl:base,publishableKey:key}));}
  const file=path.resolve(root,'.'+(u.pathname==='/'?'/index.html':u.pathname));if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){res.writeHead(404);return res.end();}
  res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(res);
});
(async()=>{
  for(const p of people)assert.match(p.email||'',/^stocked-test-[a-z0-9-]+@example\.test$/);
  assert.match(base||'',/^https:\/\/[a-z0-9]+\.supabase\.co$/);let browser;
  try{
    const sessions=await Promise.all(people.map(p=>request('/auth/v1/token?grant_type=password',null,p)));
    assert.ok(sessions.every(x=>x.ok));const [a,b]=sessions.map(x=>x.data);
    const home=await rpc(a,'stocked_account_home');assert.match(home.name,/^Stocked staging test /);
    assert.equal(await rpc(b,'stocked_account_home'),null,'Prepare member without a household');
    const invite=await rpc(a,'stocked_create_invite');await rpc(b,'stocked_join_home',{invite_token:invite.token,member_name:'Test member'});
    const record='deletion-'+randomUUID();await rpc(b,'stocked_kitchen_write',{kind:'household',target:home.id,bucket:'items',key:record,payload:{id:record,name:'Shared test apples',qty:2},base_version:0,remove_record:false,op:randomUUID()});
    const denied=await request('/functions/v1/stocked-delete-account',a,{confirm:'DELETE'});check(denied.status===409,'hosted function prevents owner deletion while members remain');
    const anonymous=await request('/functions/v1/stocked-delete-account',null,{confirm:'DELETE'});check(anonymous.status===401,'anonymous deletion rejected');
    await new Promise(r=>server.listen(0,'127.0.0.1',r));const local='http://127.0.0.1:'+server.address().port;
    browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
    async function deleteThroughApp(person){
      const c=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'}),p=await c.newPage();
      await p.goto(local+'/account.html');await p.getByLabel('Email address').fill(person.email);await p.getByLabel('Password',{exact:true}).fill(person.password);await p.getByRole('button',{name:'Sign in',exact:true}).click();
      await p.getByRole('button',{name:'Manage two-step verification'}).click();await p.getByRole('button',{name:'Delete my account',exact:true}).click();
      await p.getByLabel('Current password').fill(person.password);await p.getByLabel('Type DELETE to confirm').fill('DELETE');await p.getByRole('button',{name:'Permanently delete my account'}).click();
      await p.getByRole('heading',{name:'Account deleted.',exact:true}).waitFor();
      const out=path.resolve(__dirname,'../../../outputs/kitchen-sync');fs.mkdirSync(out,{recursive:true});await p.screenshot({path:path.join(out,'account-deleted-390.png'),fullPage:true});
      await c.close();
    }
    await deleteThroughApp(people[1]);check(true,'member can delete account through actual UI and hosted function');
    check(!(await request('/auth/v1/token?grant_type=password',null,people[1])).ok,'deleted member cannot sign in again');
    check(!(await request('/rest/v1/rpc/stocked_account_home',b,{})).ok,'previous member token cannot access household after deletion');
    const shared=(await rpc(a,'stocked_kitchen_read',{kind:'household',target:home.id})).records.find(x=>x.record_id===record);
    check(shared?.body.qty===2&&shared.updated_by===null,'member deletion preserves shared food and unlinks author');
    await deleteThroughApp(people[0]);check(true,'last owner can delete account and empty household through app');
    check(!(await request('/auth/v1/token?grant_type=password',null,people[0])).ok,'deleted owner cannot sign in again');
    const out=path.resolve(__dirname,'../../../outputs/kitchen-sync');fs.writeFileSync(path.join(out,'hosted-deletion-verification.json'),JSON.stringify({at:new Date().toISOString(),checks:results,deletedTestUsers:[a.user.id,b.user.id]},null,2));
    console.log(`ALL ${results.length} HOSTED DELETION CHECKS PASS`);
  }finally{await browser?.close();server.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
