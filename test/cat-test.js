/* guessCat: the substring collisions that sent real products to the wrong
   aisle, plus the compounds where the specific phrase has to beat its parts. */
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

/* [name, expected AISLE] — the aisle is what the user actually sees. */
const CASES = [
  // the substring collisions that were live bugs
  ['Dark chocolate',            'snacks'],     // "cola" inside chocolate -> was Drinks
  ['Chocolate protein ice cream','frozen'],
  ['Eggplant',                  'produce'],    // "egg" inside eggplant -> was Dairy
  ['Unbleached flour',          'pantry'],     // "bleach" inside unbleached -> was Household
  ['Coconut water 1.5L',        'drinks'],     // "nut" inside coconut -> was Pantry
  ['Pepperoni',                 'meat'],       // "pepper" inside pepperoni -> was Produce
  ['Saran wrap',                'household'],  // "wrap" -> was a tortilla
  ['Chickpeas',                 'cans'],       // "peas" inside chickpeas
  // found by the store map putting these in visibly wrong aisles
  ['Tortilla chips',            'snacks'],     // "tortilla" -> was Bakery
  ['Potato chips',              'snacks'],     // "potato" -> was Produce
  ['Tinned tomatoes',           'cans'],       // "tomato" -> was Produce
  ['Canned chickpeas',          'cans'],
  ['Jarred roasted peppers',    'cans'],       // "pepper" -> was Produce

  // compounds: the specific phrase must beat its parts
  ['Avocado oil',               'pantry'],
  ['Cranberry juice',           'drinks'],
  ['Organic orange juice',      'drinks'],
  ['Orange tea',                'pantry'],
  ['Honey citron ginger tea',   'pantry'],
  ['Chicken salad',             'meat'],
  ['Chicken bouillon',          'pantry'],
  ['Cocoa powder',              'pantry'],
  ['Garlic powder',             'pantry'],
  ['Lemon hummus',              'cans'],
  ['Chocolate chips',           'pantry'],
  ['Siete grain free chips',    'snacks'],
  ['Almond flour',              'pantry'],
  ['Cream cheese',              'dairy'],
  ['Frozen peas',               'frozen'],
  ['Frozen organic strawberries','frozen'],
  ['Green beans',               'produce'],

  // coverage that simply did not exist before
  ['Fresh mozzarella',          'dairy'],
  ['Parmigiano Reggiano',       'dairy'],
  ['Pecorino wheel',            'dairy'],
  ['Provolone',                 'dairy'],      // on its own it's a cheese...
  ['Hot turkey and provolone sandwich', 'meat'], // ...but a sandwich is deli
  ['Heavy cream',               'dairy'],
  ['Half and half',             'dairy'],
  ['Flat leaf parsley',         'produce'],
  ['Basil',                     'produce'],
  ['Cilantro',                  'produce'],
  ['Black pepper',              'pantry'],
  ['Salt',                      'pantry'],
  ['Mushrooms',                 'produce'],
  ['Brussels sprouts',          'produce'],
  ['Artichokes',                'produce'],
  ['Granny Smith apples',       'produce'],
  ['Organic mangoes',           'produce'],
  ['Espresso',                  'pantry'],
  ['Pellegrino',                'drinks'],
  ['Martini and Rossi Asti Spumante', 'drinks'],
  ['Clams',                     'meat'],
  ['Mini crab cakes',           'meat'],
  ['Golden raisins',            'snacks'],
  ['Tru bars',                  'snacks'],
  ['Chewy granola bars',        'snacks'],
  ['Crisco',                    'pantry'],
  ['GF pancake mix',            'pantry'],
  ['Pickles',                   'cans'],
  ['Mint chip ice cream',       'frozen'],
  ['Toilet paper',              'household'],
  ['Dinner napkins',            'household'],
  ['All laundry detergent',     'household'],

  // things that were already right and must stay right
  ['Whole milk',                'dairy'],
  ['Brown eggs',                'dairy'],
  ['Bananas',                   'produce'],
  ['Baby spinach',              'produce'],
  ['Sourdough bread',           'bakery'],
  ['Wraps',                     'bakery'],
  ['Italian pasta',             'pantry'],
  ['Arborio rice',              'pantry'],
  ['Ground beef 85/15',         'meat'],
  ['Wild gulf shrimp',          'meat'],
  ['Rotisserie chicken',        'meat'],
  ['Pizza sauce',               'cans'],
  ['Ketchup',                   'cans'],
  ['Unsalted cashews',          'pantry'],
  ['Italian extra virgin olive oil', 'pantry'],
];

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await (await browser.newContext()).newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(base, { waitUntil: 'networkidle' });

  const got = await page.evaluate(cs => cs.map(([n]) => {
    const cat = guessCat(n);
    return [n, aisleOf(cat), cat];
  }), CASES);

  let pass = true, bad = 0;
  got.forEach(([n, aisle, cat], i) => {
    const want = CASES[i][1];
    const good = aisle === want;
    if (!good) { pass = false; bad++; console.log(`FAIL  ${n}  — wanted ${want}, got ${aisle} [${cat}]`); }
  });
  console.log(`${got.length - bad}/${got.length} names file into the right aisle`);
  if (errs.length) { pass = false; console.log('PAGE ERRORS:', errs.slice(0, 3).join(' | ')); }

  await browser.close(); server.close();
  console.log(pass ? '\nALL CATEGORY CHECKS PASS' : '\nFAILURES ABOVE');
  process.exit(pass ? 0 : 1);
})();
