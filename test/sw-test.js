/* The bug the user actually hit: an installed PWA keeps serving the shell it
   cached and never sees a new build. Simulate it end to end — install from a
   served copy, change index.html + bump the cache, reload, and assert the new
   worker takes over, re-caches, and the app offers the refresh. */
const http = require('http'), fs = require('fs'), path = require('path');
const os = require('os');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright');
const SRC = path.resolve(__dirname, '..');
const MIME = { '.html':'text/html', '.js':'text/javascript', '.svg':'image/svg+xml', '.png':'image/png', '.webp':'image/webp', '.webmanifest':'application/manifest+json', '.json':'application/json' };

// Serve from a scratch copy so we can mutate it mid-test without touching the repo.
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'swtest-'));
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

  let pass = true;
  const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${x ? '  — ' + x : ''}`); if (!c) pass = false; };

  // ---- first install ----
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForTimeout(400);

  const CUR = (fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8').match(/CACHE\s*=\s*'([^']+)'/) || [])[1];
  const NEXT = CUR.replace(/(\d+)$/, (_, n) => String(+n + 1));
  const first = await page.evaluate(async () => (await caches.keys()));
  ok('sw: installs the bumped cache', first.includes(CUR), first.join(', '));

  const noPromptOnFirstInstall = await page.evaluate(() => !document.querySelector('.toast'));
  ok('sw: a first install does not nag about an update', noPromptOnFirstInstall === true);

  // Reload so the page is genuinely controlled by the worker, like an installed PWA.
  await page.reload({ waitUntil: 'networkidle' });
  const controlled = await page.evaluate(() => !!navigator.serviceWorker.controller);
  ok('sw: the page is served by the worker on the next launch', controlled === true);

  // ---- ship a new build ----
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  fs.writeFileSync(path.join(ROOT, 'index.html'),
    html.replace('<main id="app"></main>', '<main id="app"></main><i id="NEWBUILD"></i>'));
  // Derive the current cache name and bump whatever number it ends with, so
  // renaming or re-versioning the cache can never silently no-op this step.
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const cur = sw.match(/CACHE\s*=\s*'([^']+)'/)[1];
  const next = cur.replace(/(\d+)$/, (_, n) => String(+n + 1));
  if (next === cur) throw new Error('could not bump cache name: ' + cur);
  fs.writeFileSync(path.join(ROOT, 'sw.js'), sw.replace(cur, next));

  // ---- relaunch: the running page should notice and offer the refresh ----
  await page.reload({ waitUntil: 'networkidle' });
  // install(addAll over the whole shell) -> skipWaiting -> activate -> claim
  // -> controllerchange is a real round trip; wait for the toast rather than
  // guessing a fixed delay.
  await page.waitForSelector('.toast', { timeout: 15000 }).catch(() => {});

  const prompt = await page.evaluate(() => {
    const t = document.querySelector('.toast');
    return t ? { text: t.textContent, btn: t.querySelector('button')?.textContent } : null;
  });
  ok('sw: a new build is noticed and offered, not silently ignored',
    !!prompt && /new version/i.test(prompt.text), JSON.stringify(prompt));
  ok('sw: the offer says REFRESH, not UNDO', prompt?.btn === 'REFRESH', String(prompt?.btn));

  // activate()'s cleanup runs in waitUntil, so give it a beat to settle.
  let caches2 = [];
  for (let i = 0; i < 20; i++) {
    caches2 = await page.evaluate(() => caches.keys());
    if (caches2.includes(NEXT) && !caches2.includes(CUR)) break;
    await page.waitForTimeout(250);
  }
  ok('sw: the new shell is cached and the old one dropped',
    caches2.includes(NEXT) && !caches2.includes(CUR), caches2.join(', '));

  // ---- taking the offer actually lands the new code ----
  await page.evaluate(() => document.querySelector('.toast button').click());
  await page.waitForTimeout(900);
  const landed = await page.evaluate(() => !!document.getElementById('NEWBUILD'));
  ok('sw: tapping refresh loads the genuinely new build', landed === true);

  // ---- and it still works with the network gone (the whole point) ----
  await ctx.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  const offline = await page.evaluate(() => !!document.getElementById('nav') && !!document.getElementById('NEWBUILD'));
  ok('sw: still opens offline, on the new build', offline === true);
  await ctx.setOffline(false);

  await browser.close(); server.close();
  fs.rmSync(ROOT, { recursive: true, force: true });
  console.log(pass ? '\nALL SERVICE-WORKER CHECKS PASS' : '\nFAILURES ABOVE');
  process.exit(pass ? 0 : 1);
})();
