/* Real v61 -> v62 data preservation plus responsive household workflows.
   All records below are synthetic, in a disposable browser context. */
const http=require('http'),fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {execFileSync}=require('child_process');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const ROOT=path.resolve(__dirname,'..');
const baseline=execFileSync('git',['show','stocked-v61:index.html'],{cwd:ROOT,encoding:'utf8',maxBuffer:4e6});
let current=false;
const MIME={'.html':'text/html','.css':'text/css','.js':'text/javascript','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/'&&!current){res.setHeader('Content-Type','text/html');return res.end(baseline);}
  const file=path.join(ROOT,url.pathname==='/'?'index.html':url.pathname);
  if(!file.startsWith(ROOT)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){res.writeHead(404);return res.end();}
  res.setHeader('Content-Type',MIME[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(res);
});
(async()=>{
  let browser;
  try{
    await new Promise(r=>server.listen(0,'127.0.0.1',r));
    browser=await chromium.launch({executablePath:process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'});
    const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block',colorScheme:'dark'});
    const page=await context.newPage();
    await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(()=>typeof S!=='undefined'&&typeof DB!=='undefined');
    await page.evaluate(async()=>{
      S.household={id:'household',locations:[{id:'fridge',name:'Kitchen Fridge',kind:'fridge'},{id:'pantry',name:'Pantry',kind:'pantry'},{id:'freezer',name:'Downstairs Freezer',kind:'freezer'}],members:[{name:'Alex'}],staples:['salt','olive oil'],allergies:[],dislikes:[],people:2,stores:[],aisleOrder:{}};
      S.who=S.household.members[0];S.cfg={autoPhotos:false,theme:'light',confirmActions:false};
      welcomed=true;document.getElementById('welcomeOverlay')?.remove();await saveHousehold();await saveCfg();
      const names=['Spinach','Chicken breast','Pasta','Parmesan','Garlic','Eggs','Greek yogurt','Milk','Rice','Broccoli'];
      for(let j=0;j<500;j++){
        const i={id:'fixture-'+j,name:j<10?names[j]:`Pantry product ${j}`,cat:j<10?guessCat(names[j]):'canned',loc:j%3===0?'fridge':j%3===1?'pantry':'freezer',mode:'count',qty:j%4+1,low:j%9===0?2:0,expires:today()+(j<3?j+1:10+j)*DAY,added:today()-DAY,deleted:j>490,dateConfirmed:j%2===0};
        await DB.put('items',i);
      }
      S.items=await DB.all('items');
      await addToList('Milk');await addToList('Avocados');await addToList('Coffee');
      S.view='home';render();
    });
    const snapshot=()=>page.evaluate(async()=>{
      const out={};for(const s of ['items','catalog','recipes','meta','log','shopping','plan','saved'])out[s]=(await DB.all(s)).sort((a,b)=>String(a.id).localeCompare(String(b.id)));return out;
    });
    const before=await snapshot();assert.equal(before.items.length,500);
    current=true;await page.reload();await page.waitForFunction(()=>document.querySelector('#nav')?.textContent.includes('Today'));
    assert.deepEqual(await snapshot(),before);console.log('PASS  v61 upgrade preserves every record in all eight stores (500 items)');
    assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--void').trim()),'#FAF9F6');
    console.log('PASS  dark operating system still opens in warm light theme');
    // Screenshots use a realistic small subset in memory, never production data.
    await page.evaluate(()=>{S.items=S.items.filter(i=>Number(i.id.split('-')[1])<10);S.q='';S.loc='all';S.status='all';S.view='home';render();});
    const dir=process.env.STOCKED_SCREENSHOTS || path.resolve(ROOT,'../../outputs/stocked-v62');fs.mkdirSync(dir,{recursive:true});
    for(const width of [320,390,768,1280]){
      await page.setViewportSize({width,height:844});
      for(const view of ['home','pantry','cook','shop']){
        await page.evaluate(v=>{S.view=v;render();window.scrollTo(0,0)},view);
        await page.waitForTimeout(100);
        const dim=await page.evaluate(()=>({width:innerWidth,body:document.documentElement.scrollWidth,nav:document.querySelector('#nav').getBoundingClientRect().toJSON(),cards:document.querySelectorAll('.recipe-cover.photo').length}));
        assert.ok(dim.body<=width+1,`${view} ${width}: overflow ${dim.body}`);
        assert.ok(dim.nav.bottom<=845&&dim.nav.top>=770,`${view}: nav not on screen`);
        if(view==='cook')assert.equal(dim.cards,14,'All recipe photos load');
        if(width===390||width===1280)await page.screenshot({path:path.join(dir,`${view}-${width}.png`)});
      }
      console.log(`PASS  all four screens fit ${width}px; fixed navigation visible; all 14 covers load`);
    }
    await page.setViewportSize({width:390,height:844});
    await page.evaluate(()=>{S.view='home';render();});
    assert.ok(await page.evaluate(()=>document.querySelector('.today-attention').compareDocumentPosition(document.querySelector('.home-decision'))&Node.DOCUMENT_POSITION_FOLLOWING));
    console.log('PASS  food needing attention appears before dinner inspiration');
    await page.evaluate(()=>{S.view='pantry';render();});
    await page.getByPlaceholder(/^Search \d+ items/).fill('Chicken');
    assert.equal(await page.locator('#results .item').count(),1);
    await page.locator('#results [data-a=plus]').click();
    assert.equal(await page.evaluate(()=>S.items.find(i=>i.name==='Chicken breast').qty),3);
    console.log('PASS  inventory search and inline quantity editing');
    await page.evaluate(()=>showRecipeDetail(localRecipeFeed().find(r=>r.id==='stocked:creamy-tomato-pasta')));
    await page.waitForSelector('.recipe-detail-hero.photo');
    await page.screenshot({path:path.join(dir,'recipe-390.png')});
    assert.equal(await page.locator('#recipe-method').isVisible(),false);
    await page.getByRole('tab',{name:'Steps',exact:true}).click();
    assert.equal(await page.locator('#recipe-method').isVisible(),true);
    assert.equal(await page.locator('#recipe-ingredients').isVisible(),false);
    await page.getByRole('tab',{name:'Ingredients',exact:true}).click();
    await page.locator('#dlg [data-a=add]').click();
    await page.waitForFunction(()=>!document.querySelector('#dlg').open);
    await page.evaluate(()=>{S.view='shop';render();});
    assert.ok(await page.locator('.shop-recipe').count()>0);
    assert.match(await page.locator('#shoplist').innerText(),/At home:.*Milk/);
    console.log('PASS  ingredient tabs, recipe-to-shop provenance and at-home shopping context');
    await page.evaluate(()=>showRecipeDetail({name:'Uploaded cover',ingredients:['1 egg'],steps:['Cook'],image:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGx0AAAAASUVORK5CYII='}));
    await page.waitForSelector('.recipe-detail-hero.photo');
    await page.evaluate(()=>showRecipeDetail({name:'Broken cover',ingredients:['1 egg'],steps:['Cook'],image:'http://127.0.0.1:1/missing.png'}));
    await page.waitForTimeout(150);assert.equal(await page.locator('.recipe-detail-hero.photo').count(),0);
    console.log('PASS  uploaded cover renders; broken image keeps neutral fallback');
    for(const width of [320,390,1280]){
      await page.setViewportSize({width,height:844});
      assert.ok(await page.evaluate(()=>document.querySelector('#dlg').scrollWidth<=document.querySelector('#dlg').clientWidth+1),'Recipe dialog overflows');
    }
    await page.locator('#dlg [data-a=c]').click();
    await page.getByRole('button',{name:'Scan or add food',exact:true}).click();
    assert.equal(await page.locator('.capture-option').count(),5);
    await page.screenshot({path:path.join(dir,'capture.png')});
    await page.emulateMedia({reducedMotion:'reduce'});
    assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('.capture-option')).transitionDuration),'1e-05s');
    console.log('PASS  global capture chooser, responsive dialogs and reduced motion');
    assert.deepEqual(errors,[]);console.log('PASS  no uncaught page errors');
    console.log('ALL HOUSEHOLD CHECKS PASS');
  }finally{await browser?.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
