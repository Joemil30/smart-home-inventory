/* Aisle sorting, recipe match ratio, Cook Now, and the week-based planner. */
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright');
const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html':'text/html', '.js':'text/javascript', '.svg':'image/svg+xml', '.png':'image/png', '.webmanifest':'application/manifest+json' };

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

  const seed = () => page.evaluate(async () => {
    S.household = { id:'household', locations:[{id:'uf',name:'Fridge',kind:'fridge'},{id:'up',name:'Pantry',kind:'pantry'}],
      members:[{name:'Sam'}], staples:[], people:2, stores:[], aisleOrder:{}, planSync:false };
    S.who = S.household.members[0];
    S.items = []; S.catalog = []; S.shopping = []; S.plan = []; S.saved = [];
    S.cfg = { autoPhotos:false, shopView:'photos' }; S.view = 'shop'; S.store = ''; S.q = ''; S.weekOff = 0; S.cookNow = false;
    welcomed = true; document.getElementById('welcomeOverlay')?.remove();
  });

  // ---- A. things file themselves into the right aisle ----
  await seed();
  const a = await page.evaluate(() => ({
    spinach: aisleOf(guessCat('Baby spinach')),
    milk:    aisleOf(guessCat('Whole milk')),
    chicken: aisleOf(guessCat('Chicken thighs')),
    bread:   aisleOf(guessCat('Sourdough bread')),
    rice:    aisleOf(guessCat('Basmati rice')),
    unknown: aisleOf(guessCat('Zzzqqx')),
    named:   AISLE_NAME('produce'),
  }));
  ok('aisle: produce goes to Produce', a.spinach === 'produce', a.spinach);
  ok('aisle: milk goes to Dairy', a.milk === 'dairy', a.milk);
  ok('aisle: chicken goes to Meat', a.chicken === 'meat', a.chicken);
  ok('aisle: bread goes to Bakery', a.bread === 'bakery', a.bread);
  ok('aisle: rice goes to Pantry', a.rice === 'pantry', a.rice);
  ok('aisle: something unrecognised still lands somewhere', a.unknown === 'other', a.unknown);
  ok('aisle: aisles have readable names', a.named === 'Produce', a.named);

  // ---- B. a typed item is categorised on the way in ----
  await seed();
  const typed = await page.evaluate(async () => {
    await addToList('Baby spinach');
    await addToList('Cheddar cheese');
    const g = n => S.shopping.find(s => s.name === n);
    return { spin: g('Baby spinach').cat, cheese: g('Cheddar cheese').cat,
      spinAisle: aisleOf(g('Baby spinach').cat), cheeseAisle: aisleOf(g('Cheddar cheese').cat) };
  });
  ok('aisle: a typed item gets a category with no history at all', !!typed.spin && !!typed.cheese, JSON.stringify(typed));
  ok('aisle: and therefore the right aisle', typed.spinAisle === 'produce' && typed.cheeseAisle === 'dairy', JSON.stringify(typed));

  // ---- C. a STORE's list renders grouped, in walking order ----
  // Aisle grouping + reorder is a per-store thing (Costco's walk isn't the
  // corner shop's) — so this only kicks in once a store is selected.
  await seed();
  const grouped = await page.evaluate(async () => {
    const costco = await addStore('Costco');
    S.store = costco.id;
    await addToList('Whole milk', '', costco.id);        // dairy
    await addToList('Baby spinach', '', costco.id);      // produce
    await addToList('Chicken thighs', '', costco.id);    // meat
    await addToList('Bananas', '', costco.id);           // produce
    render();
    const heads = [...document.querySelectorAll('#shoplist .aisle span')].map(h => h.textContent);
    const produceIdx = heads.indexOf('Produce'), dairyIdx = heads.indexOf('Dairy & eggs');
    const reorderBtn = /Reorder aisles/i.test(document.getElementById('shoplist').textContent);
    S.store = '';
    return { heads, produceFirst: produceIdx === 0, dairyAfterProduce: dairyIdx > produceIdx,
      counts: [...document.querySelectorAll('#shoplist .aisle i')].map(i => i.textContent), reorderBtn };
  });
  ok('aisle: a store list is grouped under aisle headers', grouped.heads.length >= 3, grouped.heads.join(' | '));
  ok('aisle: produce comes first, as you walk in', grouped.produceFirst === true, grouped.heads.join(' | '));
  ok('aisle: dairy comes after produce by default', grouped.dairyAfterProduce === true);
  ok('aisle: each header counts its items', grouped.counts.includes('2'), grouped.counts.join(','));
  ok('aisle: a store list offers Reorder aisles', grouped.reorderBtn === true);

  // ---- D. one aisle needs no header ----
  await seed();
  const single = await page.evaluate(async () => {
    const costco = await addStore('Costco');
    S.store = costco.id;
    await addToList('Baby spinach', '', costco.id);
    await addToList('Bananas', '', costco.id);
    render();
    const r = { heads: document.querySelectorAll('#shoplist .aisle').length,
      tiles: document.querySelectorAll('#shoplist .tile').length };
    S.store = '';
    return r;
  });
  ok('aisle: a single-aisle store list shows no header at all', single.heads === 0 && single.tiles === 2,
    JSON.stringify(single));

  // ---- D2. the GENERAL list is a flat checklist — no headers, no reorder ----
  await seed();
  const general = await page.evaluate(async () => {
    await addToList('Whole milk');        // dairy
    await addToList('Baby spinach');      // produce
    await addToList('Chicken thighs');    // meat
    S.store = ''; render();
    return { heads: document.querySelectorAll('#shoplist .aisle').length,
      tiles: document.querySelectorAll('#shoplist .tile').length,
      reorderBtn: /Reorder aisles/i.test(document.getElementById('shoplist').textContent) };
  });
  ok('aisle: the general list has no aisle headers', general.heads === 0, JSON.stringify(general));
  ok('aisle: the general list shows every item flat', general.tiles === 3, JSON.stringify(general));
  ok('aisle: the general list offers no Reorder aisles button', general.reorderBtn === false);

  // ---- E. each store walks its own order ----
  await seed();
  const order = await page.evaluate(async () => {
    const costco = await addStore('Costco');
    const dflt = aisleOrder('');
    await saveAisleOrder(costco.id, ['frozen', 'dairy', 'produce']);
    const custom = aisleOrder(costco.id);
    const other = aisleOrder('');                       // general list untouched
    // an aisle the saved order never heard of must not vanish
    const keepsUnknown = custom.includes('bakery');
    await saveAisleOrder(costco.id, []);
    return { dfltFirst: dflt[0], customFirst: custom[0], otherFirst: other[0],
      keepsUnknown, reset: aisleOrder(costco.id)[0] };
  });
  ok('aisle order: the default walk starts at produce', order.dfltFirst === 'produce', order.dfltFirst);
  ok('aisle order: a store can put frozen first', order.customFirst === 'frozen', order.customFirst);
  ok('aisle order: one store\'s order does not change another list', order.otherFirst === 'produce');
  ok('aisle order: aisles missing from a saved order still appear', order.keepsUnknown === true);
  ok('aisle order: it can be reset to the default', order.reset === 'produce', order.reset);

  // ---- F. recipe match ratio ----
  const ratio = await page.evaluate(() => ({
    partial: matchRatio({ uses:['a','b','c'], missing:['d','e'] }),
    full:    matchRatio({ uses:['a','b'], missing:[] }),
    none:    matchRatio({ uses:[], missing:[] }),
  }));
  ok('recipe: ratio counts what you have over the total',
    ratio.partial.have === 3 && ratio.partial.total === 5, JSON.stringify(ratio.partial));
  ok('recipe: a complete recipe reads have === total',
    ratio.full.have === 2 && ratio.full.total === 2, JSON.stringify(ratio.full));
  ok('recipe: a recipe with no ingredient data does not print a bogus ratio', ratio.none.total === 0);

  const card = await page.evaluate(() => {
    const c = recipeCardEl({ name:'Test dish', minutes:25, steps:['x'], uses:['a','b','c'], missing:['d','e'] });
    document.body.appendChild(c);
    const r = c.querySelector('.ratio');
    const out = { text: r ? r.textContent.trim() : null, readiness: c.querySelector('.recipe-readiness').textContent };
    c.remove(); return out;
  });
  ok('recipe: the ratio is printed on the card', card.text === '3 / 5 ingredients', String(card.text));
  ok('recipe: and spelled out underneath', /have\s+3 of 5/i.test(card.readiness), card.readiness);

  // ---- G. Have everything filter ----
  await seed();
  const cook = await page.evaluate(async () => {
    recipeCache = [
      { name:'Ready one', minutes:20, steps:['x'], uses:['a','b'], missing:[] },
      { name:'Needs stuff', minutes:30, steps:['x'], uses:['a'], missing:['b','c'] },
    ];
    S.items = [{ id:'i', name:'A', cat:'other', loc:'uf', deleted:false, mode:'count', qty:1, expires:Date.now()+9e8, added:Date.now() }];
    S.view = 'cook'; S.cookTab = 'suggested'; S.recipeFilter = 'all'; render();
    const all = [...document.querySelectorAll('#app .recipe-card h3')].map(h => h.textContent);
    const hasToggle = /Have everything/i.test(document.getElementById('app').textContent);
    S.recipeFilter = 'ready'; render();
    const filtered = [...document.querySelectorAll('#app .recipe-card h3')].map(h => h.textContent);
    S.recipeFilter = 'all';
    return { all, hasToggle, filtered };
  });
  ok('cook: a Have everything filter is offered', cook.hasToggle === true);
  ok('cook: All includes local and generated ideas', cook.all.includes('Ready one') && cook.all.includes('Needs stuff'), String(cook.all.length));
  ok('cook: Have everything keeps ready ideas and hides missing ones',
    cook.filtered.includes('Ready one') && !cook.filtered.includes('Needs stuff'), cook.filtered.join(','));

  // ---- H. the planner runs on weeks ----
  await seed();
  const plan = await page.evaluate(async () => {
    const wk = weekRange(0), nx = weekRange(1);
    await planMeal(dayKey(wk.days[1]), { name:'This week meal' });
    await planMeal(dayKey(nx.days[1]), { name:'Next week meal' });
    S.view = 'plan'; S.weekOff = 0; render();
    const now = document.getElementById('app').textContent;
    S.weekOff = 1; render();
    const next = document.getElementById('app').textContent;
    S.weekOff = 0;
    return {
      tabs: /Last week/.test(now) && /This week/.test(now) && /Next week/.test(now),
      showsThis: /This week meal/.test(now), hidesNext: !/Next week meal/.test(now),
      showsNextOnNext: /Next week meal/.test(next), hidesThisOnNext: !/This week meal/.test(next),
      days: document.querySelectorAll('#app .day').length,
      range: /\w+ \d+/.test(now),
    };
  });
  ok('plan: three week tabs', plan.tabs === true);
  ok('plan: this week shows only this week', plan.showsThis && plan.hidesNext, JSON.stringify(plan));
  ok('plan: next week shows only next week', plan.showsNextOnNext && plan.hidesThisOnNext);
  ok('plan: seven day cards per week', plan.days === 7, String(plan.days));
  ok('plan: the date range is labelled', plan.range === true);

  // ---- I. sync-to-list toggle ----
  await seed();
  const sync = await page.evaluate(async () => {
    const wk = weekRange(0);
    await planMeal(dayKey(wk.days[2]), { name:'Taco night', missing:['Tortillas', 'Salsa'] });
    S.household.planSync = true; await saveHousehold();
    S.view = 'plan'; render();
    await new Promise(z => setTimeout(z, 200));
    const onList = S.shopping.filter(s => !s.deleted && s.fromPlan).map(s => s.name);
    // running it twice must not duplicate
    render(); await new Promise(z => setTimeout(z, 200));
    const after = S.shopping.filter(s => !s.deleted).length;
    return { onList, after, hasToggle: !!document.getElementById('psync') };
  });
  ok('plan: the sync toggle is on the screen', sync.hasToggle === true);
  ok('plan: missing ingredients land on the list', sync.onList.length === 2, sync.onList.join(','));
  ok('plan: re-rendering does not duplicate them', sync.after === 2, String(sync.after));

  const skip = await page.evaluate(async () => {
    // something you already have must not be added
    S.items = [{ id:'t', name:'Tortillas', cat:'tortilla', loc:'up', deleted:false, mode:'count', qty:4, expires:Date.now()+9e8, added:Date.now() }];
    S.shopping = []; S.plan = [];
    const wk = weekRange(0);
    await planMeal(dayKey(wk.days[2]), { name:'Taco night', missing:['Tortillas', 'Salsa'] });
    S.view = 'plan'; render();
    await new Promise(z => setTimeout(z, 200));
    return S.shopping.filter(s => !s.deleted).map(s => s.name);
  });
  ok('plan: it skips what is already in the house', skip.length === 1 && /Salsa/.test(skip[0]), skip.join(','));

  // ---- J. speed dial ----
  await seed();
  const dial = await page.evaluate(async () => {
    S.view = 'pantry'; render();
    const fab = document.getElementById('fab'), d = document.getElementById('dial');
    const hiddenFirst = d.classList.contains('hide');
    fab.click();
    const opts = [...d.querySelectorAll('button')].map(b => b.textContent.trim());
    const open = !d.classList.contains('hide') && fab.getAttribute('aria-expanded') === 'true';
    fab.click();                                   // tapping + again closes it
    const closed = d.classList.contains('hide');
    fab.click();
    d.click();                                     // tapping the scrim closes it
    const scrimClosed = d.classList.contains('hide');
    return { hiddenFirst, open, opts, closed, scrimClosed };
  });
  ok('dial: closed until you press +', dial.hiddenFirst === true);
  ok('dial: fans out to the three ways in', dial.open && dial.opts.length === 3, dial.opts.join(' / '));
  ok('dial: pressing + again closes it', dial.closed === true);
  ok('dial: tapping anywhere else closes it', dial.scrimClosed === true);

  // ---- K. theme ----
  const theme = await page.evaluate(async () => {
    const read = () => getComputedStyle(document.documentElement).getPropertyValue('--void').trim();
    S.cfg.theme = 'light'; applyTheme(); const light = read();
    S.cfg.theme = 'dark';  applyTheme(); const dark = read();
    const attr = document.documentElement.getAttribute('data-theme');
    S.cfg.theme = 'system'; applyTheme();
    const cleared = document.documentElement.getAttribute('data-theme');
    // dark ground has to actually be dark, and text has to flip with it
    S.cfg.theme = 'dark'; applyTheme();
    const ink = getComputedStyle(document.documentElement).getPropertyValue('--frost').trim();
    const tag = getComputedStyle(document.documentElement).getPropertyValue('--t-have-bg').trim();
    S.cfg.theme = 'system'; applyTheme();
    return { light, dark, attr, cleared, ink, tag };
  });
  ok('theme: light and dark are different grounds', theme.light !== theme.dark, `${theme.light} vs ${theme.dark}`);
  ok('theme: dark is actually dark', /#0E1512/i.test(theme.dark), theme.dark);
  ok('theme: text flips with the ground', /#E7EFE9/i.test(theme.ink), theme.ink);
  ok('theme: status colours get dark variants too, not the light ones',
    /#14271B/i.test(theme.tag), theme.tag);
  ok('theme: an explicit choice stamps the root', theme.attr === 'dark');
  ok('theme: legacy "system" preference now resolves to the light default', theme.cleared === 'light', String(theme.cleared));

  ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));

  await browser.close(); server.close();
  console.log(pass ? '\nALL AISLE/PLAN CHECKS PASS' : '\nFAILURES ABOVE');
  process.exit(pass ? 0 : 1);
})();
