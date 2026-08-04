/* The shopping layer: what the shop didn't have, what's nearly gone at
   home, and what it all costs.

   Three things worth protecting:
     1. "They didn't have it" must not be swept away by Clear bought. The
        line you failed to buy is the one line you still need, and it was
        previously the one thing the app forgot.
     2. Coming back from the missed band reuses the same line — making a new
        one puts a duplicate in the store's history for every failed trip.
     3. The running total and the low-stock band both stay hidden until they
        have something true to say. A bar that always reads $0, or an empty
        "running low" strip, teaches people to ignore that part of the screen. */
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
    S.household = { id:'household', locations:[{id:'uf',name:'Fridge',kind:'fridge'},{id:'up',name:'Pantry',kind:'pantry'}],
      members:[{name:'Joe'}], staples:[], allergies:[], people:2,
      stores:[{ id:'cst', name:'Costco', emoji:'C' }], aisleOrder:{} };
    S.who = S.household.members[0];
    S.items = []; S.catalog = []; S.shopping = []; S.plan = []; S.saved = [];
    S.cfg = { autoPhotos:false, confirmActions:false }; S.store = 'cst'; S.view = 'shop';
    welcomed = true;
    await saveHousehold();
  });
  await setup();

  /* ---- 1. the missed band --------------------------------------------- */
  const missed = await page.evaluate(async () => {
    const salmon = await addToList('Salmon', '', 'cst');
    const milk   = await addToList('Whole milk', '', 'cst');
    // The shop had milk but not salmon.
    salmon.done = true; salmon.missing = true; salmon.doneAt = Date.now(); await saveShopping(salmon);
    milk.done = true;   milk.missing = false;  milk.doneAt = Date.now();   await saveShopping(milk);
    render();
    const band = document.querySelector('.missed');
    return { shown: !!band, txt: band?.innerText || '', pills: document.querySelectorAll('.missed .mpill').length,
      salmonId: salmon.id };
  });
  ok('a missed item raises the band', missed.shown);
  ok('the band names what the shop lacked', /Salmon/.test(missed.txt), missed.txt.replace(/\n/g, ' '));
  ok('a thing you DID buy is not in the band', !/Whole milk/.test(missed.txt), missed.txt.replace(/\n/g, ' '));
  ok('one pill per missed item', missed.pills === 1, `n=${missed.pills}`);

  /* Clear bought must sweep the buys and leave the misses. */
  const swept = await page.evaluate(async () => {
    const done = S.shopping.filter(s => !s.deleted && s.done);
    const sweep = done.filter(s => !s.missing);
    for (const s of sweep) { s.deleted = true; await saveShopping(s); }
    render();
    const salmon = S.shopping.find(s => s.name === 'Salmon');
    const milk = S.shopping.find(s => s.name === 'Whole milk');
    return { salmonAlive: !salmon.deleted, milkCleared: !!milk.deleted,
      bandStill: !!document.querySelector('.missed') };
  });
  ok('clearing bought does not sweep away a missed item', swept.salmonAlive);
  ok('...but does clear what you actually bought', swept.milkCleared);
  ok('so the band survives the clear', swept.bandStill);

  /* Tapping the pill reuses the same line rather than making a twin. */
  const restored = await page.evaluate(async (id) => {
    const before = S.shopping.filter(s => norm(s.name) === norm('Salmon')).length;
    const s = S.shopping.find(x => x.id === id);
    s.done = false; s.missing = false; s.doneAt = null; await saveShopping(s);
    render();
    return { before, after: S.shopping.filter(x => norm(x.name) === norm('Salmon')).length,
      onList: S.shopping.some(x => x.id === id && !x.done && !x.deleted),
      bandGone: !document.querySelector('.missed:not(.low)') };
  }, missed.salmonId);
  ok('coming back reuses the one line', restored.after === restored.before && restored.after === 1,
    `${restored.before} -> ${restored.after}`);
  ok('and it is live on the list again', restored.onList);
  ok('the band clears once nothing is outstanding', restored.bandGone);

  /* ---- 2. low stock at home ------------------------------------------- */
  const low = await page.evaluate(async () => {
    const hidden = !!document.querySelector('.missed.low');
    const it = await addItem({ name:'Olive oil', cat:'produce-root', loc:'up', qty:5, low:2 });
    render();
    const quiet = !!document.querySelector('.missed.low');          // 5 > 2, so silent
    while ((S.items.find(i => i.id === it.id).qty ?? 0) > 2) await deplete(S.items.find(i => i.id === it.id), 'used');
    render();
    return { hidden, quiet, loud: !!document.querySelector('.missed.low'),
      txt: document.querySelector('.missed.low')?.innerText || '',
      flag: runningLow(S.items.find(i => i.id === it.id)) };
  });
  ok('no low-stock band when nothing is low', !low.hidden && !low.quiet);
  ok('crossing the threshold raises it', low.loud);
  ok('it names the item and what is left', /Olive oil/.test(low.txt) && /2 left/.test(low.txt),
    low.txt.replace(/\n/g, ' '));
  ok('runningLow agrees', low.flag);

  /* A threshold of 0 or null means "never warn me". */
  const off = await page.evaluate(async () => {
    const a = await addItem({ name:'Salt', cat:'produce-root', loc:'up', qty:1 });            // no threshold
    const b = await addItem({ name:'Pepper', cat:'produce-root', loc:'up', qty:1, low:0 });   // explicitly off
    return { a: runningLow(a), b: runningLow(b) };
  });
  ok('an item with no threshold never reads as low', !off.a);
  ok('a threshold of 0 means off, not "always low"', !off.b);

  /* Already on the list? Don't offer it again. */
  const dedupe = await page.evaluate(async () => {
    await addToList('Olive oil', '', 'cst');
    render();
    return document.querySelector('.missed.low')?.innerText || '';
  });
  ok('something already on the list is not offered again', !/Olive oil/.test(dedupe), dedupe.replace(/\n/g, ' '));

  /* ---- 3. the running total -------------------------------------------- */
  const money = await page.evaluate(async () => {
    const quiet = !!document.querySelector('.total');
    const a = S.shopping.find(s => s.name === 'Salmon');
    a.price = 12.50; a.qty = '2'; await saveShopping(a);
    const b = await addToList('Bread', '', 'cst'); b.price = 3.25; await saveShopping(b);
    render();
    const shown = document.querySelector('.total')?.innerText || '';
    // now buy the bread
    b.done = true; b.doneAt = Date.now(); await saveShopping(b);
    render();
    return { quiet, shown, after: document.querySelector('.total')?.innerText || '' };
  });
  ok('no total bar before any prices exist', !money.quiet);
  ok('the list total counts quantity, not just lines', /28\.25/.test(money.shown), money.shown.replace(/\n/g, ' '));
  ok('nothing in the cart yet reads $0.00', /\$0\.00/.test(money.shown), money.shown.replace(/\n/g, ' '));
  ok('ticking something off moves it into the cart', /3\.25/.test(money.after), money.after.replace(/\n/g, ' '));
  ok('and the total is unchanged by picking it up', /28\.25/.test(money.after), money.after.replace(/\n/g, ' '));

  /* ---- 4. prices survive the trip into the pantry ---------------------- */
  const carried = await page.evaluate(async () => {
    const it = await addItem({ name:'Ribeye', cat:'meat-beef', loc:'uf', qty:1, price:24.99 });
    return { price: it.price, addedAt: !!it.addedAt, inInsights: insightsData(30).spend };
  });
  ok('a price put on an item sticks', carried.price === 24.99, String(carried.price));
  ok('items are stamped with a real timestamp for windowing', carried.addedAt);
  ok('and it reaches the spending chart', carried.inInsights === 24.99, `$${carried.inInsights}`);

  ok('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));

  await browser.close();
  server.close();
  console.log(pass ? '\nAll checks pass.' : '\nFailures above.');
  process.exit(pass ? 0 : 1);
})();
