/* Turn the old markdown shopping list into a Stocked seed file.
   Runs the real app in a browser and calls its own addStore/addToList/
   recordCatalog, so categories, aisles and record shapes are whatever the
   app itself would have produced — not a hand-written guess at its schema.

   Checked [x] lines are PURCHASE HISTORY -> catalog records (count = how many
   times that name appeared), which is what feeds "Buy it again", restock
   hints and aisle sorting. Unchecked [ ] lines are things still to get ->
   live shopping-list lines on that store's list. */
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

/* buy: still to get.  had: bought before — [name, timesItAppeared]. */
const LISTS = [
  { store: 'Costco', emoji: '🏪',
    buy: ['OEM brake pads and rotors', 'Honey citron ginger tea', 'Small champagne cups', ['Organic brown eggs', 3]],
    had: [
      ['Grass fed beef sticks (Kirkland)',1], ['Pomegranate juice',1], ['Organic shrimp, tail off',1],
      ['Organic chicken breast',2], ['Milk',2], ['Mini cucumbers',1], ['Organic blueberries',1],
      ['Cocoa powder',1], ['Salted mixed nuts',1], ['Siete grain free chips',1], ['Sugar',1],
      ['Mushrooms',2], ['Garlic powder',1], ['Avocados',2], ['Golden potatoes',1],
      ['Ground beef 85/15',1], ['Hydro strawberries',1], ['Brown eggs',1], ['Organic orange juice',2],
      ['Chickpeas',1], ['Frozen chicken',2], ['Toilet paper',1], ['Heavy cream',1], ['Black pepper',1],
      ['Romaine lettuce',1], ['Lactaid milk',1], ['Oat milk',1], ['Double quiche',1], ['Strawberries',1],
      ['Tru bars',1], ['Tru bars (cookies and cream)',1], ['Coconut water 1.5L',1], ['Almond flour',1],
      ['Parmigiano Reggiano',1], ['Micro greens',1], ['Blackberries',1], ['MiraLAX',1],
      ['Frozen GF chicken tenders (Real Good)',1], ['Magnesium glycinate',1], ['Saran wrap',1],
      ['Ready patch',1], ['IQ Bars',1], ['Minoxidil',1], ['Frozen organic strawberries',1],
      ['Cranberry juice',1], ['Tissues',1], ['Brussels sprouts',1], ['Lamb chops',1], ['Organic peas',1],
      ['Tylenol',1], ['Unsalted cashews',1], ['White onions',2], ['Potatoes',1], ['Pellegrino',1],
      ['Lactase pills',1], ['Salmon',1], ['Shredded mozzarella',1], ['Bacon',2], ['Half and half',1],
      ['Carrots',1], ['Chicken bouillon',1], ['Blueberries',1], ['Mini crab cakes',1],
      ['Sliced steak',1], ['Raspberries',1], ['Greek yogurt',1], ['Frozen mangoes',2],
      ['Organic mangoes',1], ['Cara Cara oranges',1], ['Clams',1], ['Paper towels',1], ['Peppers',1],
      ['Brown sugar',1], ['Salt',1], ['Bananas',1], ['Rotisserie chicken',1], ['Chewy granola bars',1],
      ['Crab meat',1], ['Nasacort',1], ['Millet noodles',1], ['Lemons',1], ['White vinegar',1],
      ['Italian extra virgin olive oil',1], ['Hot turkey and provolone sandwich',1], ['Green beans',1],
      ['GF bread',1], ['Fresh mozzarella',1], ['Flowers',1], ['Eggplant',1], ['Dish soap',1],
      ['Dinner napkins',1], ['Dark chocolate quinoa crisps',1], ['Chocolate chips',1], ['Celery',1],
      ['Avocado oil',1], ['Arugula',1], ['All laundry detergent',1],
    ] },
  { store: 'Greens', emoji: '🥬',
    buy: ['Wraps'],
    had: [
      ['Garlic',1], ['Broccolini',1], ['Granny Smith apples',1], ['Ground beef',1],
      ['Sourdough bread',1], ['Flat leaf parsley',1], ['Cilantro',1], ['Lemon hummus',1],
      ['Red onion',1], ['Fresh ginger',1], ['Chocolate protein ice cream',1],
      ['Mint chip ice cream',1], ['Chicken salad',1], ['GF pancake mix',1],
    ] },
  { store: 'ShopRite', emoji: '🛒',
    buy: ['Grated cheese', 'Mustard', 'Relish', 'Pickle spice'],
    had: [
      ['No solicitation sign',1], ['Unbleached flour',1], ['Sliced chicken breast',1], ['Ketchup',1],
      ['Martini and Rossi Asti Spumante',1], ['Frozen peas',1], ['Broccoli rabe',3],
      ['Italian sausage',2], ['Chocolate covered eggs',1], ['Arborio rice',1], ['Flat leaf parsley',1],
      ['Pickles',1], ['Celery',1], ['Chopped clams',1], ['Espresso',1], ['Italian pasta',1],
      ['Orange juice',1], ['Artichokes',1], ['Organic chicken breast',1], ['Blueberries',1],
      ['Strawberries',1], ['Blackberries',1], ['Lentils',1], ['Golden raisins',1], ['Crisco',1],
      ['Mini chocolate chips',1], ['GF rice balls',1], ['Green beans',1],
    ] },
  { store: 'Restaurant Depot', emoji: '🏬',
    buy: ['Good fresh fish', 'Bison burger meat', 'Milk chocolate'],
    had: [
      ['Dark chocolate',1], ['Wild gulf shrimp',1], ['Organic strawberries',1], ['Pizza sauce',1],
      ['Cayenne pepper',1], ['Pecorino wheel',1], ['Basil',1], ['Pepperoni',1], ['Provolone',1],
      ['Mozzarella loaf',1],
    ] },
  { store: "Nonno's", emoji: '👨‍🍳',
    buy: ['Tupperware', 'Glass jars'],
    had: [['Sauce',1], ['Grated cheese',1], ['Orange tea',1]] },
  { store: 'Home Depot', emoji: '🔧',
    buy: ['Wire rack 55x15 + parts', 'Propane tank', 'Black plant tarp'], had: [] },
  { store: 'Mary Kay', emoji: '💄',
    buy: [['Oil free makeup remover', 3], 'Timewise 4-in-1 cleanser', 'Microdermabrasion tube',
          'Under eye corrector', ['Ultimate mascara, black', 3], 'Blush — shy blush',
          'Waterproof eyeliner, black', 'Waterproof eyeliner, steely'], had: [] },
];

