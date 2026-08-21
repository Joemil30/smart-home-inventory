/* The permanent update control in Settings: reports the real installed
   version, answers "am I current?" honestly, and the clean-reinstall escape
   hatch must never take the user's data with it. */
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright');
const SRC = path.resolve(__dirname, '..');
const MIME = { '.html':'text/html', '.js':'text/javascript', '.svg':'image/svg+xml', '.png':'image/png', '.webp':'image/webp', '.webmanifest':'application/manifest+json', '.json':'application/json' };

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'upd-'));
for (const f of fs.readdirSync(SRC)) {
  const s = path.join(SRC, f);
  if (fs.statSync(s).isDirectory()) fs.cpSync(s, path.join(ROOT, f), { recursive:true });
  else fs.copyFileSync(s, path.join(ROOT, f));
}
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
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errs = [];
  const noise = /openfoodfacts|themealdb|net::ERR|Failed to load resource|ERR_/i;
  page.on('pageerror', e => { if (!noise.test(e.message)) errs.push(e.message); });

  let pass = true;
  const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${x ? '  — ' + x : ''}`); if (!c) pass = false; };

  await page.goto(base, { waitUntil: 'networkidle' });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload({ waitUntil: 'networkidle' });      // now genuinely worker-controlled

  const CUR = (fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8').match(/CACHE\s*=\s*'([^']+)'/) || [])[1];
  const VER = CUR.replace(/^.*?-(v\d+)$/, '$1');

  // ---- seed real data, then open Settings ----
  await page.evaluate(async () => {
    S.household = { id:'household', locations:[{id:'up',name:'Pantry',kind:'pantry'}], members:[{name:'Joe'}],
      staples:['salt'], people:4, stores:[], aisleOrder:{} };
    S.who = S.household.members[0];
    S.items = []; S.catalog = []; S.shopping = []; S.plan = []; S.saved = [];
    S.cfg = { theme:'dark' };
    welcomed = true; document.getElementById('welcomeOverlay')?.remove();
    await saveHousehold(); await saveCfg();
    await addItem({ name:'Precious Milk', cat:'dairy-milk', loc:'up', mode:'count', qty:2 });
    await addToList('Precious Eggs');
    S.view = 'set'; render();
  });

  const ui = await page.evaluate(() => ({
    heading: /App version/.test(document.getElementById('app').textContent),
    check: !!document.querySelector('#app [data-a=chk]'),
    hard: !!document.querySelector('#app [data-a=hard]'),
    saysData: /pantry, lists, history and settings are untouched/i.test(document.getElementById('app').textContent),
  }));
  ok('update: Settings has an App version section', ui.heading === true);
  ok('update: with a permanent Check for updates button', ui.check === true);
  ok('update: and a clean-reinstall escape hatch', ui.hard === true);
  ok('update: which promises the data is safe before you tap it', ui.saysData === true);

  // ---- it reports the version actually installed ----
  await page.waitForTimeout(500);
  const shown = await page.evaluate(() => document.querySelector('#app #vnow')?.textContent || '');
  ok('update: reports the version really on the device', shown.includes(VER), `${shown.trim()} (expected ${VER})`);

  // ---- checking when already current says so, and does NOT reload ----
  await page.evaluate(() => { window.__stillHere = true; document.querySelector('#app [data-a=chk]').click(); });
  await page.waitForFunction(() => !/Checking/.test(document.querySelector('#app #vst')?.textContent || 'Checking'), null, { timeout: 15000 });
  const res = await page.evaluate(() => ({
    text: document.querySelector('#app #vst')?.textContent || '',
    stillHere: window.__stillHere === true,
  }));
  ok('update: an up-to-date app says it is up to date', /Up to date/i.test(res.text), res.text.trim());
  ok('update: and does not pointlessly reload the page', res.stillHere === true);

  // ---- the reinstall keeps the user's data ----
  const before = await page.evaluate(async () => ({
    caches: await caches.keys(),
    items: S.items.filter(i => !i.deleted).map(i => i.name),
    shopping: S.shopping.filter(s => !s.deleted).map(s => s.name),
  }));
  ok('update: the shell is cached before the reinstall', before.caches.includes(CUR), before.caches.join(', '));

  await page.evaluate(() => hardRefresh());
  await page.waitForTimeout(600);
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.evaluate(() => navigator.serviceWorker.ready).catch(() => {});
  await page.waitForTimeout(800);

  const after = await page.evaluate(async () => {
    const DBx = await new Promise(res => { const r = indexedDB.open('coldroom'); r.onsuccess = () => res(r.result); r.onerror = () => res(null); });
    const all = store => new Promise(res => {
      try { const t = DBx.transaction(store).objectStore(store).getAll(); t.onsuccess = () => res(t.result); t.onerror = () => res([]); }
      catch (e) { res([]); }
    });
    return {
      caches: await caches.keys(),
      items: (await all('items')).filter(i => !i.deleted).map(i => i.name),
      shopping: (await all('shopping')).filter(s => !s.deleted).map(s => s.name),
      household: !!(await new Promise(res => {
        const t = DBx.transaction('meta').objectStore('meta').get('household');
        t.onsuccess = () => res(t.result); t.onerror = () => res(null);
      })),
    };
  });
  ok('update: the reinstall keeps every pantry item', after.items.includes('Precious Milk'), after.items.join(', '));
  ok('update: and the shopping list', after.shopping.includes('Precious Eggs'), after.shopping.join(', '));
  ok('update: and the household settings', after.household === true);
  ok('update: the app still works afterwards', await page.evaluate(() => !!document.getElementById('nav')));
  ok('update: and re-caches itself so it still opens offline', after.caches.some(k => /-v\d+$/.test(k)), after.caches.join(', '));

  ok('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));

  await browser.close(); server.close();
  fs.rmSync(ROOT, { recursive: true, force: true });
  console.log(pass ? '\nALL UPDATE-BUTTON CHECKS PASS' : '\nFAILURES ABOVE');
  process.exit(pass ? 0 : 1);
})();
