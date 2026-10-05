/* Runs the real account UI against hosted Auth. Disposable test accounts only.
   Authenticator secrets stay in memory and are never included in screenshots. */
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {createHmac}=require('node:crypto');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.STOCKED_TEST_URL,key=process.env.STOCKED_TEST_KEY;
const email=process.env.STOCKED_TEST_OWNER_EMAIL,password=process.env.STOCKED_TEST_OWNER_PASSWORD;
const root=path.resolve(__dirname,'..');
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webp':'image/webp'};
const server=http.createServer((req,res)=>{
  const u=new URL(req.url,'http://local');
  if(u.pathname==='/cloud-config.js'){res.setHeader('Content-Type','text/javascript');return res.end('window.STOCKED_CLOUD_CONFIG='+JSON.stringify({enabled:true,supabaseUrl:base,publishableKey:key}));}
  const file=path.resolve(root,'.'+(u.pathname==='/'?'/index.html':u.pathname));
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){res.writeHead(404);return res.end();}
  res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(res);
});
function totp(secret){
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';let bits='';
  for(const c of secret.replace(/=+$/,''))bits+=alphabet.indexOf(c).toString(2).padStart(5,'0');
  const bytes=Buffer.from(bits.match(/.{8}/g).map(b=>parseInt(b,2))),counter=Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));
  const hash=createHmac('sha1',bytes).update(counter).digest(),offset=hash.at(-1)&15;
  return String((hash.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,'0');
}
(async()=>{
  assert.match(email||'',/^stocked-test-[a-z0-9-]+@example\.test$/);assert.match(base||'',/^https:\/\/[a-z0-9]+\.supabase\.co$/);
  let browser;const results=[];const check=(v,name)=>{assert.ok(v,name);results.push(name);console.log('PASS '+name);};
  try{
    await new Promise(r=>server.listen(0,'127.0.0.1',r));const local='http://127.0.0.1:'+server.address().port;
    browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
    const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'}),page=await context.newPage();
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    async function signIn(){await page.goto(local+'/account.html');await page.getByLabel('Email address').fill(email);await page.getByLabel('Password',{exact:true}).fill(password);await page.getByRole('button',{name:'Sign in',exact:true}).click();}
    await signIn();await page.getByRole('button',{name:'Manage two-step verification'}).click();
    await page.getByLabel('Authenticator name').fill('Staging phone');await page.getByRole('button',{name:'Set up authenticator',exact:true}).click();
    await page.getByText('Set up without scanning',{exact:true}).click();
    const secret=await page.getByLabel('Setup key').inputValue();
    await page.getByLabel('Verification code').fill(totp(secret));await page.getByRole('button',{name:'Enable authenticator'}).click();
    await page.getByText('Two-step verification on',{exact:true}).waitFor();check(true,'real TOTP enrollment verified by hosted Auth');
    await page.getByLabel('Authenticator name').fill('Staging backup');await page.getByRole('button',{name:'Add backup authenticator'}).click();
    await page.getByText('Set up without scanning',{exact:true}).click();const backup=await page.getByLabel('Setup key').inputValue();
    await page.getByLabel('Verification code').fill(totp(backup));await page.getByRole('button',{name:'Enable authenticator'}).click();await page.getByText('Two-step verification on',{exact:true}).waitFor();
    check(await page.getByRole('button',{name:'Remove',exact:true}).count()===2,'backup authenticator available for recovery');
    await page.getByRole('button',{name:'Back to my account'}).click();await page.getByRole('button',{name:'Sign out on this device'}).click();await page.getByRole('tab',{name:'Sign in',exact:true}).waitFor();
    await signIn();await page.getByRole('heading',{name:'One more step.'}).waitFor();
    check(true,'subsequent password sign-in requires second factor');
    const aal1=await page.evaluate(()=>JSON.parse(localStorage.getItem('stocked-account-auth')));
    const headers={apikey:key,Authorization:'Bearer '+aal1.access_token,'Content-Type':'application/json'};
    const rejected=await fetch(base+'/rest/v1/rpc/stocked_account_home',{method:'POST',headers,body:'{}'});
    check(rejected.status===403,'hosted RPC rejects password-only JWT when MFA enrolled');
    const direct=await fetch(base+'/rest/v1/stocked_records?select=record_id',{headers});
    check(direct.ok&&(await direct.json()).length===0,'hosted direct REST cannot bypass MFA');
    await page.getByLabel('Verification code').fill('000000');await page.getByRole('button',{name:'Verify & continue'}).click();await page.getByRole('alert').waitFor();
    check(await page.getByRole('heading',{name:'One more step.'}).isVisible(),'wrong verification code keeps account locked');
    await page.locator('select[name="factor"]').selectOption({label:'Staging backup'});
    // TOTP replay protection may reject a just-used code; wait only to the next tick.
    const waitMs=30000-Date.now()%30000+1100;await new Promise(r=>setTimeout(r,waitMs));
    await page.getByLabel('Verification code').fill(totp(backup));await page.getByRole('button',{name:'Verify & continue'}).click();
    await page.getByRole('button',{name:'Manage two-step verification'}).waitFor();check(true,'backup factor completes sign-in');
    await page.getByRole('button',{name:'Manage two-step verification'}).click();await page.getByText('Two-step verification on',{exact:true}).waitFor();
    const out=path.resolve(__dirname,'../../../outputs/kitchen-sync');fs.mkdirSync(out,{recursive:true});
    await page.screenshot({path:path.join(out,'account-security-390.png'),fullPage:true});
    // Remove only the two factors created by this test through real app actions.
    for(let i=0;i<2;i++){
      page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Remove',exact:true}).first().click();
      await page.getByRole('button',{name:'Manage two-step verification'}).click();
    }
    await page.getByRole('button',{name:'Set up authenticator',exact:true}).waitFor();check(true,'verified user can remove factors, including turning MFA off');
    check(errors.length===0,'no uncaught browser errors');
    fs.writeFileSync(path.join(out,'hosted-security-verification.json'),JSON.stringify({at:new Date().toISOString(),checks:results},null,2));
    console.log(`ALL ${results.length} HOSTED ACCOUNT SECURITY CHECKS PASS`);
  }finally{await browser?.close();server.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
