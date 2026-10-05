/* Opt-in staging test. Uses two disposable, confirmed @example.test accounts.
   No service-role key. No real pantry or existing household is a fixture.
   Credentials come from environment and are never printed or saved. */
const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const base = process.env.STOCKED_TEST_URL;
const apiKey = process.env.STOCKED_TEST_KEY;
const people = ['OWNER','MEMBER'].map(role => ({
  email: process.env[`STOCKED_TEST_${role}_EMAIL`],
  password: process.env[`STOCKED_TEST_${role}_PASSWORD`],
}));
const results = [];
const check = (condition, name) => { assert.ok(condition, name); results.push(name); console.log('PASS '+name); };
async function request(route, user, body, method) {
  const response = await fetch(base+route, {
    method: method || (body === undefined ? 'GET' : 'POST'),
    headers: {apikey:apiKey, ...(user?{Authorization:'Bearer '+user.access_token}:{}), 'Content-Type':'application/json'},
    ...(body===undefined?{}:{body:JSON.stringify(body)}), signal:AbortSignal.timeout(20000),
  });
  const text = await response.text();
  let data; try { data=JSON.parse(text); } catch { data=text; }
  return {ok:response.ok,status:response.status,data};
}
async function rpc(user,name,body={}) {
  const r=await request('/rest/v1/rpc/'+name,user,body);
  if(!r.ok) throw new Error(`${name} failed (${r.status}): ${r.data?.message||r.data?.msg||'request rejected'}`);
  return r.data;
}
async function run() {
  assert.match(base||'',/^https:\/\/[a-z0-9]+\.supabase\.co$/);
  assert.match(apiKey||'',/^sb_publishable_/);
  for(const p of people) { assert.match(p.email||'',/^stocked-test-[a-z0-9-]+@example\.test$/); assert.ok(p.password?.length>=12); }
  const signed = await Promise.all(people.map(p=>request('/auth/v1/token?grant_type=password',null,p)));
  check(signed.every(x=>x.ok&&x.data.user?.email_confirmed_at),'hosted password authentication for two confirmed staging accounts');
  const [a,b]=signed.map(x=>x.data), uidA=a.user.id,uidB=b.user.id;
  const probe='hosted-'+randomUUID();
  let h=await rpc(a,'stocked_account_home');
  let other=await rpc(b,'stocked_account_home');
  if(h)assert.match(h.name,/^Stocked staging test /);
  if(other)assert.match(other.name,/^Stocked staging test /);
  const tables=['stocked_homes','stocked_members','stocked_invites','stocked_records','stocked_operations'];
  for(const table of tables) {
    const r=await request('/rest/v1/'+table+'?select=*',null);
    check(!r.ok,`anonymous REST denied for ${table}`);
  }
  check(!(await request('/rest/v1/rpc/stocked_account_home',null,{})).ok,'anonymous RPC denied');
  check((await rpc(a,'stocked_cloud_status')).inventorySync===true,'hosted schema reports sync available');
  if(other&&other.id===h?.id)await rpc(b,'stocked_remove_member',{member_id:uidB});
  else assert.equal(other,null,'Use a fresh test member without another household');
  const homes=await Promise.all([1,2].map(()=>rpc(a,'stocked_create_home',{home_name:'Stocked staging test '+probe,member_name:'Test owner'})));
  h=homes[0];check(h.id===homes[1].id,'parallel household creation is idempotent');
  const invite=await rpc(a,'stocked_create_invite');
  await rpc(b,'stocked_join_home',{invite_token:invite.token,member_name:'Test member'});
  check((await rpc(b,'stocked_account_home')).id===h.id,'real accounts join the same household');
  const write=(user,kind,target,key,qty,version=0,op=randomUUID())=>rpc(user,'stocked_kitchen_write',{
    kind,target,bucket:'items',key,payload:{id:key,name:'Synthetic test food',qty},base_version:version,remove_record:false,op,
  });
  await write(a,'personal',uidA,probe+'-private',1);
  await write(b,'personal',uidB,probe+'-private',2);
  check(!(await request('/rest/v1/rpc/stocked_kitchen_read',a,{kind:'personal',target:uidB})).ok,'household owner cannot read member private kitchen');
  check(!(await request('/rest/v1/rpc/stocked_kitchen_read',b,{kind:'personal',target:uidA})).ok,'member cannot read owner private kitchen');
  const rows=await request('/rest/v1/stocked_records?select=scope_id&scope_type=eq.personal',a);
  check(rows.ok&&rows.data.every(x=>x.scope_id===uidA),'direct authenticated REST respects private isolation');
  const forbidden=await request('/rest/v1/stocked_records',a,{scope_type:'personal',scope_id:uidB,store:'items',record_id:probe,body:{id:probe},version:1,updated_by:uidA});
  check(!forbidden.ok,'direct table writes rejected');
  await write(a,'household',h.id,probe,1);
  check((await rpc(b,'stocked_kitchen_read',{kind:'household',target:h.id})).records.some(x=>x.record_id===probe&&x.body.qty===1),'member reads owner shared inventory');
  const simultaneous=await Promise.all([write(a,'household',h.id,probe,2,1),write(b,'household',h.id,probe,3,1)]);
  check(simultaneous.filter(x=>!x.conflict).length===1&&simultaneous.filter(x=>x.conflict).length===1,'parallel edits have exactly one winner and one recoverable conflict');
  const replay=randomUUID();
  const first=await write(a,'household',h.id,probe,4,2,replay);
  const second=await write(a,'household',h.id,probe,4,2,replay);
  check(JSON.stringify(first)===JSON.stringify(second)&&second.record.version===3,'lost-response retry does not duplicate a hosted write');
  await rpc(a,'stocked_remove_member',{member_id:uidB});
  check(!(await request('/rest/v1/rpc/stocked_kitchen_read',b,{kind:'household',target:h.id})).ok,'removing member revokes hosted reads with existing JWT');
  check(!(await request('/rest/v1/rpc/stocked_kitchen_write',b,{kind:'household',target:h.id,bucket:'items',key:probe,payload:{id:probe},base_version:3,remove_record:false,op:randomUUID()})).ok,'removing member revokes hosted writes with existing JWT');
  const newHome=await rpc(b,'stocked_create_home',{home_name:'Stocked staging test other '+probe,member_name:'Other owner'});
  check(!(await request('/rest/v1/rpc/stocked_kitchen_read',b,{kind:'household',target:h.id})).ok&&newHome.id!==h.id,'different households remain isolated');
  const own=await request('/rest/v1/stocked_homes?select=id',b);
  check(own.ok&&own.data.length===1&&own.data[0].id===newHome.id,'direct REST only returns current household');
  await browserChecks(a,b);
  const report={at:new Date().toISOString(),project:new URL(base).hostname,checks:results,fixtureUsers:[uidA,uidB],fixtureHomes:[h.id,newHome.id],limitations:['No SMTP delivery test','No physical phone or installed-PWA callback test']};
  const out=path.resolve(__dirname,'../../../outputs/kitchen-sync');fs.mkdirSync(out,{recursive:true});
  fs.writeFileSync(path.join(out,'hosted-verification.json'),JSON.stringify(report,null,2));
  console.log(`ALL ${results.length} HOSTED CHECKS PASS. Disposable fixture cleanup required.`);
}
async function browserChecks(a,b) {
  const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
  const root=path.resolve(__dirname,'..');
  const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webp':'image/webp'};
  const server=http.createServer((req,res)=>{
    const url=new URL(req.url,'http://local');
    if(url.pathname==='/cloud-config.js'){res.setHeader('Content-Type','text/javascript');return res.end('window.STOCKED_CLOUD_CONFIG='+JSON.stringify({enabled:true,supabaseUrl:base,publishableKey:apiKey}));}
    const file=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));
    if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){res.writeHead(404);return res.end();}
    res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(res);
  });
  let browser;
  try {
    await new Promise(r=>server.listen(0,'127.0.0.1',r));const local='http://127.0.0.1:'+server.address().port;
    browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
    const contexts=await Promise.all([1,2].map(()=>browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'})));
    const pages=await Promise.all(contexts.map(c=>c.newPage()));
    for(const page of pages) {
      await page.goto(local+'/account.html');
      await page.getByLabel('Email address').fill(people[0].email);await page.getByLabel('Password',{exact:true}).fill(people[0].password);
      await page.getByRole('button',{name:'Sign in',exact:true}).click();
      await page.getByRole('link',{name:'Open kitchens & sharing →'}).waitFor();
      await page.goto(local+'/?kitchen=personal');await page.waitForFunction(()=>window.CloudKitchen?.active);
    }
    check(true,'real account screen signs in through hosted Supabase on two browser devices');
    const key='browser-'+randomUUID();
    await pages[0].evaluate(async id=>{await DB.put('items',{id,name:'Browser test avocado',qty:2,loc:'pantry'});await CloudKitchen.active.sync();},key);
    await pages[1].reload();await pages[1].waitForFunction(()=>window.CloudKitchen?.active);
    check(await pages[1].evaluate(async id=>(await DB.get('items',id))?.qty===2,key),'fresh second browser loads hosted inventory');
    await contexts[0].setOffline(true);
    await pages[0].evaluate(async id=>{const x=await DB.get('items',id);x.qty=3;await DB.put('items',x);await CloudKitchen.active.sync();},key);
    check(await pages[0].evaluate(async()=> (await CloudKitchen.active.all('outbox')).length>0),'offline hosted-browser edit remains in durable outbox');
    await contexts[0].setOffline(false);await pages[0].evaluate(()=>CloudKitchen.active.sync());
    await pages[1].reload();await pages[1].waitForFunction(()=>window.CloudKitchen?.active);
    check(await pages[1].evaluate(async id=>(await DB.get('items',id))?.qty===3,key),'reconnection sends pending edit to real server and other device');
    check(await pages[0].evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'hosted kitchen fits a 390px phone viewport');
  } finally {await browser?.close();server.close();}
}
run().catch(e=>{console.error(e.message);process.exitCode=1;});
