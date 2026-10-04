/* Real app + IndexedDB + PostgreSQL RPCs. Only Supabase Auth transport is a
   synthetic fixture. These tests do NOT prove hosted email/token delivery. */
const http=require('http'),fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const ROOT=path.resolve(__dirname,'..'),OUT=path.resolve(ROOT,'../../outputs/kitchen-sync');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const db=new PGlite();let chain=Promise.resolve(),loseNextWrite=false,checks=0;
const eq=(a,b,label)=>{assert.deepEqual(a,b,label);checks++;console.log('PASS '+label);};
const rpcNames=new Set(['stocked_cloud_status','stocked_account_home','stocked_create_home','stocked_create_invite','stocked_join_home','stocked_remove_member','stocked_kitchen_read','stocked_kitchen_write']);
const sdk=`window.supabase={createClient:()=>({auth:{getUser:async()=>({data:{user:{id:window.__testUser,email:'person@example.test',user_metadata:{display_name:'Alex'}}}}),onAuthStateChange:cb=>{window.__authEvent=cb;return {data:{subscription:{unsubscribe(){}}}}}},rpc:async(name,args)=>{try{const r=await fetch('/test-rpc',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name,args,user:window.__testUser})});return await r.json();}catch(e){return {error:{message:e.message}};}}})};`;
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.webp':'image/webp','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://local');
  if(url.pathname==='/test-rpc'){
    let raw='';for await(const chunk of req)raw+=chunk;
    const body=JSON.parse(raw);chain=chain.then(async()=>{
      try{
        if(!rpcNames.has(body.name)||!/^00000000-0000-4000-8000-\d{12}$/.test(body.user))throw new Error('Invalid fixture call');
        await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[body.user]);await db.exec('set role authenticated');
        const entries=Object.entries(body.args||{});
        if(entries.some(([k])=>!/^[a-z_]+$/.test(k)))throw new Error('Invalid arg');
        const out=await db.query(`select public.${body.name}(${entries.map(([k],i)=>`"${k}"=>$${i+1}`).join(',')}) as result`,entries.map(([,v])=>typeof v==='object'?JSON.stringify(v):v));
        if(loseNextWrite&&body.name==='stocked_kitchen_write'){loseNextWrite=false;res.end(JSON.stringify({error:{message:'Simulated lost response after commit'}}));return;}
        res.end(JSON.stringify({data:out.rows[0].result}));
      }catch(e){res.end(JSON.stringify({error:{message:e.message,code:e.code}}));}
    });return;
  }
  if(url.pathname==='/cloud-config.js'){res.setHeader('Content-Type','text/javascript');return res.end(`window.STOCKED_CLOUD_CONFIG={enabled:true,supabaseUrl:'https://test.supabase.co',publishableKey:'sb_publishable_test'};`);}
  if(url.pathname==='/supabase.min.js'){res.setHeader('Content-Type','text/javascript');return res.end(sdk);}
  const file=path.resolve(ROOT,'.'+(url.pathname==='/'?'/index.html':url.pathname));
  if(!file.startsWith(ROOT+path.sep)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){res.writeHead(404);return res.end();}
  res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(res);
});
(async()=>{
  let browser;
  try{
    await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email_confirmed_at timestamptz);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
    for(let n=1;n<=3;n++)await db.query('insert into auth.users values($1,now())',[id(n)]);
    for(const name of ['accounts-foundation','kitchen-sync'])await db.exec(fs.readFileSync(path.join(ROOT,'supabase',name+'.sql'),'utf8'));
    await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
    browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
    const errors=[];
    const make=async n=>{const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});await context.addInitScript(user=>window.__testUser=user,id(n));const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());return {context,page};};
    const a=await make(1),b=await make(1),member=await make(2);
    await a.page.goto(base+'/?kitchen=local');await a.page.waitForFunction(()=>typeof DB!=='undefined'&&document.querySelector('#cloud-kitchen-bar'));
    await a.page.evaluate(async()=>{
      const layout={id:'household',locations:[{id:'fridge',name:'Kitchen fridge',kind:'fridge'}],members:[{name:'Alex'}],stores:[],staples:[],allergies:[],dislikes:[],people:2,aisleOrder:{}};
      await DB.put('meta',layout);await DB.put('items',{id:'device-only',name:'Device-only banana',qty:3,loc:'fridge',cat:'produce-banana'});
      await DB.put('saved',{id:'device-recipe',name:'My secret recipe',ingredients:[{name:'Banana',qty:1}],steps:['Mash banana']});
    });
    const original=await a.page.evaluate(async()=>{const out={};for(const s of CloudKitchen.stores)out[s]=await DB.all(s);return out;});
    await a.page.goto(base+'/?kitchen=personal');await a.page.waitForFunction(()=>window.CloudKitchen?.active);
    eq(await a.page.evaluate(()=>S.items.length),0,'signing into cloud never auto-uploads device inventory');
    await a.page.evaluate(async()=>{
      const layout={id:'household',locations:[{id:'fridge',name:'Fridge',kind:'fridge'}],members:[{name:'Alex'}],stores:[],staples:[],allergies:[],dislikes:[],people:2,aisleOrder:{}};
      await DB.put('meta',layout);S.household=layout;S.who=layout.members[0];welcomed=true;document.getElementById('welcomeOverlay')?.remove();
      await saveItem({id:'milk',name:'Milk',qty:2,mode:'count',loc:'fridge',cat:'dairy-milk',expires:Date.now()+86400000});await CloudKitchen.active.sync();render();
    });
    eq(await a.page.evaluate(()=>CloudKitchen.active.status().message),'Up to date','main app writes reach PostgreSQL');
    await a.page.evaluate(async()=>{const item=S.items.find(x=>x.id==='milk');item.qty=3;await saveItem(item);await CloudKitchen.active.sync();});
    eq(await a.page.evaluate(()=>CloudKitchen.active.all('outbox').then(x=>x.length)),0,'same in-memory item can save again after acknowledgement');
    await b.page.goto(base+'/?kitchen=personal');await b.page.waitForFunction(()=>window.CloudKitchen?.active);
    eq(await b.page.evaluate(()=>S.items.find(x=>x.id==='milk').qty),3,'second device loads account inventory');
    const sibling=await a.context.newPage();await sibling.goto(base+'/?kitchen=personal');await sibling.waitForFunction(()=>window.CloudKitchen?.active);
    await a.context.setOffline(true);
    await a.page.evaluate(async()=>{const i=S.items.find(x=>x.id==='milk');i.qty=4;await saveItem(i);await CloudKitchen.active.sync();});
    eq(await a.page.evaluate(()=>CloudKitchen.active.all('outbox').then(x=>x.length)),1,'offline edit has durable outbox');
    eq(await sibling.evaluate(async()=>{try{const i=S.items.find(x=>x.id==='milk');i.qty=99;await saveItem(i);return false;}catch(e){return /newer edit/.test(e.message);}}),true,'stale tab cannot replace a newer offline edit');
    eq(await a.page.evaluate(()=>DB.get('items','milk').then(x=>x.qty)),4,'newer pending quantity survives stale tab');await sibling.close();
    await b.page.evaluate(async()=>{const i=S.items.find(x=>x.id==='milk');i.qty=5;await saveItem(i);await CloudKitchen.active.sync();});
    await a.context.setOffline(false);await a.page.evaluate(()=>CloudKitchen.active.sync());
    await a.page.waitForFunction(async()=> (await CloudKitchen.active.all('conflicts')).length===1);
    eq(await a.page.evaluate(()=>DB.get('items','milk').then(x=>x.qty)),4,'conflict preserves local value');
    eq(await a.page.evaluate(()=>CloudKitchen.active.all('conflicts').then(x=>x[0].remote.body.qty)),5,'conflict preserves cloud value');
    await a.page.evaluate(async()=>{const c=(await CloudKitchen.active.all('conflicts'))[0];await CloudKitchen.active.resolve(c.id,false);});
    eq(await a.page.evaluate(()=>DB.get('items','milk').then(x=>x.qty)),5,'explicit resolution loads chosen version');
    eq(await a.page.evaluate(()=>CloudKitchen.active.all('checkpoints').then(x=>x.length)),2,'conflict and stale draft history retained');
    loseNextWrite=true;
    await a.page.evaluate(async()=>{const i=await DB.get('items','milk');i.qty=6;await DB.put('items',i);await CloudKitchen.active.sync();});
    eq(await a.page.evaluate(()=>CloudKitchen.active.all('outbox').then(x=>x.length)),1,'lost acknowledgement keeps operation queued');
    await a.page.reload();await a.page.waitForFunction(()=>window.CloudKitchen?.active);
    eq(await a.page.evaluate(()=>S.items.find(x=>x.id==='milk').qty),6,'restart replays safely after committed response was lost');
    eq(await a.page.evaluate(()=>CloudKitchen.active.all('outbox').then(x=>x.length)),0,'replay acknowledged without duplicate');
    // Switch users in the same browser storage: no prior user's records appear.
    await a.context.addInitScript(user=>window.__testUser=user,id(3));await a.page.reload();await a.page.waitForFunction(()=>window.CloudKitchen?.active);
    eq(await a.page.evaluate(()=>S.items.length),0,'account switch uses separate local database');
    await a.context.addInitScript(user=>window.__testUser=user,id(1));
    await a.page.goto(base+'/kitchens.html');await a.page.getByRole('button',{name:'Preview food & recipes'}).waitFor();
    await a.page.getByRole('button',{name:'Preview food & recipes'}).click();await a.page.getByRole('button',{name:'Copy selected items'}).waitFor();
    eq(await a.page.locator('.pick-list input:checked').count(),0,'transfer requires explicit selection');
    await a.page.locator('.pick-list input').first().check();a.page.once('dialog',d=>d.accept());await a.page.getByRole('button',{name:'Copy selected items'}).click();
    await a.page.waitForFunction(()=>document.querySelector('#sync-message')?.textContent.includes('1 copy saved'));
    await a.page.goto(base+'/?kitchen=personal');await a.page.waitForFunction(()=>window.CloudKitchen?.active);
    eq(await a.page.evaluate(()=>S.items.some(x=>x.name==='Device-only banana')),true,'selected device food copied into account');
    eq(await a.page.evaluate(()=>S.saved.length),0,'unselected private recipe not copied');
    await a.page.goto(base+'/?kitchen=local');await a.page.waitForFunction(()=>typeof S!=='undefined'&&S.items?.some(x=>x.id==='device-only'));
    eq(await a.page.evaluate(async()=>{const out={};for(const s of CloudKitchen.stores)out[s]=await DB.all(s);return out;}),original,'all original device stores preserved exactly');
    // Create two related test identities using real membership RPCs.
    const call=(page,name,args={})=>page.evaluate(async({name,args})=>(await(await fetch('/test-rpc',{method:'POST',body:JSON.stringify({name,args,user:window.__testUser})})).json()).data,{name,args});
    const home=await call(a.page,'stocked_create_home',{home_name:'Our family',member_name:'Alex'}),invite=await call(a.page,'stocked_create_invite');
    await member.page.goto(base+'/');await call(member.page,'stocked_join_home',{invite_token:invite.token,member_name:'Sam'});
    await a.page.goto(base+'/kitchens.html');await a.page.getByRole('button',{name:'Preview food & recipes'}).waitFor();
    await a.page.locator('#destination').selectOption('household');await a.page.locator('#preview').click();await a.page.locator('.pick-list input').first().check();
    a.page.once('dialog',d=>d.accept());await a.page.locator('#copy-selected').click();await a.page.waitForFunction(()=>document.querySelector('#sync-message')?.textContent.includes('1 copy saved'));
    await member.page.goto(base+'/?kitchen=household');await member.page.waitForFunction(()=>window.CloudKitchen?.active);
    eq(await member.page.evaluate(()=>S.items.map(i=>i.name)),['Device-only banana'],'family member sees only deliberately shared inventory');
    eq(await member.page.evaluate(()=>S.saved.length),0,'unshared recipes remain hidden');
    await a.page.locator('#preview').click();await a.page.locator('.pick-list input').nth(1).waitFor();
    eq(await a.page.locator('.pick-list input').first().isDisabled(),true,'copied food cannot be duplicated by transfer retry');
    await a.page.locator('.pick-list input').nth(1).check();a.page.once('dialog',d=>d.accept());await a.page.locator('#copy-selected').click();await a.page.waitForFunction(()=>document.querySelector('#sync-message')?.textContent.includes('1 copy saved'));
    await member.page.reload();await member.page.waitForFunction(()=>window.CloudKitchen?.active);
    eq(await member.page.evaluate(()=>S.saved.map(r=>r.name)),['My secret recipe'],'explicitly shared recipe reaches household member');
    await member.page.evaluate(async()=>{await DB.put('meta',{id:'cfg',supaKey:'synthetic-secret',gemini:'synthetic'});});
    eq(await member.page.evaluate(()=>CloudKitchen.active.export().then(x=>x.data.meta.some(r=>r.id==='cfg'))),false,'recovery exports omit device credential configuration');
    const fresh=await make(3);await fresh.page.goto(base+'/kitchens.html');await fresh.page.locator('#preview').click();await fresh.page.waitForFunction(()=>document.querySelector('#transfer-preview')?.textContent.includes('0 foods'));
    eq(await fresh.page.evaluate(async()=>(await indexedDB.databases()).some(d=>d.name==='coldroom')),false,'empty preview does not create a broken device database');
    await fresh.page.goto(base+'/?kitchen=local');await fresh.page.waitForFunction(()=>typeof DB!=='undefined');
    eq(await fresh.page.evaluate(async()=>{await DB.all('items');return (await indexedDB.databases()).some(d=>d.name==='coldroom');}),true,'local kitchen still initializes after empty preview');await fresh.context.close();
    fs.mkdirSync(OUT,{recursive:true});
    for(const width of [320,390,768,1280]){await a.page.setViewportSize({width,height:900});eq(await a.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'kitchens layout fits '+width);if(width===390||width===1280)await a.page.screenshot({path:path.join(OUT,`kitchens-${width}.png`),fullPage:true});}
    await call(a.page,'stocked_remove_member',{member_id:id(2)});await member.page.evaluate(()=>CloudKitchen.active.sync());await member.page.locator('#cloud-blocked').waitFor();
    eq(await member.page.locator('#cloud-blocked').isVisible(),true,'revoked household access locks active UI');
    await b.page.evaluate(()=>window.__authEvent('SIGNED_OUT',null));eq(await b.page.locator('#cloud-blocked').isVisible(),true,'signout hides existing cloud view');
    eq(errors,[],'no uncaught browser errors');console.log(`ALL ${checks} END-TO-END SYNC CHECKS PASS`);
  }finally{await browser?.close();await new Promise(r=>server.close(r));await chain;await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
