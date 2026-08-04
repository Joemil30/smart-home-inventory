/* The store map: your list drawn as the walk.

   It reads the per-store aisle order that already existed, so the things
   worth protecting are the joins:
     1. The map's order IS the walking order — reordering the walk redraws
        the map, or the two views disagree about the same shop.
     2. Renaming an aisle is per store and never destroys the default.
     3. Every item on the list appears exactly once, in exactly one aisle.
        A map that silently drops a line is worse than no map.
     4. A store's colour and badge are stable, derived until overridden. */
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

  const LIST = ['Bananas', 'Baby spinach', 'Sourdough', 'Chicken breast', 'Whole milk',
                'Cheddar', 'Basmati rice', 'Frozen peas', 'Paper towels'];

  await page.evaluate(async (LIST) => {
    S.household = { id:'household', locations:[{id:'uf',name:'Fridge',kind:'fridge'}],
      members:[{name:'Joe'}], staples:[], allergies:[], people:2,
      stores:[{ id:'cst', name:'Costco' }, { id:'grn', name:'Greens' }], aisleOrder:{}, aisleNames:{} };
    S.who = S.household.members[0];
    S.items = []; S.catalog = []; S.shopping = []; S.plan = []; S.saved = [];
    S.cfg = { autoPhotos:false, confirmActions:false };
    S.store = 'cst'; S.view = 'shop'; S.shopMap = true;
    welcomed = true;
    await saveHousehold();
    for (const n of LIST) await addToList(n, '', 'cst');
    render();
  }, LIST);

  /* ---- 1. everything on the list is on the map, exactly once ----------- */
  const laid = await page.evaluate(() => {
    const items = [...document.querySelectorAll('.amap .ai')].map(n => n.textContent);
    return { items, blocks: document.querySelectorAll('.amap .ab').length,
      heads: [...document.querySelectorAll('.amap .ah')].map(h => h.textContent.trim()) };
  });
  ok('every list line is on the map', LIST.every(n => laid.items.includes(n)),
    LIST.filter(n => !laid.items.includes(n)).join() || 'all present');
  ok('and none of them twice', laid.items.length === LIST.length, `${laid.items.length} vs ${LIST.length}`);
  ok('aisles are drawn as blocks', laid.blocks > 1, `n=${laid.blocks}`);
  ok('blocks are numbered in walking order',
    laid.heads[0].startsWith('1') && laid.heads[1].startsWith('2'), laid.heads.slice(0, 2).join(' | '));

  /* ---- 2. the map order IS the walking order --------------------------- */
  const reordered = await page.evaluate(async () => {
    const before = [...document.querySelectorAll('.amap .ah')].map(h => h.textContent.replace(/^\d+/, '').trim());
    // Push produce to the very end of this store's walk.
    const order = aisleOrder('cst').filter(a => a !== 'produce').concat('produce');
    await saveAisleOrder('cst', order);
    render();
    const after = [...document.querySelectorAll('.amap .ah')].map(h => h.textContent.replace(/^\d+/, '').trim());
    return { before, after };
  });
  ok('produce led the walk to begin with', /Produce/.test(reordered.before[0]), reordered.before[0]);
  ok('reordering the walk redraws the map',
    /Produce/.test(reordered.after[reordered.after.length - 1]), reordered.after.join(' | '));

  /* ---- 3. renaming is per store and reversible ------------------------- */
  const renamed = await page.evaluate(async () => {
    await saveAisleName('cst', 'produce', 'A2 · Fresh');
    render();
    const here = [...document.querySelectorAll('.amap .ah')].map(h => h.textContent).join(' | ');
    const other = aisleLabel('produce', 'grn');
    const general = aisleLabel('produce', '');
    await saveAisleName('cst', 'produce', '');            // reset
    return { here, other, general, back: aisleLabel('produce', 'cst') };
  });
  ok('a renamed aisle shows its new name', /A2 · Fresh/.test(renamed.here), renamed.here);
  ok('the rename does not leak to another store', renamed.other === 'Produce', renamed.other);
  ok('nor to the general list', renamed.general === 'Produce', renamed.general);
  ok('and resetting restores the default', renamed.back === 'Produce', renamed.back);

  /* ---- 4. store identity ---------------------------------------------- */
  const style = await page.evaluate(async () => {
    const a = storeStyle('cst'), b = storeStyle('grn');
    const stable = JSON.stringify(storeStyle('cst')) === JSON.stringify(a);
    const s = S.household.stores.find(x => x.id === 'cst');
    s.colour = '#123456'; s.badge = 'CO'; await saveHousehold();
    render();
    const head = document.querySelector('.maphead .mb');
    return { aBadge: a.badge, bBadge: b.badge, aColour: a.colour, stable,
      overridden: storeStyle('cst').colour, badgeShown: head?.textContent.trim() };
  });
  ok('a store badge defaults to its initial', style.aBadge === 'C' && style.bBadge === 'G',
    `${style.aBadge} / ${style.bBadge}`);
  ok('a derived colour is a real colour', /^#[0-9A-Fa-f]{6}$/.test(style.aColour), style.aColour);
  ok('and it is stable between calls', style.stable);
  ok('an explicit colour overrides the derived one', style.overridden === '#123456', style.overridden);
  ok('the map header shows the badge', style.badgeShown === 'CO', style.badgeShown);

  /* ---- 5. the map is only for a real shop ------------------------------ */
  const general = await page.evaluate(() => {
    S.store = ''; render();
    return { seg: !!document.querySelector('.seg'), map: !!document.querySelector('.amap') };
  });
  ok('the General list offers no map toggle', !general.seg);
  ok('...and does not draw one', !general.map);

  /* ---- 6. ticked-off items leave the walk ------------------------------ */
  const walked = await page.evaluate(async () => {
    S.store = 'cst'; S.shopMap = true; render();
    const before = document.querySelectorAll('.amap .ai').length;
    const s = S.shopping.find(x => x.name === 'Bananas');
    s.done = true; s.doneAt = Date.now(); await saveShopping(s);
    render();
    const items = [...document.querySelectorAll('.amap .ai')].map(n => n.textContent);
    return { before, after: items.length, hasBananas: items.includes('Bananas') };
  });
  ok('picking something up takes it off the walk', walked.after === walked.before - 1,
    `${walked.before} -> ${walked.after}`);
  ok('...and it is the right one that went', !walked.hasBananas);

  /* An empty list says so rather than drawing an empty grid. */
  const empty = await page.evaluate(async () => {
    for (const s of S.shopping) { s.deleted = true; await saveShopping(s); }
    render();
    return document.getElementById('shoplist').innerText;
  });
  ok('an empty list explains itself', /Nothing to walk for/.test(empty), empty.slice(0, 60));

  ok('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));

  await browser.close();
  server.close();
  console.log(pass ? '\nAll checks pass.' : '\nFailures above.');
  process.exit(pass ? 0 : 1);
})();
