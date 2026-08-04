/* URL actions — the thing that gives a web app Siri, share targets and
   home-screen shortcuts with no native code.

   The safety property is the one that matters most: a URL is clickable from
   anywhere, including a message someone else sent. So the contract is that
   URL actions can only ever ADD. Nothing reachable from a query string may
   consume, delete, toss or overwrite. These tests assert that directly, by
   trying. */
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
    S.household = { id:'household', locations:[{id:'uf',name:'Fridge',kind:'fridge'}],
      members:[{name:'Joe'}], staples:[], allergies:[], people:2,
      stores:[{ id:'cst', name:'Costco' }, { id:'grn', name:'Greens' }], aisleOrder:{} };
    S.who = S.household.members[0];
    S.items = []; S.catalog = []; S.shopping = []; S.plan = []; S.saved = [];
    S.cfg = { autoPhotos:false, confirmActions:false }; S.store = 'cst'; S.view = 'home';
    welcomed = true;
    await saveHousehold();
  });
  await setup();

  const run = qs => page.evaluate(async qs => {
    const acted = await runUrlAction(new URLSearchParams(qs));
    render();
    return { acted, view: S.view, store: S.store,
      list: S.shopping.filter(s => !s.deleted && !s.done).map(s => `${s.name}@${s.store || 'general'}`) };
  }, qs);

  /* ---- 1. adding ------------------------------------------------------- */
  let r = await run('add=milk');
  ok('?add puts something on the list', r.list.includes('milk@cst'), r.list.join());
  ok('...and jumps to the list', r.view === 'shop', r.view);
  ok('...and reports it acted', r.acted === true);

  r = await run('add=bread,eggs;rice');
  ok('several names in one link all land', ['bread','eggs','rice'].every(n => r.list.some(x => x.startsWith(n + '@'))),
    r.list.join());

  r = await run('add=milk');
  ok('adding the same thing twice does not duplicate',
    r.list.filter(x => x === 'milk@cst').length === 1, r.list.join());

  /* ---- 2. store targeting ---------------------------------------------- */
  r = await run('store=Greens&add=kale');
  ok('?store sends it to the named shop', r.list.includes('kale@grn'), r.list.join());
  ok('...matched case-insensitively', r.store === 'grn', r.store);

  r = await run('store=Nowhere&add=quinoa');
  ok('an unknown shop falls back rather than failing',
    r.list.some(x => x.startsWith('quinoa@')), r.list.join());

  /* ---- 3. navigation --------------------------------------------------- */
  for (const [q, v] of [['view=soon','soon'], ['view=map','map'], ['view=calendar','calendar'],
                        ['view=insights','insights'], ['go=pantry','pantry'], ['view=list','shop']]) {
    const got = await run(q);
    ok(`?${q} opens ${v}`, got.view === v, got.view);
  }
  const bogus = await run('view=definitely-not-a-screen');
  ok('an unknown view is ignored, not crashed into', bogus.acted === false, String(bogus.acted));

  /* ---- 4. THE SAFETY PROPERTY: URLs can only add ------------------------ */
  const destructive = await page.evaluate(async () => {
    const it = await addItem({ name:'Precious', cat:'produce-root', loc:'uf', qty:5 });
    const before = { qty: it.qty, items: S.items.filter(i => !i.deleted).length,
      list: S.shopping.filter(s => !s.deleted).length };
    // Everything a hostile link might plausibly try.
    for (const qs of ['delete=Precious', 'deplete=Precious', 'toss=Precious', 'remove=Precious',
                      'use=Precious', 'clear=1', 'wipe=1', 'reset=1', 'qty=0',
                      'view=set&delete=all', 'add=', 'store=']) {
      await runUrlAction(new URLSearchParams(qs));
    }
    const now = S.items.find(i => i.id === it.id);
    return { before, qty: now.qty, deleted: !!now.deleted, wasted: !!now.wasted,
      items: S.items.filter(i => !i.deleted).length,
      list: S.shopping.filter(s => !s.deleted).length,
      household: !!S.household };
  });
  ok('no URL can reduce a quantity', destructive.qty === destructive.before.qty,
    `${destructive.before.qty} -> ${destructive.qty}`);
  ok('no URL can delete an item', !destructive.deleted);
  ok('no URL can mark something wasted', !destructive.wasted);
  ok('no URL can empty the pantry', destructive.items === destructive.before.items,
    `${destructive.before.items} -> ${destructive.items}`);
  ok('no URL can empty the shopping list', destructive.list === destructive.before.list,
    `${destructive.before.list} -> ${destructive.list}`);
  ok('no URL can destroy the household', destructive.household);

  /* An empty add is a no-op, not an item called "". */
  const blank = await page.evaluate(async () => {
    const before = S.shopping.filter(s => !s.deleted).length;
    await runUrlAction(new URLSearchParams('add=%20%20'));
    return { before, after: S.shopping.filter(s => !s.deleted).length };
  });
  ok('a blank ?add adds nothing', blank.after === blank.before, `${blank.before} -> ${blank.after}`);

  /* A very long link can't be used to flood the list. */
  const flood = await page.evaluate(async () => {
    S.shopping = [];
    const many = Array.from({ length: 200 }, (_, i) => `spam${i}`).join(',');
    await runUrlAction(new URLSearchParams('add=' + many));
    return S.shopping.filter(s => !s.deleted).length;
  });
  ok('a huge link is capped rather than flooding the list', flood <= 20, `n=${flood}`);

  /* ---- 5. the share target lands somewhere useful ----------------------- */
  const shared = await page.evaluate(async () => {
    const r = await runUrlAction(new URLSearchParams('url=https%3A%2F%2Fexample.com%2Fchili'));
    const dlg = document.getElementById('dlg');
    const val = dlg.querySelector('#rurl')?.value;
    dlg.close();
    return { r, view: S.view, val };
  });
  ok('a shared link opens the recipe importer', shared.r === true && shared.view === 'cook',
    `${shared.r} / ${shared.view}`);
  ok('...with the link already filled in', shared.val === 'https://example.com/chili', shared.val);

  const sharedText = await page.evaluate(async () => {
    await runUrlAction(new URLSearchParams('text=Beans%20on%20toast%3A%20beans%2C%20toast'));
    const dlg = document.getElementById('dlg');
    const val = dlg.querySelector('#rtext')?.value;
    dlg.close();
    return val;
  });
  ok('shared plain text goes to the paste box', /Beans on toast/.test(sharedText || ''), sharedText);

  /* ---- 6. the manifest declares it ------------------------------------- */
  const mf = await page.evaluate(async () => (await (await fetch('manifest.webmanifest')).json()));
  ok('manifest declares a share target', !!mf.share_target, JSON.stringify(mf.share_target || {}));
  ok('share target reads title, text and url',
    ['title','text','url'].every(k => mf.share_target?.params?.[k]), JSON.stringify(mf.share_target?.params));
  ok('manifest offers home-screen shortcuts', (mf.shortcuts || []).length === 3, String((mf.shortcuts || []).length));
  ok('every shortcut points at a real view',
    (mf.shortcuts || []).every(s => /\?view=(list|soon|map)$/.test(s.url)),
    (mf.shortcuts || []).map(s => s.url).join());

  ok('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));

  await browser.close();
  server.close();
  console.log(pass ? '\nAll checks pass.' : '\nFailures above.');
  process.exit(pass ? 0 : 1);
})();
