/* Backup must round-trip EVERYTHING, and the .html snapshot must genuinely
   open as a working app — that was the complaint: "it's no longer an app,
   just like 10 lines of code". */
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright');
const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html':'text/html', '.js':'text/javascript', '.webmanifest':'application/manifest+json', '.svg':'image/svg+xml', '.png':'image/png', '.json':'application/json' };

const serve = root => http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]);
  if (p === '/favicon.ico') { r.writeHead(204); return r.end(); }
  if (p === '/') p = '/index.html';
  const fp = path.join(root, p);
  if (!fp.startsWith(root) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
  fs.createReadStream(fp).pipe(r);
});

(async () => {
  const appSrv = serve(ROOT);
  await new Promise(r => appSrv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${appSrv.address().port}/`;
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errs = [];
  const noise = /openfoodfacts|themealdb|net::ERR|Failed to load resource|ERR_|zxing|sw\.js|manifest/i;
  page.on('pageerror', e => { if (!noise.test(e.message)) errs.push('pageerror: ' + e.message); });
  await page.goto(base, { waitUntil: 'networkidle' });

  let pass = true;
  const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${x ? '  — ' + x : ''}`); if (!c) pass = false; };

  // ---- seed a household with data in EVERY store ----
  await page.evaluate(async () => {
    S.household = { id:'household', locations:[{id:'uf',name:'Fridge',kind:'fridge'}],
      members:[{name:'Sam',emoji:'🦊'}], staples:['salt'], people:3, stores:[{id:'st1',name:'Costco',emoji:'🏬'}] };
    S.who = S.household.members[0];
    S.cfg = { autoPhotos:false, geminiKey:'AIza-SECRET-KEY', openaiKey:'sk-or-SECRET', pantryView:'grid' };
    S.items = []; S.catalog = []; S.shopping = []; S.plan = []; S.saved = [];
    welcomed = true; document.getElementById('welcomeOverlay')?.remove();
    await saveHousehold(); await saveCfg();
    await addItem({ name:'Whole milk', cat:'dairy-milk', loc:'uf', qty:2, store:'st1' });
    await addToList('Sourdough bread', '', 'st1');
    await planMeal('2026-08-04', { name:'Taco night', emoji:'🌮' });
    await saveRec({ id:'rec1', name:'Chicken curry', minutes:35, steps:['Cook it'], uses:[], missing:[], deleted:false });
    await recordCatalog({ name:'Olive oil', cat:'oil' }, { store:'st1' });
  });

  // ---- A. the export includes every store (plan + saved were dropped) ----
  const data = await page.evaluate(() => backupData());
  ok('backup: includes pantry items', (data.items || []).length === 1, `${(data.items||[]).length}`);
  ok('backup: includes the shopping list', (data.shopping || []).length === 1);
  ok('backup: includes the MEAL PLAN (was silently dropped)', (data.plan || []).length === 1, JSON.stringify((data.plan||[]).map(p=>p.name)));
  ok('backup: includes SAVED RECIPES (was silently dropped)', (data.saved || []).length === 1, JSON.stringify((data.saved||[]).map(p=>p.name)));
  ok('backup: includes the catalog history', (data.catalog || []).length >= 1);
  ok('backup: includes the household, stores and all', !!data.household && (data.household.stores || []).length === 1);
  ok('backup: carries settings forward', !!data.cfg && data.cfg.pantryView === 'grid');

  const raw = JSON.stringify(data);
  ok('backup: does NOT leak the Gemini key', !/AIza-SECRET-KEY/.test(raw));
  ok('backup: does NOT leak the OpenRouter key', !/sk-or-SECRET/.test(raw));

  // ---- B. wipe, then restore from the JSON ----
  const round = await page.evaluate(async d => {
    for (const s of ['items','catalog','shopping','plan','saved','log']) {
      for (const r of await DB.all(s)) await DB.del(s, r.id);
    }
    S.items = []; S.catalog = []; S.shopping = []; S.plan = []; S.saved = [];
    const empty = S.items.length + S.plan.length + S.saved.length;
    await applyBackup(d);
    return { empty, items: S.items.length, plan: S.plan.length, saved: S.saved.length,
      shopping: S.shopping.length, catalog: S.catalog.length,
      planName: S.plan[0]?.name, savedName: S.saved[0]?.name,
      keptKey: S.cfg.geminiKey === 'AIza-SECRET-KEY' };
  }, data);
  ok('restore: starts from a genuinely wiped app', round.empty === 0);
  ok('restore: brings pantry items back', round.items === 1);
  ok('restore: brings the meal plan back', round.plan === 1 && /Taco/.test(round.planName || ''), JSON.stringify(round));
  ok('restore: brings saved recipes back', round.saved === 1 && /curry/i.test(round.savedName || ''));
  ok('restore: brings the list and catalog back', round.shopping === 1 && round.catalog >= 1);
  ok("restore: this device's own API key survives the merge", round.keptKey === true);

  // ---- C. the .html snapshot is a whole app, not 10 lines ----
  const html = await page.evaluate(() => snapshotHTML());
  ok('snapshot: is a full HTML document', /<!doctype html/i.test(html) && /<\/body>/i.test(html));
  ok('snapshot: is substantial, not a stub', html.length > 100000, `${Math.round(html.length/1024)} KB`);
  ok('snapshot: carries the app source (render + views)', /function render\s*\(/.test(html) && /function viewShopping/.test(html));
  ok('snapshot: embeds the data payload', /id="shelflife-restore"/.test(html) && /Taco night/.test(html));
  ok('snapshot: still keeps keys out of the file', !/AIza-SECRET-KEY/.test(html) && !/sk-or-SECRET/.test(html));

  // ---- D. readBackup accepts both file shapes ----
  const parsed = await page.evaluate(async ([j, h]) => {
    const f = (txt, type, name) => new File([txt], name, { type });
    const a = await readBackup(f(j, 'application/json', 'b.json'));
    const b = await readBackup(f(h, 'text/html', 'b.html'));
    let threw = false;
    try { await readBackup(f('hello, not a backup', 'text/plain', 'x.txt')); } catch (e) { threw = true; }
    return { jsonItems: (a.items||[]).length, htmlItems: (b.items||[]).length,
      htmlPlan: (b.plan||[]).length, rejects: threw };
  }, [raw, html]);
  ok('restore: reads the JSON export', parsed.jsonItems === 1);
  ok('restore: reads data straight out of the .html snapshot', parsed.htmlItems === 1 && parsed.htmlPlan === 1, JSON.stringify(parsed));
  ok('restore: rejects a file that is not a backup', parsed.rejects === true);

  // ---- E. THE REAL TEST: open the snapshot standalone and use it ----
  // Served from an empty directory — no zxing, no sw, nothing but the file.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'slsnap-'));
  fs.writeFileSync(path.join(tmp, 'index.html'), html);
  const snapSrv = serve(tmp);
  await new Promise(r => snapSrv.listen(0, '127.0.0.1', r));
  const snapUrl = `http://127.0.0.1:${snapSrv.address().port}/`;

  const fresh = await browser.newContext();          // fresh profile: empty IndexedDB
  const p2 = await fresh.newPage();
  const errs2 = [];
  p2.on('pageerror', e => { if (!noise.test(e.message)) errs2.push(e.message); });
  await p2.goto(snapUrl, { waitUntil: 'load' });
  await p2.waitForTimeout(900);

  const opened = await p2.evaluate(() => ({
    items: S.items.length, plan: S.plan.length, saved: S.saved.length,
    house: !!S.household, stores: (S.household?.stores || []).length,
    shownName: document.getElementById('app')?.textContent || '',
    navThere: !!document.getElementById('nav'),
  }));
  ok('snapshot: opens standalone with the data already loaded',
    opened.items === 1 && opened.house === true, JSON.stringify({ ...opened, shownName: undefined }));
  ok('snapshot: the meal plan and saved recipes came with it', opened.plan === 1 && opened.saved === 1);
  ok('snapshot: the stores came with it', opened.stores === 1);
  // lands on the Home dashboard now, so assert on what Home actually shows
  ok('snapshot: it renders as the app, not raw text',
    opened.navThere && /Good (morning|afternoon|evening)/.test(opened.shownName) && /Items/.test(opened.shownName),
    JSON.stringify(opened.shownName.replace(/\s+/g, ' ').slice(0, 70)));

  // and it's actually usable — navigate and add something
  const usable = await p2.evaluate(async () => {
    S.view = 'shop'; render();
    const before = S.shopping.filter(s => !s.deleted).length;
    await addToList('Butter');
    render();
    return { before, after: S.shopping.filter(s => !s.deleted).length,
      shows: /Butter/.test(document.getElementById('app').textContent) };
  });
  ok('snapshot: it is a working app you can still add to',
    usable.after === usable.before + 1 && usable.shows, JSON.stringify(usable));
  ok('snapshot: no script errors when opened cold', errs2.length === 0, errs2.slice(0, 2).join(' | '));

  // ---- F. opening a snapshot must not silently clobber a live app ----
  const guard = await p2.evaluate(async () => {
    S.household = { id:'household', locations:[], members:[{name:'Someone'}], people:1 };
    S.items = [{ id:'keep', name:'Do not lose me', cat:'other', loc:'uf', deleted:false, mode:'count', qty:1, expires:Date.now()+1e9, added:Date.now() }];
    await loadSnapshotSeed();                       // second run, app already has data
    return { stillThere: S.items.some(i => i.id === 'keep'), count: S.items.length };
  });
  ok('snapshot: never overwrites an app that already has data', guard.stillThere === true, JSON.stringify(guard));

  ok('no page errors in the main app', errs.length === 0, errs.slice(0, 2).join(' | '));

  await browser.close(); appSrv.close(); snapSrv.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(pass ? '\nALL BACKUP CHECKS PASS' : '\nFAILURES ABOVE');
  process.exit(pass ? 0 : 1);
})();
