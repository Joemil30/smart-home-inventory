/* Stocked's richer recipe toolkit: light default, no-key paste parsing,
   serving scaling, measurement conversion, nutrition, cooking mode and
   cookbook organization. */
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright');
const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html':'text/html', '.js':'text/javascript', '.svg':'image/svg+xml', '.png':'image/png', '.webp':'image/webp', '.webmanifest':'application/manifest+json' };

const server = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]);
  if (p === '/favicon.ico') { r.writeHead(204); return r.end(); }
  if (p === '/') p = '/index.html';
  const fp = path.join(ROOT, p);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
  fs.createReadStream(fp).pipe(r);
});

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await browser.newContext({ colorScheme:'dark', viewport:{ width:390, height:844 } });
  const page = await ctx.newPage(), errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(base, { waitUntil:'networkidle' });
  let pass = true;
  const ok = (n, c, x='') => { console.log(`${c?'PASS':'FAIL'}  ${n}${x?'  — '+x:''}`); if (!c) pass=false; };

  const initial = await page.evaluate(() => ({ theme:document.documentElement.dataset.theme, ground:getComputedStyle(document.documentElement).getPropertyValue('--void').trim() }));
  ok('dark phone still opens in light mode', initial.theme === 'light' && initial.ground === '#F7F9F7', JSON.stringify(initial));

  await page.evaluate(async () => {
    S.household = { id:'household', locations:[{id:'f',name:'Fridge',kind:'fridge'}], members:[{name:'Joe'}], staples:[], allergies:[], dislikes:[], people:2, stores:[], aisleOrder:{} };
    S.who = S.household.members[0]; S.items=[]; S.catalog=[]; S.shopping=[]; S.plan=[]; S.saved=[];
    S.cfg={theme:'light',autoPhotos:false,confirmActions:false}; welcomed=true; document.getElementById('welcomeOverlay')?.remove();
    await saveHousehold();
  });

  const parsed = await page.evaluate(async () => {
    const old = G.key; G.key = () => '';
    const out = await parseRecipeText(`Weeknight Soup\nServes 4\nIngredients\n2 cans tomatoes\n1 onion\n2 cups stock\nMethod\nSoften the onion.\nAdd everything and simmer.`);
    G.key = old; return out;
  });
  ok('pasted recipe works without an AI key', parsed.name === 'Weeknight Soup' && parsed.uses.length === 3 && parsed.steps.length === 2, JSON.stringify(parsed));

  const math = await page.evaluate(() => ({ doubled:scaledIngredient('1 1/2 cups flour',2,'original'), metric:scaledIngredient('12 oz pasta',1,'metric'), us:scaledIngredient('500 g flour',1,'us') }));
  ok('mixed fractions scale cleanly', /^3 cups flour$/.test(math.doubled), math.doubled);
  ok('US weights convert to metric', /340(?:\.2)? g pasta/.test(math.metric), math.metric);
  ok('metric weights convert to US', /17(?:\.6|⅝) oz flour/.test(math.us), math.us);

  await page.evaluate(() => showRecipeDetail(localRecipeFeed().find(r => r.id === 'stocked:chicken-spinach-pasta')));
  let detail = await page.locator('#dlg').innerText();
  ok('recipe detail includes nutrition', /520[\s\S]*Calories[\s\S]*46g[\s\S]*Protein/i.test(detail), detail.slice(0,180));
  ok('recipe detail includes serving and measurement controls', /Servings/.test(detail) && /Measurements/.test(detail));
  await page.locator('#dlg [data-a=more]').click();
  detail = await page.locator('#dlg').innerText();
  ok('serving stepper scales ingredient amounts', /12 oz pasta/.test(detail), detail.slice(0,260));
  await page.locator('#dlg #runits').selectOption('metric');
  detail = await page.locator('#dlg').innerText();
  ok('measurement picker updates visible ingredients', /340(?:\.2)? g pasta/.test(detail), detail.slice(0,300));

  await page.locator('#dlg [data-a=start]').click();
  await page.waitForTimeout(150);
  let cook = await page.locator('#dlg').innerText();
  ok('focused cooking mode opens at step one', /Cooking · 1 of 3/i.test(cook) && /Boil the pasta/.test(cook), cook.slice(0,180));
  await page.locator('#dlg [data-a=next]').click();
  cook = await page.locator('#dlg').innerText();
  ok('cooking mode advances one step at a time', /Cooking · 2 of 3/i.test(cook) && /Sauté sliced chicken/.test(cook), cook.slice(0,180));
  await page.locator('#dlg [data-a=c]').click();

  await page.evaluate(() => showRecipeDetail(localRecipeFeed().find(r => r.id === 'stocked:chicken-spinach-pasta')));
  await page.locator('#dlg [data-a=organize]').click();
  await page.waitForTimeout(100);
  await page.locator('#dlg #obooks').fill('Weeknight dinners, Favorites');
  await page.locator('#dlg #otags').fill('Freezer friendly');
  await page.locator('#dlg #onotes').fill('Use a little less salt next time.');
  await page.locator('#dlg [data-a=save]').click();
  const organized = await page.evaluate(() => { const r=S.saved.find(x=>!x.deleted); return {books:r?.cookbooks,tags:r?.customTags,notes:r?.notes}; });
  ok('saved recipes support cookbooks, tags and notes', organized.books?.length === 2 && organized.tags?.[0] === 'Freezer friendly' && /less salt/.test(organized.notes), JSON.stringify(organized));

  await page.evaluate(() => { S.cookTab='saved'; S.view='cook'; render(); });
  const library = await page.locator('#app').innerText();
  const savedSearch = await page.locator('#app input[placeholder^="Search saved recipes"]').count();
  ok('saved library exposes cookbook filters and richer search', savedSearch === 1 && /Weeknight dinners/.test(library), library.slice(0,220));
  ok('no page errors', errs.length === 0, errs.slice(0,3).join(' | '));

  await browser.close(); server.close();
  console.log(pass ? '\nALL RECIPE PRO CHECKS PASS' : '\nFAILURES ABOVE');
  process.exit(pass ? 0 : 1);
})();
