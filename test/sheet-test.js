/* Full-screen sheets + back arrow, drag-to-reorder aisles, contain (not
   cover) photos, and the photos/compact toggle reaching every tile grid. */
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
    S.cfg = { autoPhotos:false, shopView:'photos', pantryView:'grid' }; S.view = 'shop'; S.store = ''; S.q = ''; S.weekOff = 0; S.cookNow = false;
    welcomed = true; document.getElementById('welcomeOverlay')?.remove();
  });

  // ---- A. every sheet opens full-screen with a persistent back arrow ----
  await seed();
  const sheet = await page.evaluate(async () => {
    // MutationObserver callbacks are microtasks — they run once this
    // synchronous block yields, same as they'd run before the next real paint.
    const tick = () => new Promise(r => queueMicrotask(r));
    const costco = await addStore('Costco');
    storeSheet();
    await tick();
    const dlg = document.getElementById('dlg');
    const cs = getComputedStyle(dlg);
    const fullScreen = parseInt(cs.width) >= innerWidth - 2 && parseInt(cs.height) >= innerHeight - 2;
    const backPresent = !!dlg.querySelector('#dlgBack');
    dlg.close();
    // open a totally different sheet — the back button must survive the swap
    aisleOrderSheet(costco.id, () => {});
    await tick();
    const backSurvived = !!document.getElementById('dlg').querySelector('#dlgBack');
    document.getElementById('dlg').close();
    return { fullScreen, backPresent, backSurvived, radius: cs.borderRadius };
  });
  ok('sheet: the dialog fills the viewport, not a centered card', sheet.fullScreen === true);
  ok('sheet: a back arrow is present on the dialog', sheet.backPresent === true);
  ok('sheet: the back arrow survives a totally different sheet replacing the content', sheet.backSurvived === true);

  const backCloses = await page.evaluate(async () => {
    storeSheet();
    await new Promise(r => queueMicrotask(r));
    const dlg = document.getElementById('dlg');
    const wasOpen = dlg.open;
    dlg.querySelector('#dlgBack').click();
    return { wasOpen, closedAfter: !dlg.open };
  });
  ok('sheet: tapping the back arrow closes the sheet', backCloses.wasOpen && backCloses.closedAfter);

  // ---- B. drag-to-reorder aisles (alongside the arrows) ----
  await seed();
  const drag = await page.evaluate(async () => {
    const costco = await addStore('Costco');
    aisleOrderSheet(costco.id, () => {});
    const dlg = document.getElementById('dlg');
    const rows = [...dlg.querySelectorAll('.aisle-drag')];
    const draggable = rows.every(r => r.getAttribute('draggable') === 'true');
    const arrowsStillThere = !!dlg.querySelector('[data-up]') && !!dlg.querySelector('[data-dn]');
    const firstBefore = rows[0].querySelector('span:nth-child(2)').textContent;
    // simulate a drag of row 0 onto row 2
    const dt = { data: {}, effectAllowed: '', dropEffect: '', setData(k, v) { this.data[k] = v; }, getData(k) { return this.data[k]; } };
    rows[0].dispatchEvent(Object.assign(new Event('dragstart', { bubbles: true }), { dataTransfer: dt }));
    const target = dlg.querySelectorAll('.aisle-drag')[2];
    target.dispatchEvent(Object.assign(new Event('dragover', { bubbles: true, cancelable: true }), { dataTransfer: dt }));
    target.dispatchEvent(Object.assign(new Event('drop', { bubbles: true, cancelable: true }), { dataTransfer: dt }));
    const rowsAfter = [...document.getElementById('dlg').querySelectorAll('.aisle-drag')];
    const firstAfter = rowsAfter[0] ? rowsAfter[0].querySelector('span:nth-child(2)').textContent : null;
    document.getElementById('dlg').close();
    return { draggable, arrowsStillThere, firstBefore, firstAfter, moved: firstBefore !== firstAfter };
  });
  ok('aisle: rows are draggable', drag.draggable === true);
  ok('aisle: the up/down arrows still exist alongside drag', drag.arrowsStillThere === true);
  ok('aisle: dropping a row on another reorders the list', drag.moved === true, `${drag.firstBefore} -> ${drag.firstAfter}`);

  // ---- C. tile photos use contain, not cover — nothing gets cropped ----
  const fit = await page.evaluate(() => {
    const t = tileEl({ name: 'Test', image: 'data:image/svg+xml,<svg/>' });
    document.body.appendChild(t);
    // Two layers now: a blurred `cover` backdrop filling the bars, and the
    // real photo `contain`ed on top so nothing is ever cropped.
    const fg = t.querySelector('.tp img:not(.bg)');
    const bg = t.querySelector('.tp img.bg');
    const out = {
      fg: getComputedStyle(fg).objectFit,               // read while still attached
      bg: bg && getComputedStyle(bg).objectFit,
      bgHidden: bg && bg.getAttribute('aria-hidden'),
      sameSrc: bg && bg.getAttribute('src') === fg.getAttribute('src'),
    };
    t.remove();
    return out;
  });
  ok('tiles: the photo itself is contained, so nothing is cropped', fit.fg === 'contain', fit.fg);
  ok('tiles: a blurred copy fills the letterbox bars', fit.bg === 'cover' && fit.sameSrc === true, JSON.stringify(fit));
  ok('tiles: the decorative backdrop is hidden from screen readers', fit.bgHidden === 'true', String(fit.bgHidden));

  // ---- D. the photos/compact preference reaches every catalog tile grid ----
  await seed();
  const toggled = await page.evaluate(async () => {
    // "had before, not here now" — pantryHistory. Needs a live item too, or an
    // empty pantry short-circuits to the empty state before ever painting it.
    await addItem({ name: 'Bread', cat: 'bread', loc: 'up', mode: 'count', qty: 1 });
    await addItem({ name: 'Old Cheese', cat: 'dairy-cheese-hard', loc: 'up', mode: 'count', qty: 1 });
    const it = S.items.find(i => i.name === 'Old Cheese');
    it.deleted = true; await saveItem(it);
    await recordCatalog({ id: 'oldcheese', name: 'Old Cheese', kind: CAT_PRODUCT }, { bump: true });
    S.cfg.pantryView = 'grid';
    S.view = 'pantry'; render();
    const gridTiles = document.querySelectorAll('#app .tile').length;
    S.cfg.pantryView = 'list';
    S.view = 'pantry'; render();
    const listRows = document.querySelectorAll('#app .item').length;
    const listTiles = document.querySelectorAll('#app .tile').length;
    S.cfg.pantryView = 'grid';
    return { gridTiles, listRows, listTiles };
  });
  ok('pantry history: shows photo tiles when the preference is grid', toggled.gridTiles > 0, String(toggled.gridTiles));
  ok('pantry history: switches to compact rows when the preference is list', toggled.listRows > 0 && toggled.listTiles === 0,
    JSON.stringify(toggled));

  // ---- E. "Buy it again" honours the same preference, with its own toggle ----
  await seed();
  const picker = await page.evaluate(async () => {
    await recordCatalog({ id: 'p1', name: 'Bread', kind: CAT_PRODUCT }, { bump: true });
    S.cfg.pantryView = 'grid';
    catalogPicker({ kind: CAT_PRODUCT, store: '', onPick: async () => {} });
    const dlg = document.getElementById('dlg');
    const gridTiles = dlg.querySelectorAll('.tile').length;
    const hasToggle = !!dlg.querySelector('[data-a=vt]');
    dlg.querySelector('[data-a=vt]').click();
    // the toggle's handler is async (it awaits saveCfg's IndexedDB write)
    // before repainting — give it a moment to actually finish.
    await new Promise(r => setTimeout(r, 100));
    const listRows = dlg.querySelectorAll('.item').length;
    const listTiles = dlg.querySelectorAll('.tile').length;
    const prefFlipped = S.cfg.pantryView === 'list';
    dlg.close();
    return { gridTiles, hasToggle, listRows, listTiles, prefFlipped };
  });
  ok('buy-it-again: shows photo tiles to start', picker.gridTiles > 0, String(picker.gridTiles));
  ok('buy-it-again: offers a photos/compact toggle', picker.hasToggle === true);
  ok('buy-it-again: the toggle switches to compact rows in place', picker.listRows > 0 && picker.listTiles === 0,
    JSON.stringify(picker));
  ok('buy-it-again: the toggle persists the preference', picker.prefFlipped === true);

  ok('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));

  await browser.close(); server.close();
  console.log(pass ? '\nALL SHEET/DRAG/TILE CHECKS PASS' : '\nFAILURES ABOVE');
  process.exit(pass ? 0 : 1);
})();
