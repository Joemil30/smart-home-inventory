/* Insights — the screen that argues the app is worth keeping.

   What this protects:
     1. The maths. "59% eaten" has to be true, or the whole screen is a lie
        the user would act on (and put on a resume).
     2. It reads tombstoned items and invents no new bookkeeping — so using
        something up in the normal way has to show up here with no extra step.
     3. Spending stays hidden until prices actually exist, rather than
        rendering an empty chart or a confident $0. */
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright');
const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html':'text/html', '.js':'text/javascript', '.svg':'image/svg+xml', '.png':'image/png', '.webmanifest':'application/manifest+json', '.json':'application/json' };

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
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  const errs = [];
  const noise = /openfoodfacts|themealdb|net::ERR|Failed to load resource|ERR_/i;
  page.on('pageerror', e => { if (!noise.test(e.message)) errs.push(e.message); });
  await page.goto(base, { waitUntil: 'networkidle' });

  let pass = true;
  const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${x ? '  — ' + x : ''}`); if (!c) pass = false; };

  const setup = async () => page.evaluate(async () => {
    S.household = { id:'household', locations:[{id:'uf',name:'Fridge',kind:'fridge'}],
      members:[{name:'Joe'}], staples:[], allergies:[], people:2, stores:[], aisleOrder:{} };
    S.who = S.household.members[0];
    S.items = []; S.catalog = []; S.shopping = []; S.plan = []; S.saved = [];
    S.cfg = { autoPhotos:false }; S.insDays = 30;
    welcomed = true;
    await saveHousehold();
  });
  await setup();

  /* ---- 1. an empty history says so, rather than dividing by zero ------- */
  const empty = await page.evaluate(() => {
    const d = insightsData(30);
    S.view = 'insights'; render();
    return { total: d.total, ate: d.ate, txt: document.getElementById('app').innerText };
  });
  ok('no finished items = nothing to divide', empty.total === 0 && empty.ate === 0);
  ok('and it says so instead of showing 0%', /Nothing finished yet/i.test(empty.txt), empty.txt.slice(0, 60));

  /* ---- 2. the maths ---------------------------------------------------- */
  const math = await page.evaluate(async () => {
    const fin = async (name, cat, days, wasted) => {
      const it = await addItem({ name, cat, loc:'uf', qty:1 });
      it.deleted = true;
      if (wasted) { it.wasted = true; it.wastedAt = Date.now() - days*864e5; }
      else { it.goneAt = Date.now() - days*864e5; it.rescued = days === 1; }
      await saveItem(it);
    };
    for (let i = 0; i < 6; i++) await fin('Whole milk', 'dairy-milk', 1, false);   // 6 used, all rescued
    for (let i = 0; i < 2; i++) await fin('Carrots', 'produce-root', 5, false);    // 2 used
    for (let i = 0; i < 2; i++) await fin('Baby spinach', 'produce-leafy', 3, true); // 2 binned
    return insightsData(30);
  });
  ok('used-up items counted', math.used === 8, `used=${math.used}`);
  ok('binned items counted', math.binned === 2, `binned=${math.binned}`);
  ok('total is used + binned', math.total === 10, `total=${math.total}`);
  ok('eaten percentage is right', math.ate === 80, `ate=${math.ate}%`);
  ok('rescued counted separately from used', math.rescued === 6, `rescued=${math.rescued}`);

  /* Rankings are ordered, and the two lists never bleed into each other. */
  ok('most-eaten ranked, biggest first', math.usedBy[0]?.name === 'Whole milk' && math.usedBy[0]?.n === 6,
    JSON.stringify(math.usedBy));
  ok('a wasted item never appears in the eaten list',
    !math.usedBy.some(r => r.name === 'Baby spinach'), JSON.stringify(math.usedBy));
  ok('most-wasted ranked separately', math.binnedBy[0]?.name === 'Baby spinach' && math.binnedBy[0]?.n === 2,
    JSON.stringify(math.binnedBy));

  /* ---- 3. the window actually windows ---------------------------------- */
  const windowed = await page.evaluate(async () => {
    const it = await addItem({ name:'Old yoghurt', cat:'dairy-other', loc:'uf', qty:1 });
    it.deleted = true; it.wasted = true; it.wastedAt = Date.now() - 200*864e5;   // long ago
    await saveItem(it);
    return { m30: insightsData(30).binned, m365: insightsData(365).binned };
  });
  ok('something binned 200 days ago is outside 30 days', windowed.m30 === 2, `n=${windowed.m30}`);
  ok('...and inside a year', windowed.m365 === 3, `n=${windowed.m365}`);

  /* ---- 4. depleting normally feeds this with no extra bookkeeping ------- */
  const viaDeplete = await page.evaluate(async () => {
    const before = insightsData(30).used;
    const it = await addItem({ name:'Butter', cat:'dairy-other', loc:'uf', qty:1 });
    await deplete(it, 'used');                 // the ordinary path, no dialog
    return { before, after: insightsData(30).used };
  });
  ok('using something up shows up with no extra step', viaDeplete.after === viaDeplete.before + 1,
    `${viaDeplete.before} -> ${viaDeplete.after}`);

  /* ---- 5. spending stays honest ---------------------------------------- */
  const money = await page.evaluate(async () => {
    const none = insightsData(30);
    const it = await addItem({ name:'Ribeye', cat:'meat-beef', loc:'uf', qty:1 });
    it.price = 24; it.addedAt = Date.now(); await saveItem(it);
    const some = insightsData(30);
    return { noneSpend: none.spend, noneCats: none.catSpend.length, someSpend: some.spend, someCats: some.catSpend };
  });
  ok('no prices means no spending total', money.noneSpend === 0 && money.noneCats === 0);
  ok('a priced item totals up', money.someSpend === 24, `$${money.someSpend}`);
  ok('spending groups by category family', money.someCats[0]?.name === 'meat', JSON.stringify(money.someCats));

  /* ---- 6. it renders ---------------------------------------------------- */
  const ui = await page.evaluate(() => {
    S.view = 'insights'; S.insDays = 30; render();
    const app = document.getElementById('app');
    return { txt: app.innerText, donuts: app.querySelectorAll('.dn').length,
      bars: app.querySelectorAll('.rb').length,
      chips: [...app.querySelectorAll('.chips .chip')].map(c => c.textContent.trim()) };
  });
  ok('two donuts render', ui.donuts === 2, `n=${ui.donuts}`);
  ok('ranking bars render', ui.bars > 0, `n=${ui.bars}`);
  ok('the eaten headline is on screen', /EATEN/i.test(ui.txt));
  ok('the wasted headline is on screen', /BINNED/i.test(ui.txt));
  ok('all three windows offered', ui.chips.length === 3, ui.chips.join(' | '));

  const switched = await page.evaluate(() => {
    S.insDays = 365; render();
    return document.getElementById('app').innerText;
  });
  ok('switching window repaints', /finished/i.test(switched));

  ok('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));

  await browser.close();
  server.close();
  console.log(pass ? '\nAll checks pass.' : '\nFailures above.');
  process.exit(pass ? 0 : 1);
})();
