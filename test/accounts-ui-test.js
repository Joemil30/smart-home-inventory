/* Real account page and browser, simulated Supabase Auth/RPC transport.
   Email delivery and hosted token verification require staging, not these mocks. */
const http=require('http'),fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const ROOT=path.resolve(__dirname,'..');
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.webp':'image/webp','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};
const server=http.createServer((req,res)=>{
  const name=new URL(req.url,'http://local').pathname,file=path.join(ROOT,name==='/'?'index.html':name);
  if(!file.startsWith(ROOT+path.sep)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){res.writeHead(404);return res.end();}
  res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(res);
});
const mock=`(() => {
  const user={id:'owner-id',email:'alex@example.test',user_metadata:{display_name:'Alex'}};
  const m=window.__mock={calls:[],session:null,home:null,fail:'',delay:0,ready:true,event:'INITIAL_SESSION',listener:null};
  m.emit=(event,session)=>{m.session=session;m.listener?.(event,session)};
  const call=async(name,args)=>{m.calls.push({name,args});if(m.delay)await new Promise(r=>setTimeout(r,m.delay));return m.fail===name?{error:{message:name==='signin'?'Invalid login credentials':'Network request failed'}}:{error:null}};
  window.supabase={createClient:(url,key,options)=>{m.options=options;return {
    auth:{
      onAuthStateChange:f=>{m.listener=f;return {data:{subscription:{unsubscribe(){}}}}},
      getSession:async()=>{if(m.event==='PASSWORD_RECOVERY'){m.session={user};m.listener?.(m.event,m.session)}return {data:{session:m.session}}},
      signUp:async a=>({...await call('signup',a),data:{session:null}}),
      signInWithPassword:async a=>{const out=await call('signin',a);if(!out.error)m.emit('SIGNED_IN',{user});return {...out,data:{session:m.session}}},
      resetPasswordForEmail:async(...a)=>call('reset',a),resend:async a=>call('resend',a),
      updateUser:async a=>call('password',a),
      signOut:async a=>{const out=await call('signout',a);if(!out.error)m.emit('SIGNED_OUT',null);return out}
    },
    rpc:async(name,args)=>{
      const out=await call(name,args);if(out.error)return out;
      if(name==='stocked_cloud_status')return {data:{protocol:1,ready:m.ready,inventorySync:false}};
      if(name==='stocked_create_home')m.home={id:'home-a',name:args.home_name,role:'owner',members:[{user_id:'owner-id',name:args.member_name,role:'owner'}]};
      if(name==='stocked_create_invite')return {data:{token:'a'.repeat(64),expiresAt:new Date(Date.now()+86400000).toISOString()}};
      if(name==='stocked_preview_invite')return {data:{name:'Family kitchen',owner:'Jamie'}};
      if(name==='stocked_join_home')m.home={id:'home-b',name:'Family kitchen',role:'member',members:[{user_id:'owner-id',name:args.member_name,role:'member'}]};
      return {data:m.home};
    }
  }}};
})();`;
(async()=>{
  let browser;
  try{
    await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
    browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
    const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block',colorScheme:'dark'});
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
    await page.route('**/supabase.min.js',r=>r.fulfill({contentType:'text/javascript',body:mock}));
    const config={enabled:false,supabaseUrl:'https://test.supabase.co',publishableKey:'sb_publishable_test'};
    await page.route('**/cloud-config.js',r=>r.fulfill({contentType:'text/javascript',body:`window.STOCKED_CLOUD_CONFIG=${JSON.stringify(config)}`}));
    await page.goto(base+'/');await page.waitForFunction(()=>typeof S!=='undefined');
    await page.evaluate(async()=>{await DB.put('items',{id:'existing',name:'Keep this food',qty:4});});
    const snapshot=()=>page.evaluate(()=>new Promise((resolve,reject)=>{const request=indexedDB.open('coldroom',1);request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,names=[...db.objectStoreNames],t=db.transaction(names),out={};for(const s of names){const r=t.objectStore(s).getAll();r.onsuccess=()=>out[s]=r.result}t.oncomplete=()=>{db.close();resolve(out)}}}));
    const before=await snapshot();
    await page.goto(base+'/account.html');await page.getByRole('heading',{name:'Still local. Still yours.'}).waitFor();
    assert.equal(await page.locator('input').count(),0);assert.equal(await page.evaluate(()=>__mock.calls.length),0);console.log('PASS disabled deployment collects no credentials and makes no account calls');
    config.enabled=true;config.publishableKey='sb_secret_do_not_use';await page.reload();await page.getByRole('heading',{name:'Still local. Still yours.'}).waitFor();
    assert.equal(await page.evaluate(()=>__mock.calls.length),0);console.log('PASS service secret rejected as browser configuration');
    config.publishableKey='sb_publishable_test';await page.reload();await page.getByRole('tab',{name:'Create account',exact:true}).click();
    const dir=process.env.STOCKED_ACCOUNT_SCREENSHOTS||path.resolve(ROOT,'../../outputs/accounts-foundation');fs.mkdirSync(dir,{recursive:true});
    await page.screenshot({path:path.join(dir,'signup-preview-390.png'),fullPage:true});
    await page.getByLabel('Your name',{exact:true}).fill('Alex');await page.getByLabel('Email address').fill('alex@example.test');
    await page.getByLabel('Password',{exact:true}).fill('a long unique password');await page.getByLabel('Confirm password').fill('wrong long password');
    await page.getByRole('button',{name:'Create my account'}).click();await page.getByRole('alert').filter({hasText:'Passwords do not match'}).waitFor();
    assert.equal(await page.evaluate(()=>__mock.calls.length),0);
    await page.getByLabel('Confirm password').fill('a long unique password');
    await page.screenshot({path:path.join(dir,'signup-390.png')});
    await page.getByRole('button',{name:'Create my account'}).click();await page.getByRole('status').filter({hasText:'Check your email'}).waitFor();
    assert.equal(await page.getByLabel('Password',{exact:true}).inputValue(),'');
    assert.equal(await page.evaluate(()=>__mock.calls.filter(c=>c.name==='signup').length),1);
    assert.equal(await page.evaluate(()=>__mock.options.auth.flowType),'pkce');console.log('PASS signup validation, verification message, cleared password, PKCE configuration');
    await page.getByRole('button',{name:'Forgot your password?'}).click();await page.getByLabel('Email address').fill('alex@example.test');await page.getByRole('button',{name:'Send reset email'}).click();
    await page.getByRole('status').filter({hasText:'If an account exists'}).waitFor();console.log('PASS reset request uses neutral account-existence wording');
    await page.getByRole('button',{name:'Back to sign in'}).click();await page.getByLabel('Email address').fill('alex@example.test');await page.getByLabel('Password',{exact:true}).fill('test password');
    await page.evaluate(()=>{__mock.fail='signin'});await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('alert').filter({hasText:'didn’t work'}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Sign in',exact:true}).isEnabled(),true);
    await page.evaluate(()=>{__mock.fail='';__mock.delay=150});await page.getByRole('button',{name:'Sign in',exact:true}).click();
    await page.getByRole('heading',{name:'Who’s in your kitchen?'}).waitFor();console.log('PASS sign-in failure is retryable; successful sign-in reaches household setup');
    await page.getByLabel('Household name').fill('Our kitchen');await page.getByLabel('Your name',{exact:true}).fill('Alex');
    await page.getByRole('button',{name:'Create household',exact:true}).click();await page.getByRole('heading',{name:'Our kitchen'}).waitFor();
    await page.getByRole('button',{name:'Invite someone'}).click();await page.getByLabel('Invitation link').waitFor();
    assert.match(await page.getByLabel('Invitation link').inputValue(),/#invite=a{64}$/);console.log('PASS household creation and one-person invitation UI');
    await page.screenshot({path:path.join(dir,'household-390.png')});
    for(const width of [320,390,768,1280]){await page.setViewportSize({width,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
    await page.screenshot({path:path.join(dir,'household-1280.png')});console.log('PASS account screens fit phone/tablet/desktop widths');
    await page.evaluate(()=>{__mock.fail='signout'});await page.getByRole('button',{name:'Sign out on this device'}).click();await page.getByRole('alert').waitFor();
    assert.equal(await page.getByRole('heading',{name:'Our kitchen'}).isVisible(),true);console.log('PASS failed signout does not claim success');
    await page.evaluate(()=>{__mock.fail=''});await page.getByRole('button',{name:'Sign out on this device'}).click();await page.getByRole('tab',{name:'Sign in',exact:true}).waitFor();
    await page.goto(base+'/account.html?fixture=invite#invite='+'b'.repeat(64));await page.getByText('An invitation is ready.',{exact:false}).waitFor();assert.equal(new URL(page.url()).hash,'');
    await page.getByLabel('Email address').fill('alex@example.test');await page.getByLabel('Password',{exact:true}).fill('test password');await page.getByRole('button',{name:'Sign in',exact:true}).click();
    await page.getByRole('heading',{name:'Who’s in your kitchen?'}).waitFor();
    let confirmation='';page.once('dialog',async d=>{confirmation=d.message();await d.dismiss()});await page.getByRole('button',{name:'Review & join household'}).click();
    await page.getByRole('status').filter({hasText:'No changes made'}).waitFor();assert.match(confirmation,/Family kitchen.*Jamie/);assert.equal(await page.evaluate(()=>__mock.calls.filter(c=>c.name==='stocked_join_home').length),0);
    page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Review & join household'}).click();await page.getByRole('heading',{name:'Family kitchen'}).waitFor();console.log('PASS invitation is scrubbed from URL, reviewed with home identity, and requires confirmation');
    await page.evaluate(()=>__mock.emit('PASSWORD_RECOVERY',__mock.session));await page.getByRole('heading',{name:'Choose a new password.'}).waitFor();
    await page.getByLabel('New password',{exact:true}).fill('a new unique password');await page.getByLabel('Confirm password').fill('a new unique password');await page.getByRole('button',{name:'Save new password'}).click();await page.getByRole('heading',{name:'Family kitchen'}).waitFor();console.log('PASS authenticated recovery event opens password replacement flow');
    await page.evaluate(()=>{__mock.delay=250});await page.getByRole('button',{name:'Refresh household'}).click();await page.evaluate(()=>__mock.emit('SIGNED_OUT',null));await page.getByRole('tab',{name:'Sign in',exact:true}).waitFor();await page.waitForTimeout(400);
    assert.equal(await page.getByRole('heading',{name:'Family kitchen'}).count(),0);console.log('PASS session loss does not restore stale household response');
    await page.goto(base+'/account.html#invite='+'c'.repeat(64));await page.getByText('An invitation is ready.',{exact:false}).waitFor();assert.equal(new URL(page.url()).hash,'');console.log('PASS invitation arriving in an already-open tab is processed and scrubbed');
    assert.deepEqual(await snapshot(),before);console.log('PASS all existing coldroom stores unchanged after entire account workflow');
    assert.deepEqual(errors,[]);console.log('PASS no uncaught browser errors');
    console.log('ALL ACCOUNT UI CHECKS PASS');
  }finally{await browser?.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
