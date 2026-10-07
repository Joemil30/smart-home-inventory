/* Opt-in public-site smoke test. Creates ONLY disposable browser-local records. */
if(process.env.STOCKED_LIVE_SMOKE!=='1') { console.log('Set STOCKED_LIVE_SMOKE=1 to verify the public v63 release.');process.exit(0); }
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const ROOT=path.resolve(__dirname,'..'),base='https://joemil30.github.io/smart-home-inventory/';
const out=process.env.STOCKED_SCREENSHOTS || path.resolve(ROOT,'../../outputs/stocked-v63');
(async()=>{let browser;const checks=[];const pass=s=>{checks.push(s);console.log('PASS '+s);};try{
  for(const file of ['index.html','sw.js','guide.html','assets/household.css','cloud-config.js']){
    const response=await fetch(base+file+'?release-check='+Date.now());assert.equal(response.status,200,file);
    const remote=(await response.text()).replace(/\r\n/g,'\n');
    assert.equal(remote,fs.readFileSync(path.join(ROOT,file),'utf8').replace(/\r\n/g,'\n'),file+' differs from this release');
  }pass('Public application files match the release exactly');
  browser=await chromium.launch({executablePath:process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  const context=await browser.newContext({viewport:{width:390,height:844},colorScheme:'dark'});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);await page.waitForFunction(()=>typeof kitchenCheck==='function'&&typeof DB!=='undefined');
  assert.equal(await page.evaluate(()=>window.STOCKED_CLOUD_CONFIG.enabled),false);
  await page.evaluate(async()=>{
    welcomed=true;document.getElementById('welcomeOverlay')?.remove();
    S.household={id:'household',locations:[{id:'fridge',name:'Fridge',kind:'fridge'},{id:'pantry',name:'Pantry',kind:'pantry'}],members:[{name:'Demo'}],staples:[],allergies:[],dislikes:[],people:2,stores:[]};
    S.who=S.household.members[0];S.cfg={autoPhotos:false,theme:'light',confirmActions:false};await saveHousehold();await saveCfg();
    await addItem({name:'Spinach',cat:'produce-leafy',loc:'fridge',expires:today()+DAY});
    await addItem({name:'Chicken breast',cat:'poultry-raw',loc:'fridge',expires:today()+2*DAY});
    await addItem({name:'Pasta',cat:'dry-pasta-rice',loc:'pantry'});
    S.view='home';render();
  });
  assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'light');
  fs.mkdirSync(out,{recursive:true});await page.screenshot({path:path.join(out,'live-home-390.png')});
  for(const view of ['pantry','cook','shop']){await page.evaluate(v=>{S.view=v;render();},view);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
  pass('Today, Inventory, Cook and Shop render in light mode at phone width');
  await page.evaluate(()=>showRecipeDetail(localRecipeFeed().find(r=>r.id==='stocked:creamy-tomato-pasta')));
  await page.locator('#dlg [data-a=add]').click();await page.waitForFunction(()=>!document.getElementById('dlg').open);
  assert.ok(await page.evaluate(()=>S.shopping.some(i=>!i.deleted)));pass('Recipe missing ingredients reach Shop');
  await page.evaluate(()=>{S.view='pantry';render();kitchenCheck();});
  await page.locator('#check-search').fill('Spinach');await page.getByRole('button',{name:'Gone',exact:true}).click();
  await page.locator('#dlg [data-a=save]').click();await page.waitForFunction(()=>S.items.find(i=>i.name==='Spinach').deleted);
  await page.getByRole('button',{name:'UNDO',exact:true}).click();await page.waitForFunction(()=>!S.items.find(i=>i.name==='Spinach').deleted);
  pass('Published kitchen check removes and restores the selected food');
  await page.evaluate(()=>navigator.serviceWorker.ready);await page.reload();await page.waitForFunction(()=>S.items?.length===3);
  assert.ok(await page.evaluate(async()=>(await caches.keys()).includes('stocked-v63')));pass('Refresh preserves groceries; installed cache is v63');
  await context.setOffline(true);await page.reload();await page.waitForFunction(()=>S.items?.length===3);
  await page.evaluate(()=>{S.view='cat';render();});assert.equal(await page.locator('#catlist .item').count(),3);
  await page.goto(base+'guide.html');assert.match(await page.locator('h1').innerText(),/less waste/);
  await page.screenshot({path:path.join(out,'live-guide-390.png')});pass('Inventory, catalog and family guide reopen offline');
  await context.setOffline(false);await page.goto(base+'account.html');assert.match(await page.locator('body').innerText(),/Cloud accounts are not enabled/);
  pass('Public account page accurately gates family cloud activation');
  assert.deepEqual(errors,[]);pass('No uncaught browser errors');
  fs.writeFileSync(path.join(out,'live-verification.json'),JSON.stringify({version:'v63',verifiedAt:new Date().toISOString(),url:base,checks,limits:['Device-only pilot; cloud activation remains off','No real camera, AI provider, email-delivery or iOS install verification'],syntheticDataOnly:true},null,2));
}finally{await browser?.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
