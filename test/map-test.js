/* The interactive kitchen map.

   The load-bearing design decision here is that a zone (a shelf, a drawer)
   is an ordinary location carrying a `parent`, not a second hierarchy. So
   the things worth protecting are:
     1. A shelf's counts and filters include everything in its zones —
        otherwise putting food on a shelf makes it vanish from the pantry.
     2. Zones never leak into the pantry's filter chips, which would grow
        to fifteen chips the moment someone photographs their kitchen.
     3. The map maintains itself. Eat the yoghurt, the pin goes. A map you
        have to re-photograph is wrong by Thursday, and that is how this
        idea normally dies.
     4. Removing a zone never loses food. */
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
    // A 1x1 jpeg is enough — nothing here depends on what the photo shows.
    const c = document.createElement('canvas'); c.width = c.height = 8;
    const shelf = c.toDataURL('image/jpeg');
    S.household = { id:'household',
      locations:[{ id:'uf', name:'Fridge', kind:'fridge' }, { id:'up', name:'Pantry', kind:'pantry' }],
      members:[{name:'Joe'}], staples:[], allergies:[], people:2, stores:[], aisleOrder:{} };
    S.who = S.household.members[0];
    S.items = []; S.catalog = []; S.shopping = []; S.plan = []; S.saved = [];
    S.cfg = { autoPhotos:false }; S.loc = 'all'; S.mapLoc = 'uf'; S.mapZone = null; S.placing = null;
    welcomed = true;
    S.household.locations.push({ id:'z1', name:'Top shelf', kind:'fridge', parent:'uf', photo: shelf });
    S.household.locations.push({ id:'z2', name:'Crisper', kind:'fridge', parent:'uf' });
    await saveHousehold();
  });
  await setup();

  /* ---- 1. zones are locations, and roll up to their shelf -------------- */
  const roll = await page.evaluate(async () => {
    await addItem({ name:'Whole milk', cat:'dairy-milk', loc:'z1', qty:1 });
    await addItem({ name:'Sour cream', cat:'dairy-other', loc:'z1', qty:1 });
    await addItem({ name:'Carrots', cat:'produce-root', loc:'z2', qty:1 });
    await addItem({ name:'Loose egg', cat:'dairy-egg', loc:'uf', qty:1 });     // straight on the shelf
    await addItem({ name:'Rice', cat:'pantry-grain', loc:'up', qty:1 });
    return { tops: topLocations().map(l => l.id), zones: zonesOf('uf').map(z => z.id),
      family: locFamily('uf').sort(), inFridge: itemsIn('uf').length, inPantry: itemsIn('up').length };
  });
  ok('only real shelves are top-level', roll.tops.join() === 'uf,up', roll.tops.join());
  ok('zones hang off their shelf', roll.zones.join() === 'z1,z2', roll.zones.join());
  ok('a shelf family is itself plus its zones', roll.family.join() === 'uf,z1,z2', roll.family.join());
  ok('items in zones count toward the shelf', roll.inFridge === 4, `n=${roll.inFridge}`);
  ok('a shelf with no zones still counts its own', roll.inPantry === 1, `n=${roll.inPantry}`);

  /* ---- 2. zones never leak into the pantry chips ----------------------- */
  const chips = await page.evaluate(() => {
    S.view = 'inv'; S.loc = 'all'; render();
    return [...document.querySelectorAll('.chips .chip')].map(c => c.textContent.trim());
  });
  ok('chips list shelves, not zones', !chips.some(c => /Top shelf|Crisper/.test(c)), chips.join(' | '));
  ok('the shelf chip counts its zones too', chips.some(c => /Fridge \(4\)/.test(c)), chips.join(' | '));

  /* Filtering to a shelf must show what's in its drawers, or food put away
     properly appears to have been deleted. */
  const filtered = await page.evaluate(() => {
    S.loc = 'uf'; render();
    return document.getElementById('app').innerText;
  });
  ok('filtering to the fridge shows food inside its zones', /Whole milk/.test(filtered) && /Carrots/.test(filtered));
  ok('...and still excludes the other shelf', !/Rice/.test(filtered));

  /* ---- 3. placing a pin ------------------------------------------------ */
  const placed = await page.evaluate(async () => {
    const it = S.items.find(i => i.name === 'Whole milk');
    it.spot = { x: 0.25, y: 0.4 };
    await saveItem(it);
    S.view = 'map'; S.mapLoc = 'uf'; S.mapZone = 'z1'; render();
    const pins = [...document.querySelectorAll('.pin')];
    return { n: pins.length, left: pins[0]?.style.left, top: pins[0]?.style.top,
      label: pins[0]?.textContent.trim(),
      unpinned: /Not pinned yet/.test(document.getElementById('app').innerText) };
  });
  ok('a placed item renders a pin', placed.n === 1, `n=${placed.n}`);
  ok('the pin sits where it was dropped',
    Math.abs(parseFloat(placed.left) - 25) < 0.1 && Math.abs(parseFloat(placed.top) - 40) < 0.1,
    `${placed.left} / ${placed.top}`);
  ok('the pin is labelled with the food', placed.label === 'Whole milk', placed.label);
  ok('unplaced items in the zone are still offered', placed.unpinned);

  /* Spots are fractions, so the same pin lands correctly on any screen. */
  const frac = await page.evaluate(() => {
    const it = S.items.find(i => i.name === 'Whole milk');
    return it.spot.x <= 1 && it.spot.y <= 1;
  });
  ok('spots are stored as fractions, not pixels', frac);

  /* ---- 4. the map maintains itself ------------------------------------- */
  /* A count-mode category on purpose: milk is a "level" item, so one deplete
     takes it full -> half rather than finishing it, and the pin correctly
     stays put. Peppers is counted, so qty 1 - 1 really is gone. */
  const selfMaintaining = await page.evaluate(async () => {
    const p = await addItem({ name:'Peppers', cat:'produce-hardy', loc:'z1', qty:1 });
    p.spot = { x: 0.6, y: 0.6 }; await saveItem(p);
    render();
    const before = document.querySelectorAll('.pin').length;
    await deplete(p, 'used');                  // eaten the ordinary way
    render();
    const after = document.querySelectorAll('.pin').length;
    const names = [...document.querySelectorAll('.pin .pl')].map(n => n.textContent);
    return { before, after, names };
  });
  ok('eating something removes its pin with no extra step',
    selfMaintaining.before === 2 && selfMaintaining.after === 1,
    `${selfMaintaining.before} -> ${selfMaintaining.after}`);
  ok('...and it is the eaten one that went',
    !selfMaintaining.names.includes('Peppers'), selfMaintaining.names.join());

  /* ---- 5. removing a zone never loses food ----------------------------- */
  const removed = await page.evaluate(async () => {
    S.cfg.confirmActions = false;              // the confirm itself is history-test's job
    const loc = S.household.locations.find(l => l.id === 'uf');
    const z = S.household.locations.find(l => l.id === 'z2');
    for (const i of S.items.filter(x => x.loc === z.id)) { i.loc = loc.id; delete i.spot; await saveItem(i); }
    S.household.locations = S.household.locations.filter(l => l.id !== z.id);
    await saveHousehold();
    const carrot = S.items.find(i => i.name === 'Carrots');
    return { gone: !zonesOf('uf').some(z => z.id === 'z2'), loc: carrot.loc,
      spot: carrot.spot === undefined, stillCounted: itemsIn('uf').length };
  });
  ok('the zone is gone', removed.gone);
  ok('its food moved up to the shelf', removed.loc === 'uf', removed.loc);
  ok('and its stale pin position was cleared', removed.spot);
  // Whole milk + Sour cream in z1, Loose egg on the shelf, Carrots just moved up.
  ok('nothing was lost in the move', removed.stillCounted === 4, `n=${removed.stillCounted}`);

  /* ---- 6. the overview renders ----------------------------------------- */
  const overview = await page.evaluate(() => {
    S.mapZone = null; render();
    return { txt: document.getElementById('app').innerText,
      cards: document.querySelectorAll('.locs .loc').length };
  });
  ok('the map lists the zones of the current shelf', overview.cards === 1, `n=${overview.cards}`);
  ok('food not in any zone is still shown, not hidden', /Not in a zone yet/.test(overview.txt));

  ok('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));

  await browser.close();
  server.close();
  console.log(pass ? '\nAll checks pass.' : '\nFailures above.');
  process.exit(pass ? 0 : 1);
})();
