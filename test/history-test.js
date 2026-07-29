/* Per-store history, the confirm layer, and history editing.

   The three things this protects, all of which are behaviour a user
   described wanting and would notice losing:
     1. Ticking something off a store's list puts it in THAT store's history.
     2. Confirmations actually gate the destructive paths (and the "just do
        it" setting actually turns them off).
     3. History records can be renamed, re-shopped, re-counted and deleted —
        including merging when a rename collides with an existing record. */
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

  // A household with two shops, so "per store" can actually be wrong.
  const setup = async () => page.evaluate(async () => {
    S.household = { id:'household', locations:[{id:'uf',name:'Fridge',kind:'fridge'},{id:'up',name:'Pantry',kind:'pantry'}],
      members:[{name:'Joe'}], staples:[], allergies:[], people:2,
      stores:[{ id:'cst', name:'Costco', emoji:'🏬' }, { id:'grn', name:'Greens', emoji:'🥬' }], aisleOrder:{} };
    S.who = S.household.members[0];
    S.items = []; S.catalog = []; S.shopping = []; S.plan = []; S.saved = [];
    S.cfg = { autoPhotos:false }; S.store = null; S.hq = ''; S.hAll = false;
    welcomed = true;
    await saveHousehold();
  });
  await setup();

  /* ---- 1. store scoping ---------------------------------------------- */
  const scope = await page.evaluate(async () => {
    await addToList('Rotisserie chicken', '', 'cst');
    await addToList('Lemon hummus', '', 'grn');
    // Tick both off the way the shop screen does — "bought, just remember it".
    for (const s of S.shopping.filter(x => !x.deleted)) {
      await recordCatalog({ name: s.name, cat: s.cat || guessCat(s.name) }, { store: s.store });
      s.done = true; s.doneAt = Date.now(); await saveShopping(s);
    }
    const names = st => catalogList(CAT_PRODUCT, { store: st }).map(c => c.name);
    return { costco: names('cst'), greens: names('grn'), general: names('').length };
  });
  ok('bought at Costco lands in Costco history', scope.costco.includes('Rotisserie chicken'));
  ok('Costco history excludes the Greens buy', !scope.costco.includes('Lemon hummus'), scope.costco.join());
  ok('bought at Greens lands in Greens history', scope.greens.includes('Lemon hummus'));
  ok('Greens history excludes the Costco buy', !scope.greens.includes('Rotisserie chicken'), scope.greens.join());
  ok('General history shows both', scope.general === 2, String(scope.general));

  /* Buying the same thing again bumps the one record, it doesn't duplicate. */
  const dupe = await page.evaluate(async () => {
    await recordCatalog({ name: 'Rotisserie chicken', cat: guessCat('Rotisserie chicken') }, { store: 'cst' });
    const hits = catalogList(CAT_PRODUCT, { store: 'cst' }).filter(c => c.name === 'Rotisserie chicken');
    return { rows: hits.length, count: hits[0]?.count };
  });
  ok('re-buying does not duplicate the history row', dupe.rows === 1, `rows=${dupe.rows}`);
  ok('re-buying bumps the count instead', dupe.count === 2, `count=${dupe.count}`);

  /* ---- 2. the shop screen renders history per tab --------------------- */
  const ui = await page.evaluate(async () => {
    S.view = 'shop'; S.store = 'cst'; render();
    const txt = () => document.getElementById('shophist')?.innerText || '';
    const costco = txt();
    S.store = 'grn'; render();
    const greens = txt();
    // General is last in the tab strip, and shows everything.
    S.store = ''; render();
    const chips = [...document.querySelectorAll('.chips [data-s]')].map(b => b.textContent.trim());
    return { costco, greens, general: txt(), chips };
  });
  ok('shop screen renders a history section', /history/i.test(ui.costco), ui.costco.slice(0, 60));
  ok('Costco tab history shows only Costco', ui.costco.includes('Rotisserie chicken') && !ui.costco.includes('Lemon hummus'));
  ok('Greens tab history shows only Greens', ui.greens.includes('Lemon hummus') && !ui.greens.includes('Rotisserie chicken'));
  ok('General tab history shows both', ui.general.includes('Rotisserie chicken') && ui.general.includes('Lemon hummus'));
  ok('General is the LAST tab, after the shops', ui.chips[ui.chips.length - 1] === 'General', ui.chips.join(' | '));

  /* ---- 3. confirmations gate the destructive paths -------------------- */
  const gated = await page.evaluate(async () => {
    S.cfg.confirmActions = true; await saveCfg();
    // A count-mode category on purpose: milk is a "level" item (qty is null
    // by design), which would make the qty assertions below meaningless.
    const it = await addItem({ name:'Carrots', cat:'produce-root', loc:'uf', qty:3 });

    // Decline: the dialog opens, we say no, nothing changes.
    const p = tapDeplete(it);
    await new Promise(r => setTimeout(r, 30));
    const opened = document.getElementById('cdlg').open;
    document.getElementById('cdlg').querySelector('[data-a=n]').click();
    const declined = await p;
    const qtyAfterNo = S.items.find(i => i.id === it.id).qty;

    // Accept: same dialog, we say yes, it actually deducts.
    const p2 = tapDeplete(it);
    await new Promise(r => setTimeout(r, 30));
    document.getElementById('cdlg').querySelector('[data-a=y]').click();
    await p2;
    const qtyAfterYes = S.items.find(i => i.id === it.id).qty;

    // Removing a line off the list asks too.
    const line = await addToList('Bananas', '', 'cst');
    const p3 = removeFromList(line);
    await new Promise(r => setTimeout(r, 30));
    const askedForRemove = document.getElementById('cdlg').open;
    document.getElementById('cdlg').querySelector('[data-a=n]').click();
    await p3;
    const stillOnList = S.shopping.some(s => s.id === line.id && !s.deleted);

    return { opened, declined, qtyAfterNo, qtyAfterYes, askedForRemove, stillOnList, id: it.id };
  });
  ok('using one opens a confirm', gated.opened);
  ok('declining returns null (not an undo)', gated.declined === null);
  ok('declining changes nothing', gated.qtyAfterNo === 3, `qty=${gated.qtyAfterNo}`);
  ok('accepting actually deducts', gated.qtyAfterYes === 2, `qty=${gated.qtyAfterYes}`);
  ok('removing a list line asks first', gated.askedForRemove);
  ok('declining keeps the line on the list', gated.stillOnList);

  const ungated = await page.evaluate(async id => {
    S.cfg.confirmActions = false; await saveCfg();
    const it = S.items.find(i => i.id === id);
    await tapDeplete(it);                    // must NOT open anything
    return { open: document.getElementById('cdlg').open, qty: S.items.find(i => i.id === id).qty };
  }, gated.id);
  ok('"just do it" setting skips the confirm', !ungated.open);
  ok('"just do it" still performs the action', ungated.qty === 1, `qty=${ungated.qty}`);

  /* Paths that already confirmed must not double-ask. */
  const noDouble = await page.evaluate(async () => {
    S.cfg.confirmActions = true; await saveCfg();
    const it = await addItem({ name:'Peppers', cat:'produce-hardy', loc:'uf', qty:2 });
    // deplete() itself must never block on a dialog: the cook sheet, receipt
    // review and barcode scans all drive it with nothing there to answer.
    await deplete(it, 'cooked');
    return { open: document.getElementById('cdlg').open, qty: S.items.find(i => i.id === it.id).qty };
  });
  ok('deplete() never opens a dialog (cook/receipt/scan paths)', !noDouble.open);
  ok('deplete() still deducts', noDouble.qty === 1, `qty=${noDouble.qty}`);

  /* ---- 4. history records are editable -------------------------------- */
  const edit = await page.evaluate(async () => {
    const before = catalogList(CAT_PRODUCT, { store: 'cst' }).find(c => c.name === 'Rotisserie chicken');
    // rename + re-shop + re-count, the three fields the editor exposes
    const renamed = await renameCatalog({ ...before, count: 9, stores: { grn: { n: 9, last: Date.now() } } }, 'Roast chicken');
    const inGreens = catalogList(CAT_PRODUCT, { store: 'grn' }).map(c => c.name);
    const inCostco = catalogList(CAT_PRODUCT, { store: 'cst' }).map(c => c.name);
    const oldGone = !catalogList(CAT_PRODUCT).some(c => c.name === 'Rotisserie chicken');
    return { name: renamed.name, count: renamed.count, inGreens, inCostco, oldGone };
  });
  ok('renaming a history record works', edit.name === 'Roast chicken');
  ok('the edited count sticks', edit.count === 9, `count=${edit.count}`);
  ok('re-assigning the shop moves it', edit.inGreens.includes('Roast chicken'));
  ok('and takes it out of the old shop', !edit.inCostco.includes('Roast chicken'), edit.inCostco.join());
  ok('the old name is gone, not left as a twin', edit.oldGone);

  /* Renaming onto an existing record merges the two histories. */
  const merge = await page.evaluate(async () => {
    await recordCatalog({ name: 'Whole milk', cat: 'dairy-milk' }, { store: 'cst' });
    await recordCatalog({ name: 'Whole milk', cat: 'dairy-milk' }, { store: 'cst' });   // count 2
    const stray = await recordCatalog({ name: 'Milk (whole)', cat: 'dairy-milk' }, { store: 'grn' });
    const merged = await renameCatalog(stray, 'Whole milk');
    const rows = catalogList(CAT_PRODUCT).filter(c => norm(c.name) === norm('Whole milk')).length;
    return { rows, count: merged.count, stores: Object.keys(merged.stores || {}).sort() };
  });
  ok('rename-onto-existing leaves ONE row', merge.rows === 1, `rows=${merge.rows}`);
  ok('...with both histories summed', merge.count === 3, `count=${merge.count}`);
  ok('...and both shops kept', merge.stores.join() === 'cst,grn', merge.stores.join());

  /* Manual add: history you type in, not history the app watched. */
  const manual = await page.evaluate(async () => {
    const rec = await recordCatalog({ name: 'Wheel of Pecorino', kind: CAT_PRODUCT, cat: guessCat('Wheel of Pecorino') }, { store: 'grn', bump: false });
    await saveCatalog({ ...rec, count: 12, stores: { grn: { n: 12, last: Date.now() } } });
    const hit = catalogList(CAT_PRODUCT, { store: 'grn' }).find(c => c.name === 'Wheel of Pecorino');
    // and meals, which have their own kind
    const meal = await recordCatalog({ name: 'Sunday gravy', kind: CAT_MEAL }, { bump: false });
    await saveCatalog({ ...meal, count: 30 });
    return { count: hit?.count, meals: catalogList(CAT_MEAL).map(c => `${c.name}:${c.count}`) };
  });
  ok('a hand-added product keeps its claimed count', manual.count === 12, `count=${manual.count}`);
  ok('a hand-added meal lands in meal history', manual.meals.includes('Sunday gravy:30'), manual.meals.join());

  /* Deleting is soft, so the change travels to the other phones. */
  const del = await page.evaluate(async () => {
    const c = catalogList(CAT_PRODUCT, { store: 'grn' }).find(x => x.name === 'Wheel of Pecorino');
    await forgetCatalog(c);
    const gone = !catalogList(CAT_PRODUCT, { store: 'grn' }).some(x => x.name === 'Wheel of Pecorino');
    const row = S.catalog.find(x => x.id === c.id);
    await saveCatalog({ ...row, deleted: false });                       // the toast's undo
    const back = catalogList(CAT_PRODUCT, { store: 'grn' }).some(x => x.name === 'Wheel of Pecorino');
    return { gone, tombstoned: !!row?.deleted, back };
  });
  ok('deleting removes it from history', del.gone);
  ok('deleting tombstones rather than dropping (so sync sees it)', del.tombstoned);
  ok('undo brings it back', del.back);

  /* ---- 5. the seed still merges cleanly ------------------------------- */
  await setup();
  const seeded = await page.evaluate(async () => {
    // A shop the user already made, with the same NAME but their own id.
    S.household.stores = [{ id: 'my-costco', name: 'Costco', emoji: '🏬' }];
    await saveHousehold();
    const data = await (await fetch('my-list.json')).json();
    await applyBackup(data);
    const cid = storeList().find(s => s.name === 'Costco').id;
    return {
      keptOwnId: cid === 'my-costco',
      oneCostco: storeList().filter(s => s.name === 'Costco').length,
      costcoHistory: catalogList(CAT_PRODUCT, { store: cid }).length,
      costcoLines: S.shopping.filter(s => !s.deleted && s.store === cid).length,
      locations: S.household.locations.length,
    };
  });
  ok('seed reuses the household\'s own Costco id', seeded.keptOwnId);
  ok('seed does not create a duplicate Costco', seeded.oneCostco === 1, `n=${seeded.oneCostco}`);
  ok('seeded history lands under the real store', seeded.costcoHistory > 50, `n=${seeded.costcoHistory}`);
  ok('seeded outstanding lines land on that store', seeded.costcoLines > 0, `n=${seeded.costcoLines}`);
  ok('seed never wipes the household\'s shelves', seeded.locations === 2, `n=${seeded.locations}`);

  ok('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));

  await browser.close();
  server.close();
  console.log(pass ? '\nAll checks pass.' : '\nFailures above.');
  process.exit(pass ? 0 : 1);
})();
