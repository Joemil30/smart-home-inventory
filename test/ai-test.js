/* Focused test for the AI model picker fix.
   The bug the user hit: verNum() required a decimal, so "gemini-3-flash"
   scored 0 and sorted LAST — the app kept selecting an older/dead model and
   the first real scan died with "limit: 0". */
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright');
const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html':'text/html', '.js':'text/javascript', '.webmanifest':'application/manifest+json', '.svg':'image/svg+xml', '.png':'image/png' };

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
  const page = await (await browser.newContext()).newPage();
  await page.goto(base, { waitUntil: 'networkidle' });

  let pass = true;
  const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${x ? '  — ' + x : ''}`); if (!c) pass = false; };

  // ---- 1. verNum: the actual bug ----
  const v = await page.evaluate(() => ({
    g3:   verNum('gemini-3-flash'),
    g25:  verNum('gemini-2.5-flash'),
    g20:  verNum('gemini-2.0-flash'),
    g15:  verNum('gemini-1.5-flash'),
    g3p:  verNum('gemini-3-pro'),
  }));
  ok('verNum: gemini-3-flash scores 3 (was 0 — the bug)', v.g3 === 3, JSON.stringify(v));
  ok('verNum: gemini-3-flash > gemini-2.5-flash', v.g3 > v.g25, `${v.g3} vs ${v.g25}`);
  ok('verNum: gemini-2.5-flash > gemini-2.0-flash', v.g25 > v.g20, `${v.g25} vs ${v.g20}`);
  ok('verNum: gemini-2.0-flash > gemini-1.5-flash', v.g20 > v.g15);

  // ---- 2. candidates(): newest live Flash first, Flash-Lite after, dead never ----
  const cand = await page.evaluate(() => {
    S.cfg = { aiProvider: 'gemini', geminiKey: 'k' };
    return G.candidates([
      { id: 'gemini-1.5-flash' }, { id: 'gemini-2.0-flash' },
      { id: 'gemini-3-flash-lite' }, { id: 'gemini-3-flash' },
      { id: 'gemini-2.5-flash' }, { id: 'gemini-3-pro' },
      { id: 'gemini-3-flash-image' }, { id: 'text-embedding-004' },
    ]);
  });
  ok('candidates: gemini-3-flash ranked first', cand[0] === 'gemini-3-flash', cand.join(' > '));
  ok('candidates: excludes discontinued gemini-2.0-flash', !cand.includes('gemini-2.0-flash'));
  ok('candidates: excludes gemini-1.5-flash', !cand.includes('gemini-1.5-flash'));
  ok('candidates: excludes image + embedding models', !cand.some(c => /image|embedding/.test(c)), cand.join(','));
  ok('candidates: Flash-Lite kept as fallback, ranked below Flash',
    cand.indexOf('gemini-3-flash-lite') > cand.indexOf('gemini-3-flash') && cand.includes('gemini-3-flash-lite'));

  // ---- 3. _zeroQuota: tell "no quota ever" apart from "used it up" ----
  const zq = await page.evaluate(() => ({
    real:  G._zeroQuota('Quota exceeded for quota metric ... limit: 0'),
    snake: G._zeroQuota('{"quota_limit_value":"0"}'),
    spent: G._zeroQuota('Quota exceeded ... limit: 250'),
    plain: G._zeroQuota('rate limited, retry in 30s'),
  }));
  ok('zeroQuota: detects "limit: 0"', zq.real === true);
  ok('zeroQuota: detects quota_limit_value 0', zq.snake === true);
  ok('zeroQuota: does NOT fire on a real spent quota (limit: 250)', zq.spent === false);
  ok('zeroQuota: does NOT fire on plain rate limiting', zq.plain === false);

  // ---- 4. pickWorking: skips zero-quota models, lands on one that answers ----
  const probe = await page.evaluate(async () => {
    S.cfg = { aiProvider: 'gemini', geminiKey: 'k' };
    const tried = [];
    const realFetch = window.fetch;
    window.fetch = async (u, o) => {
      const url = String(u);
      const m = url.match(/models\/([^:]+):generateContent/);
      if (m) {
        tried.push(m[1]);
        // Simulate reality: the newest model is dead on this key, next one works.
        if (m[1] === 'gemini-3-flash')
          return new Response(JSON.stringify({ error: { message: 'Quota exceeded ... limit: 0' } }), { status: 429 });
        return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'hi' }] } }] }), { status: 200 });
      }
      return realFetch(u, o);
    };
    const picked = await G.pickWorking([{ id: 'gemini-3-flash' }, { id: 'gemini-2.5-flash' }]);
    window.fetch = realFetch;
    return { picked, tried };
  });
  ok('pickWorking: probes the top candidate first', probe.tried[0] === 'gemini-3-flash', probe.tried.join(','));
  ok('pickWorking: falls past the zero-quota model', probe.picked === 'gemini-2.5-flash', probe.picked);
  ok('pickWorking: stops as soon as one answers', probe.tried.length === 2, probe.tried.join(','));

  // ---- 5. pickWorking surfaces a real reason when nothing works ----
  const allDead = await page.evaluate(async () => {
    S.cfg = { aiProvider: 'gemini', geminiKey: 'k' };
    const realFetch = window.fetch;
    window.fetch = async (u, o) => String(u).includes('generateContent')
      ? new Response(JSON.stringify({ error: { message: 'Quota exceeded ... limit: 0' } }), { status: 429 })
      : realFetch(u, o);
    let msg = '';
    try { await G.pickWorking([{ id: 'gemini-3-flash' }]); } catch (e) { msg = e.message; }
    window.fetch = realFetch;
    return msg;
  });
  ok('pickWorking: explains "no free quota" when every model is dead', /no free quota/i.test(allDead), allDead);

  // ---- 6. runtime error text: limit-0 must NOT tell the user to wait ----
  const errText = await page.evaluate(async () => {
    S.cfg = { aiProvider: 'gemini', geminiKey: 'k', geminiModel: 'gemini-3-flash' };
    const realFetch = window.fetch;
    window.fetch = async () => new Response(JSON.stringify({ error: { message: 'Quota exceeded ... limit: 0' } }), { status: 429 });
    let msg = '';
    try { await G.gen([{ text: 'x' }]); } catch (e) { msg = e.message; }
    window.fetch = realFetch;
    return msg;
  });
  ok('limit-0 error names the model', /gemini-3-flash/.test(errText), errText.slice(0, 90));
  ok('limit-0 error says nothing was used up', /used up/i.test(errText));
  ok('limit-0 error does NOT tell you to wait', !/wait/i.test(errText), errText.slice(0, 120));

  await browser.close(); server.close();
  console.log(pass ? '\nALL AI CHECKS PASS' : '\nFAILURES ABOVE');
  process.exit(pass ? 0 : 1);
})();
