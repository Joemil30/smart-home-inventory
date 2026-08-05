/* The features built after calendar-test, which had gone in without cover:
   buying rhythm, unified search, plain named lists, list sharing, the
   running-low chip, suggestion shelves, multi-language and lifetime impact.

   The one that matters most is the rhythm maths. It is the only part of the
   app that makes a PREDICTION, and a wrong prediction is worse than none —
   people stop trusting the whole screen. So most of these checks are about
   it staying quiet. */
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

  await page.evaluate(async () => {
    S.household = { id:'household', locations:[{id:'uf',name:'Fridge',kind:'fridge'}],
      members:[{name:'Joe'}], staples:[], allergies:[], people:2,
      stores:[{ id:'cst', name:'Costco', kind:'store' }], aisleOrder:{}, aisleNames:{} };
    S.who = S.household.members[0];
    S.items = []; S.catalog = []; S.shopping = []; S.plan = []; S.saved = [];
    S.cfg = { autoPhotos:false, confirmActions:false }; S.store = 'cst'; S.shopMap = false;
    welcomed = true;
    await saveHousehold();
  });

  /* ---- 1. buying rhythm: mostly about staying quiet -------------------- */
  const mk = `(name, gaps, lastAgo) => {
    const D = 864e5, now = Date.now();
    let t = now - lastAgo * D; const buys = [t];
    for (let i = gaps.length - 1; i >= 0; i--) { t -= gaps[i] * D; buys.unshift(t); }
    return { id: catId(name, null, CAT_PRODUCT), kind: CAT_PRODUCT, name, cat: 'dairy-milk',
      count: buys.length, first: buys[0], last: buys[buys.length - 1], buys,
      stores: { cst: { n: buys.length, last: buys[buys.length - 1] } }, deleted: false, updatedAt: now };
  }`;

  const rhythm = await page.evaluate(async (mkSrc) => {
    const mk = eval(mkSrc);
    S.catalog = [
      mk('Whole milk', [6, 7, 6, 7, 6], 7),        // steady ~weekly, 7d ago
      mk('Coffee',     [3, 40, 5, 60, 4], 5),      // erratic
      mk('Olive oil',  [30, 32, 29, 31], 5),       // steady monthly, only 5d ago
      mk('Bread',      [2, 3], 1),                 // too few purchases
      mk('Party ice',  [7, 7, 7, 300, 7], 3),      // one huge outlier among steady gaps
    ];
    for (const c of S.catalog) await DB.put('catalog', c);
    const r = n => buyRhythm(S.catalog.find(c => c.name === n));
    return { milk: r('Whole milk'), coffee: r('Coffee'), oil: r('Olive oil'),
      bread: r('Bread'), ice: r('Party ice') };
  }, mk);

  ok('a steady weekly buy is recognised', rhythm.milk && rhythm.milk.everyDays === 6,
    JSON.stringify(rhythm.milk));
  ok('...and reads as overdue when it is', rhythm.milk && rhythm.milk.dueIn < 0,
    String(rhythm.milk?.dueIn));
  ok('an erratic buy says nothing at all', rhythm.coffee === null);
  ok('three purchases is not enough to speak', rhythm.bread === null);
  ok('a steady monthly buy is recognised', rhythm.oil && rhythm.oil.everyDays === 31,
    String(rhythm.oil?.everyDays));
  ok('...and is not due five days in', rhythm.oil && rhythm.oil.dueIn > 20, String(rhythm.oil?.dueIn));
  /* The whole reason for using a median: a mean over [7,7,7,300,7] is 6535,
     which would put this three months out and be silently, confidently wrong. */
  ok('one huge outlier does not move the estimate', rhythm.ice && rhythm.ice.everyDays === 7,
    `every ${rhythm.ice?.everyDays}d — a mean would say ${Math.round((7+7+7+300+7)/5)}`);

  /* Same-trip repeats are one purchase, not several. */
  const sameTrip = await page.evaluate(async () => {
    for (let i = 0; i < 3; i++) await recordCatalog({ name: 'Yoghurt', cat: 'dairy-yogurt' }, { store: 'cst' });
    return (S.catalog.find(c => c.name === 'Yoghurt')?.buys || []).length;
  });
  ok('three of a thing in one trip is one purchase', sameTrip === 1, `n=${sameTrip}`);

  /* The band only offers things you do NOT currently have. */
  const band = await page.evaluate(async () => {
    const offered = () => dueForRestock('cst').map(x => x.c.name);
    const before = offered();
    await addItem({ name:'Whole milk', cat:'dairy-milk', loc:'uf', qty:1 });   // now in the house
    const withStock = offered();
    await addToList('Whole milk', '', 'cst');
    return { before, withStock, onList: offered() };
  });
  ok('an overdue item is offered', band.before.includes('Whole milk'), band.before.join());
  ok('...but not while you still have some', !band.withStock.includes('Whole milk'), band.withStock.join());
  ok('...and never twice once it is on the list', !band.onList.includes('Whole milk'), band.onList.join());

  /* ---- 2. unified search ----------------------------------------------- */
  const search = await page.evaluate(async () => {
    S.items = []; S.shopping = [];
    await addItem({ name:'Baby spinach', cat:'produce-leafy', loc:'uf', qty:1 });
    await addToList('Sourdough', '', 'cst');
    await saveRec({ id: uid(), name:'Green pasta', minutes:20, uses:['spinach','pasta','garlic'],
      missing:[], rescues:[], steps:['Boil'], image:null, deleted:false });
    await recordCatalog({ name:'Spinach ravioli', kind: CAT_MEAL }, {});
    const r = searchEverything('spinach');
    return { items: r.items.map(x => x.i.name), recipes: r.recipes.map(x => x.r.name),
      meals: r.meals.map(x => x.c.name), total: r.total,
      typo: searchEverything('spinch').items.length,
      list: searchEverything('sourdough').onList.length,
      nothing: searchEverything('zzzqqq').total };
  });
  ok('search finds what is in the house', search.items.includes('Baby spinach'), search.items.join());
  ok('search finds a recipe by its INGREDIENT, not just its title',
    search.recipes.includes('Green pasta'), search.recipes.join());
  ok('search finds meals you have made', search.meals.includes('Spinach ravioli'), search.meals.join());
  ok('search finds what is already on a list', search.list === 1, String(search.list));
  ok('search survives a typo', search.typo === 1, String(search.typo));
  ok('a miss returns nothing rather than everything', search.nothing === 0, String(search.nothing));

  const searchUi = await page.evaluate(() => {
    S.view = 'search'; S.gq = 'spinach'; render();
    const txt = document.getElementById('app').innerText;
    S.gq = 'zzzqqq'; render();
    return { hit: txt, miss: document.getElementById('app').innerText };
  });
  ok('the search screen groups by what you can do', /In the house/.test(searchUi.hit) && /Recipes/.test(searchUi.hit));
  ok('a dead end offers to put it on the list', /on the list/i.test(searchUi.miss), searchUi.miss.slice(0, 80));

  /* ---- 3. plain named lists -------------------------------------------- */
  const lists = await page.evaluate(async () => {
    const pl = await addStore('Packing list', '📋', 'list');
    await addToList('Passport', '', pl.id);
    S.view = 'shop'; S.store = pl.id; S.shopMap = true; render();
    const noMap = !document.querySelector('.seg') && !document.querySelector('.amap');
    S.store = 'cst'; render();
    return { kind: pl.kind, isShop: isShop('cst'), isList: isShop(pl.id), noMap,
      shopHasMap: !!document.querySelector('.seg'), text: listAsText(pl.id) };
  });
  ok('a plain list is stored as one', lists.kind === 'list' && !lists.isList);
  ok('a real shop is still a shop', lists.isShop);
  ok('a plain list gets no aisles and no map', lists.noMap);
  ok('a real shop still gets the map', lists.shopHasMap);
  ok('sharing a plain list skips aisle headings',
    /Packing list/.test(lists.text) && !/Produce/.test(lists.text), lists.text.replace(/\n/g, ' / '));

  /* ---- 4. sharing a shop list groups by the walk ------------------------ */
  const shared = await page.evaluate(async () => {
    S.shopping = [];
    for (const n of ['Bananas', 'Whole milk', 'Sourdough']) await addToList(n, '', 'cst');
    const text = listAsText('cst');
    S.shopping.forEach(s => { s.done = true; });
    return { text, empty: listAsText('cst') };
  });
  ok('a shop list is shared grouped by aisle',
    /Produce/.test(shared.text) && /Dairy/.test(shared.text) && /Bakery/.test(shared.text),
    shared.text.replace(/\n/g, ' / '));
  ok('everything on the list appears in the text',
    ['Bananas','Whole milk','Sourdough'].every(n => shared.text.includes(n)));
  ok('an all-bought list shares nothing rather than a bare title', shared.empty === '', shared.empty);

  /* ---- 5. the running-low chip ----------------------------------------- */
  const lowChip = await page.evaluate(async () => {
    S.items = [];
    await addItem({ name:'Olive oil', cat:'produce-root', loc:'uf', qty:2, low:3 });
    await addItem({ name:'Rice', cat:'produce-root', loc:'uf', qty:9 });
    S.view = 'inv'; S.loc = 'all'; S.status = 'all'; render();
    const chip = [...document.querySelectorAll('.chips .chip')].some(c => /Running low \(1\)/.test(c.textContent));
    S.status = 'low'; render();
    const txt = document.getElementById('app').innerText;
    S.status = 'all';
    return { chip, only: /Olive oil/.test(txt) && !/\bRice\b/.test(txt) };
  });
  ok('a running-low chip appears with a real count', lowChip.chip);
  ok('and filters to only the low item', lowChip.only);

  /* ---- 6. lifetime impact ---------------------------------------------- */
  const impact = await page.evaluate(async () => {
    S.items = [];
    const fin = async (name, wasted) => {
      const it = await addItem({ name, cat:'produce-root', loc:'uf', qty:1 });
      it.deleted = true;
      if (wasted) { it.wasted = true; it.wastedAt = Date.now(); }
      else { it.goneAt = Date.now(); it.rescued = true; }
      await saveItem(it);
    };
    for (let i = 0; i < 8; i++) await fin('Eaten' + i, false);
    for (let i = 0; i < 2; i++) await fin('Binned' + i, true);
    return lifetimeImpact();
  });
  ok('lifetime impact counts what was eaten', impact.used === 8, String(impact.used));
  ok('...and what was binned', impact.binned === 2, String(impact.binned));
  ok('...and the rate is right', impact.rate === 20, `${impact.rate}%`);
  ok('rescued is tracked separately', impact.saved === 8, String(impact.saved));

  /* ---- 7. translation never overwrites what was typed ------------------- */
  const lang = await page.evaluate(async () => {
    S.shopping = [];
    const s = await addToList('Cilantro', '', 'cst');
    s.tr = { es: 'Culantro' }; await saveShopping(s);
    S.cfg.listLang = 'es';
    const shown = shownName(s);
    S.cfg.listLang = '';
    return { shown, raw: s.name, back: shownName(s),
      missing: (S.cfg.listLang = 'fr', shownName(s)) };
  });
  ok('a translation is shown when a language is set', lang.shown === 'Culantro', lang.shown);
  ok('the typed name is never overwritten', lang.raw === 'Cilantro', lang.raw);
  ok('clearing the language shows what was typed', lang.back === 'Cilantro', lang.back);
  ok('an untranslated language falls back rather than blanking', lang.missing === 'Cilantro', lang.missing);

  ok('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));

  await browser.close();
  server.close();
  console.log(pass ? '\nAll checks pass.' : '\nFailures above.');
  process.exit(pass ? 0 : 1);
})();