/* The wrap order written under the Greens list — a spec for two sandwiches,
   not fourteen separate things to buy. Kept as meals so Plan/Cook can use it. */
const MEALS = [
  'Pesto blackened chicken wrap (lettuce, tomato, red onion, cucumber, avocado, extra Caesar)',
  'Turkey provolone wrap (lettuce, tomato, onion, cucumber, mayo)',
];

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await (await browser.newContext()).newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(base, { waitUntil: 'networkidle' });

  const out = await page.evaluate(async ({ LISTS, MEALS }) => {
    S.household = { id: 'household', locations: [], members: [], staples: [], people: 2, stores: [], aisleOrder: {} };
    S.items = []; S.catalog = []; S.shopping = []; S.plan = []; S.saved = [];
    S.cfg = {}; welcomed = true;

    // Spread the history back over the past few months so "recent" ordering
    // isn't a single flat timestamp — last-bought is what floats staples up.
    const DAY = 86400000;
    let n = 0;
    for (const L of LISTS) {
      const st = await addStore(L.store, L.emoji);
      for (const [name, times] of L.had) {
        for (let i = 0; i < times; i++) {
          await recordCatalog({ name, kind: CAT_PRODUCT, cat: guessCat(name) },
            { store: st.id, at: Date.now() - (14 + (n % 90)) * DAY, bump: true });
          n++;
        }
      }
      for (const entry of L.buy) {
        const [name, qty] = Array.isArray(entry) ? entry : [entry, ''];
        await addToList(name, qty ? String(qty) : '', st.id);
      }
    }
    for (const m of MEALS)
      await recordCatalog({ name: m, kind: CAT_MEAL }, { at: Date.now() - 30 * DAY, bump: true });

    const data = await backupData();
    data.seed = true;              // fold stores in; never overwrite a real household
    return { data, catalog: S.catalog.length, shopping: S.shopping.length, stores: storeList().length };
  }, { LISTS, MEALS });

  fs.writeFileSync(path.join(ROOT, 'my-list.json'), JSON.stringify(out.data, null, 1));
  console.log('catalog records :', out.catalog);
  console.log('to-get lines    :', out.shopping);
  console.log('stores          :', out.stores);
  console.log('page errors     :', errs.length ? errs.slice(0, 3) : 'none');
  console.log('wrote my-list.json',
    (fs.statSync(path.join(ROOT, 'my-list.json')).size / 1024).toFixed(1) + ' KB');

  await browser.close(); server.close();
})();
