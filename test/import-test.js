/* Import my-list.json into an app that already has a household + data, and
   prove: nothing local is lost, the stores/lines/history land correctly, and
   the imported names actually file themselves into sensible aisles. */
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

  const r = await page.evaluate(async () => {
    // A household that already exists, with settings worth not losing.
    S.household = { id:'household', locations:[{id:'uf',name:'Fridge',kind:'fridge'},{id:'up',name:'Pantry',kind:'pantry'}],
      members:[{name:'Joe'}], staples:['salt','olive oil'], allergies:['peanuts'], people:4,
      stores:[{ id:'mine', name:'Wegmans', emoji:'🏪' }], aisleOrder:{}, planSync:false };
    S.who = S.household.members[0];
    S.items = []; S.catalog = []; S.shopping = []; S.plan = []; S.saved = [];
    S.cfg = { autoPhotos:false }; welcomed = true;
    await saveHousehold();
    await addItem({ name:'My own milk', cat:'dairy-milk', loc:'uf', mode:'count', qty:1 });
    const beforeItems = S.items.length;

    const data = await (await fetch('my-list.json')).json();
    const applied = await applyBackup(data);

    const byName = n => S.catalog.find(c => c.name === n);
    const storeIdOf = n => storeList().find(s => s.name === n)?.id;
    const linesFor = n => S.shopping.filter(s => !s.deleted && s.store === storeIdOf(n)).map(s => s.name);

    return {
      applied,
      // local household survived
      people: S.household.people, allergies: S.household.allergies, staples: S.household.staples,
      locations: S.household.locations.length, member: S.household.members[0]?.name,
      keptOwnStore: !!storeIdOf('Wegmans'),
      ownItemKept: S.items.filter(i => !i.deleted).length === beforeItems,
      // seeded stores arrived
      stores: storeList().map(s => s.name),
      // history + counts
      catalogN: S.catalog.filter(c => !c.deleted).length,
      milkCount: byName('Milk')?.count, mushroomCount: byName('Mushrooms')?.count,
      rabeCount: byName('Broccoli rabe')?.count,
      // multi-store attribution: parsley bought at Greens AND ShopRite
      parsleyStores: Object.keys(byName('Flat leaf parsley')?.stores || {}).length,
      // to-get lines landed on the right lists
      costco: linesFor('Costco'), homeDepot: linesFor('Home Depot'),
      greens: linesFor('Greens'), maryKay: linesFor('Mary Kay').length,
      eggQty: S.shopping.find(s => s.name === 'Organic brown eggs')?.qty,
      // aisles resolve from the guessed categories
      aisles: {
        milk: aisleOf(byName('Milk')?.cat), bacon: aisleOf(byName('Bacon')?.cat),
        bananas: aisleOf(byName('Bananas')?.cat), frozenPeas: aisleOf(byName('Frozen peas')?.cat),
        paper: aisleOf(byName('Paper towels')?.cat),
      },
      meals: S.catalog.filter(c => catKind(c) === CAT_MEAL).length,
      junk: S.catalog.filter(c => /unemployment|mulligan|donations|web586915|^Fruit$/i.test(c.name)).length,
    };
  });

  ok('import: applied without error', typeof r.applied === 'number');
  ok('import: local household settings survive (people/allergies/staples)',
    r.people === 4 && r.allergies?.[0] === 'peanuts' && r.staples?.length === 2, JSON.stringify([r.people, r.allergies, r.staples]));
  ok('import: local shelves and members survive', r.locations === 2 && r.member === 'Joe');
  ok('import: a store you already had is kept', r.keptOwnStore === true);
  ok('import: an item you already had is kept', r.ownItemKept === true);
  ok('import: all seven shops arrive', r.stores.length === 8, r.stores.join(', '));
  ok('import: the purchase history lands', r.catalogN > 130, String(r.catalogN));
  ok('import: repeat buys carry a real count (milk 2, mushrooms 2, rabe 3)',
    r.milkCount === 2 && r.mushroomCount === 2 && r.rabeCount === 3,
    JSON.stringify([r.milkCount, r.mushroomCount, r.rabeCount]));
  ok('import: something bought at two shops remembers both', r.parsleyStores === 2, String(r.parsleyStores));
  ok('import: unchecked lines become the Costco to-get list', r.costco.length === 4, r.costco.join(' | '));
  ok('import: Home Depot keeps its own list', r.homeDepot.length === 3, r.homeDepot.join(' | '));
  ok('import: Greens keeps its own list', r.greens.join() === 'Wraps', r.greens.join(' | '));
  ok('import: the Mary Kay order lands intact', r.maryKay === 8, String(r.maryKay));
  ok('import: a quantity in the source survives ("3x" eggs)', r.eggQty === '3', String(r.eggQty));
  ok('import: names file into sensible aisles',
    r.aisles.milk === 'dairy' && r.aisles.bacon === 'meat' && r.aisles.bananas === 'produce' &&
    r.aisles.frozenPeas === 'frozen' && r.aisles.paper === 'household', JSON.stringify(r.aisles));
  ok('import: the wrap order is kept as meals, not 14 shopping lines', r.meals === 2, String(r.meals));
  ok('import: phone numbers and errands are not imported as food', r.junk === 0, String(r.junk));
  ok('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));

  await browser.close(); server.close();
  console.log(pass ? '\nALL IMPORT CHECKS PASS' : '\nFAILURES ABOVE');
  process.exit(pass ? 0 : 1);
})();
