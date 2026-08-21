/* Recipe import, and the credentials that make a saved recipe worth keeping.

   The import has one honest constraint: a page served from github.io cannot
   fetch an arbitrary recipe site, because CORS forbids it. So the parts that
   must work are the ones that don't depend on the network reaching out:
     1. JSON-LD parsing, which is exact and free when the fetch DOES succeed.
     2. The paste path, which always works.
     3. Failing loudly and usefully when the browser refuses the fetch —
        "that site won't let an app read it" is actionable; "failed" is not.

   Times-cooked deliberately reads from the meal catalog rather than a
   counter on the recipe, so a meal cooked for years shows its real count the
   day the recipe is finally saved. */
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright');
const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html':'text/html', '.js':'text/javascript', '.svg':'image/svg+xml', '.png':'image/png', '.webmanifest':'application/manifest+json', '.json':'application/json' };

/* A page with real schema.org markup, served same-origin so the fetch is
   actually allowed — this is the happy path the code takes when a site
   permits it. */
const RECIPE_PAGE = `<!doctype html><html><head>
<script type="application/ld+json">
{"@context":"https://schema.org","@graph":[
 {"@type":"WebPage","name":"not the recipe"},
 {"@type":"Recipe","name":"Sunday Gravy","totalTime":"PT2H30M","recipeYield":"6",
  "image":{"url":"https://example.test/g.jpg"},
  "recipeIngredient":["2 lb pork ribs","1 onion, diced","800g tinned tomatoes"],
  "recipeInstructions":[{"@type":"HowToStep","text":"Brown the ribs."},
                        {"@type":"HowToStep","text":"Add the onion."},
                        {"@type":"HowToStep","text":"Simmer two hours."}]}]}
</script></head><body><h1>Sunday Gravy</h1></body></html>`;

const NO_RECIPE_PAGE = `<!doctype html><html><body><p>Just a blog post about pasta.</p></body></html>`;

