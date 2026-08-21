/* Tests for the catalog spine, store-scoped lists, the checklist states and
   the big-tile layout. */
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright');
const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html':'text/html', '.js':'text/javascript', '.webmanifest':'application/manifest+json', '.svg':'image/svg+xml', '.png':'image/png' };

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
  page.on('console', m => { if (m.type() === 'error' && !noise.test(m.text())) errs.push('console: ' + m.text()); });
  page.on('pageerror', e => { if (!noise.test(e.message)) errs.push('pageerror: ' + e.message); });
  await page.goto(base, { waitUntil: 'networkidle' });

  let pass = true;
  const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${x ? '  — ' + x : ''}`); if (!c) pass = false; };

  const seed = () => page.evaluate(async () => {
    S.household = { id:'household', locations:[{id:'uf',name:'Fridge',kind:'fridge'},{id:'up',name:'Pantry',kind:'pantry'}],
      members:[{name:'Sam'}], staples:[], people:2, stores:[] };
    S.who = S.household.members[0];
    S.items = []; S.catalog = []; S.shopping = []; S.plan = []; S.saved = [];
    S.cfg = { autoPhotos:false, shopView:'photos' }; S.q = ''; S.store = ''; S.loc = 'all'; S.status = 'all';
    welcomed = true; document.getElementById('welcomeOverlay')?.remove();
  });

  // ---- A. identity: one memory per real-world thing ----
  await seed();
  const ids = await page.evaluate(() => ({
    barcodeWins: catId('Whole Milk', '012345') === '012345',
    plural: catId('Chicken Thighs') === catId('chicken thigh'),
    caseSpace: catId('  BABY  Spinach ') === catId('baby spinach'),
    syn: catId('scallions') === catId('green onion'),
    mealsSeparate: catId('Tacos', null, 'meal') !== catId('Tacos', null, 'product'),
  }));
  ok('catId: a barcode is authoritative when present', ids.barcodeWins);
  ok('catId: plural/singular collapse to one record', ids.plural);
  ok('catId: case and spacing collapse', ids.caseSpace);
  ok('catId: grocery synonyms collapse (scallions = green onion)', ids.syn);
  ok('catId: a meal and a product of the same name stay separate', ids.mealsSeparate);

  // ---- B. recordCatalog: counts and store attribution accumulate ----
  await seed();
  const rec = await page.evaluate(async () => {
    await recordCatalog({ name:'Olive oil', cat:'oil' }, { store:'s1' });
    await recordCatalog({ name:'olive oils', cat:'oil' }, { store:'s1' });   // same thing, sloppier
    await recordCatalog({ name:'Olive oil' }, { store:'s2' });
    const c = catalogFind('Olive oil');
    return { one: S.catalog.filter(x => !x.deleted).length, count: c.count,
      s1: c.stores.s1.n, s2: c.stores.s2.n, cat: c.cat };
  });
  ok('recordCatalog: sloppy spellings land on ONE record', rec.one === 1, `${rec.one} records`);
  ok('recordCatalog: buying it again bumps the count', rec.count === 3, String(rec.count));
  ok('recordCatalog: per-store counts accumulate separately', rec.s1 === 2 && rec.s2 === 1, JSON.stringify(rec));
  ok('recordCatalog: a later sparse write keeps the known category', rec.cat === 'oil');

  const noBump = await page.evaluate(async () => {
    const before = catalogFind('Olive oil').count;
    await recordCatalog({ name:'Olive oil', image:'data:x' }, { bump:false });
    const c = catalogFind('Olive oil');
    return { same: c.count === before, gotImage: c.image === 'data:x' };
  });
  ok('recordCatalog: bump:false enriches without faking a purchase', noBump.same && noBump.gotImage);

  // ---- C. stock states drive the inline badge ----
  await seed();
  const st = await page.evaluate(async () => {
    S.items = [
      { id:'a', name:'Whole Milk', cat:'dairy-milk', loc:'uf', deleted:false, mode:'count', qty:4, expires:Date.now()+1e9, added:Date.now() },
      { id:'b', name:'Eggs', cat:'eggs', loc:'uf', deleted:false, mode:'count', qty:1, expires:Date.now()+1e9, added:Date.now() },
    ];
    await recordCatalog({ name:'Butter', cat:'dairy-butter' }, {});
    return { have: stockState('milk').state, low: stockState('eggs').state,
      out: stockState('Butter').state, unknown: stockState('Dragonfruit').state,
      typo: stockState('chedar').state };
  });
  ok('stockState: plenty in the house reads "have"', st.have === 'have', st.have);
  ok('stockState: down to the last one reads "low"', st.low === 'low', st.low);
  ok('stockState: bought before, none left reads "out"', st.out === 'out', st.out);
  ok('stockState: never seen stays silent ("new"), not a false "out"', st.unknown === 'new', st.unknown);

  // ---- D. restock shortlist: earned, not assumed ----
  await seed();
  const rs = await page.evaluate(async () => {
    await recordCatalog({ name:'Coffee' }, {});                      // bought once only
    await recordCatalog({ name:'Bananas' }, {}); await recordCatalog({ name:'Bananas' }, {});
    await recordCatalog({ name:'Rice' }, {}); await recordCatalog({ name:'Rice' }, {});
    S.items = [{ id:'r', name:'Rice', cat:'dry-pasta-rice', loc:'up', deleted:false, mode:'count', qty:3, expires:Date.now()+1e9, added:Date.now() }];
    const first = restockList().map(c => c.name);
    await addToList('Bananas');
    return { first, afterAdd: restockList().map(c => c.name) };
  });
  ok('restock: suggests a repeat buy you have none of', rs.first.includes('Bananas'), rs.first.join(','));
  ok('restock: stays quiet about a one-off purchase', !rs.first.includes('Coffee'), rs.first.join(','));
  ok('restock: never suggests something already in the pantry', !rs.first.includes('Rice'));
  ok('restock: drops off once it is on the list', !rs.afterAdd.includes('Bananas'), rs.afterAdd.join(','));

  // ---- E. store-scoped lists ----
  await seed();
  const stores = await page.evaluate(async () => {
    const a = await addStore('Costco'), b = await addStore('Greens Natural Foods');
    const dup = await addStore('costco');                       // same store, different case
    await addToList('Milk', '', a.id);
    await addToList('Milk', '', b.id);                          // same item, different errand
    await addToList('Milk', '', a.id);                          // true duplicate
    const costco = S.shopping.filter(s => !s.deleted && s.store === a.id).length;
    const greens = S.shopping.filter(s => !s.deleted && s.store === b.id).length;
    const n = storeList().length;                    // count BEFORE the removal below
    await removeStore(b.id);
    const orphan = S.shopping.find(s => !s.deleted && norm(s.name) === 'milk' && !s.store);
    return { n, after: storeList().length, dupSame: dup.id === a.id, costco, greens, orphaned: !!orphan };
  });
  ok('stores: adding two stores, case-insensitive dedupe', stores.n === 2 && stores.dupSame, JSON.stringify(stores));
  ok('stores: the same item on two store lists is two errands', stores.costco === 1 && stores.greens === 1);
  ok('stores: a real duplicate on one list is still rejected', stores.costco === 1);
  ok('stores: deleting a store keeps its lines, unassigned', stores.orphaned === true && stores.after === 1);

  // ---- F. the checklist: three honest outcomes ----
  await seed();
  const chk = await page.evaluate(async () => {
    const dlg = document.getElementById('dlg');
    await addToList('Sourdough');
    const s = S.shopping.find(x => /Sourdough/.test(x.name));
    S.view = 'shop'; render();

    shoppingToPantry(s);
    dlg.querySelector('[data-a=miss]').click();
    await new Promise(z => setTimeout(z, 40));
    const missed = { done: s.done, missing: s.missing, inCatalog: !!catalogFind('Sourdough') };

    // undo, then buy it for real
    s.done = false; s.missing = false; await saveShopping(s);
    shoppingToPantry(s);
    dlg.querySelector('[data-a=just]').click();
    await new Promise(z => setTimeout(z, 40));
    return { missed, bought: { done: s.done, missing: s.missing, count: catalogFind('Sourdough')?.count || 0 } };
  });
  ok('checklist: "they didn\'t have it" completes the line', chk.missed.done === true);
  ok('checklist: ...and flags it as a miss', chk.missed.missing === true);
  ok('checklist: a miss is NOT recorded as a purchase', chk.missed.inCatalog === false, JSON.stringify(chk.missed));
  ok('checklist: actually buying it does record the purchase', chk.bought.count === 1 && chk.bought.missing === false, JSON.stringify(chk.bought));

  // ---- G. Shop view: sections, and completed leaves the active list ----
  await seed();
  const shop = await page.evaluate(async () => {
    await addToList('Apples'); await addToList('Bread');
    const b = S.shopping.find(x => /Bread/.test(x.name));
    b.done = true; b.doneAt = Date.now(); await saveShopping(b);
    S.view = 'shop'; render();
    const txt = document.getElementById('app').textContent;
    // Scoped to the list itself: the per-store history below it is a
    // separate section and legitimately carries its own heading, the
    // same way "Bought" does.
    const sects = [...document.querySelectorAll('#shoplist .sect h3')].map(h => h.textContent);
    const hasHistory = !!document.querySelector('#shophist .sect h3');
    const tiles = document.querySelectorAll('#shoplist .tile').length;
    const doneTiles = document.querySelectorAll('#shoplist .tile.done').length;
    return { sects, hasHistory, tiles, doneTiles, hasApples: /Apples/.test(txt), hasDone: /Bought/.test(txt) };
  });
  // The active list carries no heading — it IS the screen. Only "Bought"
  // earns one, because it's a genuinely different state.
  ok('shop: the active list has no redundant heading above it',
    shop.sects.length === 1 && /Bought/.test(shop.sects[0]), shop.sects.join(' | '));
  ok('shop: bought items are still split out under their own heading',
    shop.hasDone && shop.hasApples);
  ok('shop: the store history renders below the list', shop.hasHistory);
  ok('shop: the checked item moved out of the active list', shop.doneTiles === 1 && shop.tiles === 2);

  // ---- H. tiles put the name ABOVE the photo ----
  const layout = await page.evaluate(() => {
    const t = document.querySelector('#shoplist .tile');
    if (!t) return null;
    const nm = t.querySelector('.tn').getBoundingClientRect();
    const ph = t.querySelector('.tp').getBoundingClientRect();
    return { nameTop: nm.top, photoTop: ph.top, photoH: ph.height, photoW: ph.width };
  });
  ok('tiles: the name sits above the photo', layout && layout.nameTop < layout.photoTop, JSON.stringify(layout));
  ok('tiles: the photo is large (>=100px tall), not a thumbnail',
    layout && layout.photoH >= 100, layout ? `${Math.round(layout.photoW)}x${Math.round(layout.photoH)}` : 'n/a');

  // ---- I. meal history ----
  await seed();
  const meals = await page.evaluate(async () => {
    await planMeal('2026-08-01', { name:'Taco night' });
    const afterPlan = catalogMeal('Taco night')?.count || 0;
    await recordCatalog({ name:'Taco night', kind:'meal' }, {});     // "I made this"
    await recordCatalog({ name:'taco nights', kind:'meal' }, {});    // same meal, sloppier
    const c = catalogMeal('Taco night');
    return { afterPlan, made: c.count, listed: catalogList('meal').length,
      notAProduct: catalogList('product').length };
  });
  ok('meals: planning records the meal without claiming you cooked it', meals.afterPlan === 0, String(meals.afterPlan));
  ok('meals: "I made this" counts, and spelling drift collapses', meals.made === 2, String(meals.made));
  ok('meals: meal history is separate from the grocery history',
    meals.listed === 1 && meals.notAProduct === 0, JSON.stringify(meals));

  // ---- J. search falls back to history instead of dead-ending ----
  await seed();
  const srch = await page.evaluate(async () => {
    await recordCatalog({ name:'Dark chocolate', cat:'snack' }, { store:'s1' });
    S.items = [{ id:'m', name:'Milk', cat:'dairy-milk', loc:'uf', deleted:false, mode:'count', qty:2, expires:Date.now()+1e9, added:Date.now() }];
    S.view = 'pantry'; S.q = 'chocolat';            // misspelled AND not in the house
    render();
    const txt = document.getElementById('app').textContent;
    S.q = '';
    return { noMatch: /No match/.test(txt), offersHistory: /bought this before/i.test(txt),
      namesIt: /Dark chocolate/.test(txt) };
  });
  ok('search: a miss says so plainly', srch.noMatch);
  ok('search: ...then offers what you have bought before', srch.offersHistory, JSON.stringify(srch));
  ok('search: typo-tolerant against history too ("chocolat")', srch.namesIt);

  // ---- K. voice tolerates mangled speech-to-text ----
  await seed();
  const voice = await page.evaluate(async () => {
    S.items = [{ id:'y', name:'Greek Yogurt', cat:'dairy-yogurt', loc:'uf', deleted:false, mode:'count', qty:2, expires:Date.now()+1e9, added:Date.now() }];
    await handleVoice('finished the yoghurt');      // British spelling out of the recogniser
    return { qty: S.items[0].qty };
  });
  ok('voice: "yoghurt" still finds "Greek Yogurt"', voice.qty === 1, `qty now ${voice.qty}`);

  // ---- L. tapping "Add" has to visibly do something ----
  await seed();
  const fb = await page.evaluate(async () => {
    await recordCatalog({ name:'Olive oil', cat:'oil' }, {});
    await recordCatalog({ name:'Dark chocolate', cat:'snack' }, {});
    const dlg = document.getElementById('dlg');
    catalogPicker({ kind:'product', onPick: async c => { await addToList(c.name); } });
    await new Promise(z => setTimeout(z, 60));

    const tiles = () => [...dlg.querySelectorAll('.tile')];
    const first = tiles()[0];
    const label = t => t.querySelector('.tc .lb').textContent;
    const before = { label: label(first), got: first.classList.contains('got'), open: dlg.open };

    first.querySelector('[data-a=chk]').click();
    await new Promise(z => setTimeout(z, 80));
    const after = { label: label(tiles()[0]), got: tiles()[0].classList.contains('got'),
      // the tick is a real stroke icon now, not a text glyph
      box: tiles()[0].querySelector('.tc .box svg') ? 'check' : '',
      popped: tiles()[0].querySelector('.tc .box').classList.contains('pop'),
      open: dlg.open, listed: S.shopping.filter(s => !s.deleted).length,
      doneBtn: dlg.querySelector('[data-a=c]').textContent };

    // tapping the same tile again must not add it twice
    tiles()[0].querySelector('[data-a=chk]').click();
    await new Promise(z => setTimeout(z, 60));
    const twice = S.shopping.filter(s => !s.deleted).length;

    // a second, different item keeps the sheet open too
    tiles()[1].querySelector('[data-a=chk]').click();
    await new Promise(z => setTimeout(z, 60));
    const second = { open: dlg.open, listed: S.shopping.filter(s => !s.deleted).length,
      doneBtn: dlg.querySelector('[data-a=c]').textContent };

    dlg.querySelector('[data-a=c]').click();
    await new Promise(z => setTimeout(z, 40));
    return { before, after, twice, second, closedByDone: !dlg.open };
  });
  ok('feedback: the button starts as an unchecked "Add"',
    fb.before.label === 'Add' && fb.before.got === false, JSON.stringify(fb.before));
  ok('feedback: tapping it ticks the box and says "Added ✓"',
    fb.after.box === 'check' && /Added/.test(fb.after.label) && fb.after.got === true, JSON.stringify(fb.after));
  ok('feedback: the tick is animated', fb.after.popped === true);
  ok('feedback: the item really did land on the list', fb.after.listed === 1);
  ok('feedback: the sheet STAYS OPEN so you can keep adding', fb.after.open === true);
  ok('feedback: tapping the same tile twice does not double-add', fb.twice === 1, String(fb.twice));
  ok('feedback: a second item adds without closing', fb.second.open === true && fb.second.listed === 2);
  ok('feedback: the Done button counts what you added', /2 added/.test(fb.second.doneBtn), fb.second.doneBtn);
  ok('feedback: Done is what closes it', fb.closedByDone === true);

  // a brand-new list line is highlighted so you can see where it went
  const flash = await page.evaluate(async () => {
    S.view = 'shop'; render();
    const inp = document.getElementById('sadd');
    inp.value = 'Paprika';
    document.querySelector('[data-a=add]').click();
    await new Promise(z => setTimeout(z, 120));
    const t = [...document.querySelectorAll('#shoplist .tile')].find(x => /Paprika/.test(x.textContent));
    return { found: !!t, flashed: !!t && t.classList.contains('added'), cleared: inp.value === '' };
  });
  ok('feedback: a typed item appears and is highlighted', flash.found && flash.flashed, JSON.stringify(flash));
  ok('feedback: the input clears itself for the next one', flash.cleared === true);

  // ---- M. removing a planned meal, without a 29px target over a file picker ----
  await seed();
  const rm = await page.evaluate(async () => {
    const dlg = document.getElementById('dlg');
    await planMeal(dayKey(new Date(today())), { name:'Taco night', emoji:'🌮' });
    S.view = 'plan'; render();
    const tile = document.querySelector('.day .tile');
    // The whole tile opens the options sheet — no tiny corner target, and no
    // competing tap area that opens a photo browser.
    tile.querySelector('.tt').click();
    await new Promise(z => setTimeout(z, 60));
    const sheet = { open: dlg.open, hasRemove: /Remove from the plan/.test(dlg.textContent),
      hasMade: /I made this/.test(dlg.textContent), hasMove: /Move to another day/.test(dlg.textContent),
      hasPhoto: /photo/i.test(dlg.textContent) };
    const btn = dlg.querySelector('[data-a=rm]');
    const box = btn.getBoundingClientRect();
    dlg.querySelector('[data-a=rm]').click();
    await new Promise(z => setTimeout(z, 120));
    return { sheet, tall: box.height, wide: box.width,
      gone: S.plan.filter(m => !m.deleted).length, domGone: !document.querySelector('.day .tile') };
  });
  ok('plan: tapping a meal opens its options', rm.sheet.open && rm.sheet.hasRemove, JSON.stringify(rm.sheet));
  ok('plan: the sheet offers made / photo / move / remove',
    rm.sheet.hasMade && rm.sheet.hasPhoto && rm.sheet.hasMove);
  ok('plan: Remove is a full-width, thumb-sized target (not a 29px corner)',
    rm.tall >= 44 && rm.wide >= 200, `${Math.round(rm.wide)}x${Math.round(rm.tall)}`);
  ok('plan: the meal is actually removed', rm.gone === 0 && rm.domGone === true);

  const undo = await page.evaluate(async () => {
    const t = document.querySelector('.toast');
    const btn = t && t.querySelector('button');
    if (btn) btn.click();
    await new Promise(z => setTimeout(z, 120));
    return { offered: !!btn, back: S.plan.filter(m => !m.deleted).length };
  });
  ok('plan: removal offers UNDO, and it puts the meal back',
    undo.offered === true && undo.back === 1, JSON.stringify(undo));

  // ---- N. "already on your list" shows up in the catalog ----
  await seed();
  const onlist = await page.evaluate(async () => {
    await recordCatalog({ name:'Olive oil', cat:'oil' }, {});
    const before = statusPills('Olive oil');
    await addToList('Olive oil');
    const after = statusPills('Olive oil');
    // typo-tolerant: the catalog entry and the list line don't have to match exactly
    await recordCatalog({ name:'Dark chocolate', cat:'snack' }, {});
    await addToList('dark chocolat');
    return { before, after, onList: listState('Olive oil').on,
      fuzzy: listState('Dark chocolate').on, notOn: listState('Bananas').on };
  });
  ok('catalog: says nothing about a list before you add it', !/On list/.test(onlist.before), onlist.before);
  ok('catalog: shows "On list" once it is on one', /On list/.test(onlist.after), onlist.after);
  ok('catalog: the list check is typo-tolerant', onlist.fuzzy === true);
  ok('catalog: does not claim unrelated things are on the list', onlist.notOn === false);

  const guard2 = await page.evaluate(async () => {
    const dlg = document.getElementById('dlg');
    S.view = 'shop'; render();
    catalogPicker({ kind:'product', onPick: async c => { await addToList(c.name); } });
    await new Promise(z => setTimeout(z, 60));
    const t = [...dlg.querySelectorAll('.tile')].find(x => /Olive oil/.test(x.textContent));
    const label = t.querySelector('.tc .lb').textContent;
    const before = S.shopping.filter(s => !s.deleted).length;
    t.querySelector('[data-a=chk]').click();
    await new Promise(z => setTimeout(z, 60));
    const after = S.shopping.filter(s => !s.deleted).length;
    dlg.close();
    return { label, before, after, preChecked: t.classList.contains('done') || t.classList.contains('got') };
  });
  ok('catalog: an item already on the list reads "Already on it"', /Already on it/.test(guard2.label), guard2.label);
  ok('catalog: and tapping it cannot add a second copy', guard2.after === guard2.before, JSON.stringify(guard2));

  // ---- O. Cook keeps a catalog of every meal ever made ----
  await seed();
  const made = await page.evaluate(async () => {
    await recordCatalog({ name:'Chicken curry', kind:'meal' }, {});
    await recordCatalog({ name:'Chicken curry', kind:'meal' }, {});
    await recordCatalog({ name:'Taco night', kind:'meal' }, {});
    S.view = 'cook'; S.cookTab = 'made'; S.mq = ''; render();
    const txt = document.getElementById('app').textContent;
    // Scope to #app — a closed <dialog> keeps its tiles in the DOM.
    const tiles = document.querySelectorAll('#app .tile').length;
    S.mq = 'curyy';                                   // misspelled on purpose
    render();
    const searched = [...document.querySelectorAll('#app .tile .tn')].map(n => n.textContent);
    S.mq = '';
    // meta reads "2× · today" — the count plus when it was last cooked
    return { tab: /Made\s*·\s*2/.test(txt), tiles, counted: /2×\s*·/.test(txt), searched };
  });
  ok('cook: a "Made" tab counts every distinct meal cooked', made.tab === true, JSON.stringify({tab:made.tab}));
  ok('cook: it lists them with how often you made each', made.tiles === 2 && made.counted === true);
  ok('cook: searching it tolerates typos ("curyy")',
    made.searched.length === 1 && /curry/i.test(made.searched[0]), made.searched.join(','));

  const forget = await page.evaluate(async () => {
    const c = catalogList('meal').find(x => /Taco/.test(x.name));
    await forgetCatalog(c);
    return { left: catalogList('meal').length, stillInDb: (await DB.all('catalog')).find(x => x.id === c.id)?.deleted };
  });
  ok('cook: you can forget a meal out of the history', forget.left === 1);
  ok('cook: forgetting soft-deletes so it syncs instead of resurrecting', forget.stillInDb === true);

  // ---- P. the general list, and cross-list duplicate warning ----
  await seed();
  const gen = await page.evaluate(async () => {
    const a = await addStore('Costco');
    S.view = 'shop'; S.store = ''; render();
    const generalTitle = document.getElementById('title').textContent;
    const chip = [...document.querySelectorAll('[data-s]')].find(b => b.dataset.s === '').textContent;
    S.store = a.id; render();
    const storeTitle = document.getElementById('title').textContent;
    S.store = '';
    await addToList('Milk');                 // general
    await addToList('Milk', '', a.id);       // same thing, Costco run
    return { generalTitle, storeTitle, chip,
      both: S.shopping.filter(s => !s.deleted).length };
  });
  ok('shop: the default list is called the General shopping list',
    /General shopping list/.test(gen.generalTitle) && /General/.test(gen.chip), gen.generalTitle);
  ok('shop: picking a store renames the screen to that list', /Costco list/.test(gen.storeTitle), gen.storeTitle);
  ok('shop: the same item can sit on two lists (two real errands)', gen.both === 2);

  ok('no console or page errors', errs.length === 0, errs.slice(0, 3).join(' | '));

  await browser.close(); server.close();
  console.log(pass ? '\nALL CATALOG CHECKS PASS' : '\nFAILURES ABOVE');
  process.exit(pass ? 0 : 1);
})();