const server = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]);
  if (p === '/favicon.ico') { r.writeHead(204); return r.end(); }
  if (p === '/fixture-recipe.html') { r.writeHead(200, { 'Content-Type':'text/html' }); return r.end(RECIPE_PAGE); }
  if (p === '/fixture-plain.html')  { r.writeHead(200, { 'Content-Type':'text/html' }); return r.end(NO_RECIPE_PAGE); }
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
      members:[{name:'Joe'}], staples:[], allergies:[], people:2, stores:[], aisleOrder:{} };
    S.who = S.household.members[0];
    S.items = []; S.catalog = []; S.shopping = []; S.plan = []; S.saved = [];
    S.cfg = { autoPhotos:false, confirmActions:false }; S.cookTab = 'saved'; S.view = 'cook';
    welcomed = true;
    await saveHousehold();
  });

  /* ---- 1. JSON-LD extraction ------------------------------------------ */
  const ld = await page.evaluate(async (base) => {
    const html = await (await fetch(base + 'fixture-recipe.html')).text();
    const node = jsonLdRecipe(html);
    return node ? recipeFromLd(node, base + 'fixture-recipe.html') : null;
  }, base);
  ok('a Recipe node is found inside an @graph', !!ld);
  ok('...and it is the Recipe, not the WebPage beside it', ld?.name === 'Sunday Gravy', ld?.name);
  ok('ISO durations become minutes', ld?.minutes === 150, `${ld?.minutes} min`);
  ok('yield becomes servings', ld?.servings === 6, String(ld?.servings));
  ok('every ingredient survives', ld?.uses.length === 3, JSON.stringify(ld?.uses));
  ok('quantities are kept, not stripped', /2 lb pork ribs/.test(ld?.uses[0] || ''), ld?.uses[0]);
  ok('HowToStep objects become plain steps', ld?.steps.length === 3 && ld.steps[0] === 'Brown the ribs.',
    JSON.stringify(ld?.steps));
  ok('the image object yields a url', ld?.image === 'https://example.test/g.jpg', String(ld?.image));
  ok('the source url is kept for attribution', /fixture-recipe/.test(ld?.source || ''), ld?.source);

  /* Malformed or recipe-less pages must return null, not throw. */
  const negatives = await page.evaluate(async (base) => {
    const plain = jsonLdRecipe(await (await fetch(base + 'fixture-plain.html')).text());
    const broken = jsonLdRecipe('<script type="application/ld+json">{ not json </script>');
    return { plain, broken, empty: jsonLdRecipe('') };
  }, base);
  ok('a page with no recipe returns nothing', negatives.plain === null);
  ok('unparseable JSON-LD does not throw', negatives.broken === null);
  ok('an empty document does not throw', negatives.empty === null);

  /* ---- 2. ISO duration edge cases -------------------------------------- */
  const durations = await page.evaluate(() => ({
    hm: isoMinutes('PT1H15M'), h: isoMinutes('PT2H'), m: isoMinutes('PT45M'),
    junk: isoMinutes('about an hour'), none: isoMinutes(null),
  }));
  ok('PT1H15M is 75 minutes', durations.hm === 75, String(durations.hm));
  ok('hours-only parses', durations.h === 120, String(durations.h));
  ok('minutes-only parses', durations.m === 45, String(durations.m));
  ok('prose returns 0 rather than NaN', durations.junk === 0, String(durations.junk));
  ok('null returns 0', durations.none === 0, String(durations.none));

  /* ---- 3. a fetch the browser refuses fails usefully -------------------- */
  const blocked = await page.evaluate(async (blockedUrl) => {
    importRecipeSheet();
    const dlg = document.getElementById('dlg');
    dlg.querySelector('#rurl').value = blockedUrl;
    dlg.querySelector('[data-a=url]').click();
    await new Promise(r => setTimeout(r, 250));
    const msg = dlg.querySelector('#rstat').innerText;
    dlg.close();
    return msg;
  }, base + 'blocked-recipe');
  ok('a blocked fetch explains what actually happened',
    /won't let an app read it/i.test(blocked), blocked.slice(0, 80));
  ok('...and points at the paste path', /paste/i.test(blocked), blocked.slice(0, 80));

  /* ---- 4. saving what was imported ------------------------------------- */
  const saved = await page.evaluate(async (ld) => {
    const rec = { id: uid(), name: ld.name, minutes: ld.minutes, servings: ld.servings,
      uses: ld.uses, missing: [], rescues: [], steps: ld.steps, image: ld.image,
      source: ld.source, rating: 0, deleted: false };
    await saveRec(rec);
    render();
    return { n: S.saved.filter(s => !s.deleted).length,
      onScreen: document.getElementById('app').innerText,
      host: sourceHost(rec.source) };
  }, ld);
  ok('an imported recipe lands in Saved', saved.n === 1, `n=${saved.n}`);
  ok('and shows on the Cook screen', /Sunday Gravy/.test(saved.onScreen));
  ok('the source is shown as a bare host', /127\.0\.0\.1/.test(saved.host), saved.host);
  ok('a junk source url does not crash the host parser',
    await page.evaluate(() => sourceHost('not a url')) === '');

  /* ---- 5. rating and times cooked -------------------------------------- */
  const cred = await page.evaluate(async () => {
    const rec = S.saved.find(s => !s.deleted);
    const before = timesCooked(rec.name);
    // cooked twice, logged the ordinary way through the meal catalog
    await recordCatalog({ name: rec.name, kind: CAT_MEAL }, {});
    await recordCatalog({ name: rec.name, kind: CAT_MEAL }, {});
    const after = timesCooked(rec.name);
    rec.rating = 4; await saveRec(rec);
    render();
    return { before, after, txt: document.getElementById('app').innerText,
      unknown: timesCooked('Something never cooked') };
  });
  ok('a brand new recipe has never been cooked', cred.before === 0, String(cred.before));
  ok('cooking it twice counts twice', cred.after === 2, String(cred.after));
  ok('the count comes from the meal history, not the recipe', cred.unknown === 0);
  ok('the card shows how often it was made', /made 2×/.test(cred.txt), cred.txt.slice(0, 120));
  ok('and shows the stars', /★★★★☆/.test(cred.txt), cred.txt.slice(0, 160));

  ok('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));

  await browser.close();
  server.close();
  console.log(pass ? '\nAll checks pass.' : '\nFailures above.');
  process.exit(pass ? 0 : 1);
})();
