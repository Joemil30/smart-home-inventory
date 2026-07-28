/* The Appearance switch, run on a phone whose OS is set to DARK — the case
   where an in-app override has to beat the system preference. */
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

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await browser.newContext({ colorScheme: 'dark', viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errs = [];
  const noise = /openfoodfacts|themealdb|net::ERR|Failed to load resource|ERR_/i;
  page.on('pageerror', e => { if (!noise.test(e.message)) errs.push(e.message); });
  await page.goto(base, { waitUntil: 'networkidle' });

  let pass = true;
  const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${x ? '  — ' + x : ''}`); if (!c) pass = false; };

  const seed = () => page.evaluate(async () => {
    S.household = { id:'household', locations:[], members:[{name:'Joe'}], staples:[], people:2, stores:[], aisleOrder:{} };
    S.who = S.household.members[0];
    S.items = []; S.catalog = []; S.shopping = []; S.plan = []; S.saved = [];
    S.cfg = {}; welcomed = true; document.getElementById('welcomeOverlay')?.remove();
    applyTheme(); S.view = 'set'; render();
  });
  const read = () => page.evaluate(() => ({
    ground: getComputedStyle(document.documentElement).getPropertyValue('--void').trim(),
    ink: getComputedStyle(document.documentElement).getPropertyValue('--frost').trim(),
    attr: document.documentElement.getAttribute('data-theme'),
    bar: document.querySelector('meta[name="theme-color"]:not([media])')?.getAttribute('content'),
    mediaBars: document.querySelectorAll('meta[name="theme-color"][media]').length,
    ios: document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.getAttribute('content'),
    saved: S.cfg.theme,
  }));
  const pick = v => page.evaluate(async v => {
    document.querySelector(`#app [data-t="${v}"]`).click();
    await new Promise(r => setTimeout(r, 220));
  }, v);

  await seed();

  // ---- the control is present and self-explanatory ----
  const ui = await page.evaluate(() => {
    const opts = [...document.querySelectorAll('#app [data-t]')];
    return {
      values: opts.map(o => o.dataset.t),
      labels: opts.map(o => o.querySelector('b')?.textContent),
      descs: opts.map(o => o.querySelector('.td')?.textContent || ''),
      checked: opts.filter(o => o.getAttribute('aria-checked') === 'true').map(o => o.dataset.t),
      group: document.querySelector('#app [role=radiogroup]') ? true : false,
      says: /Showing/.test(document.getElementById('app').textContent),
    };
  });
  ok('theme: all three choices are offered', ui.values.join() === 'system,light,dark', ui.values.join());
  ok('theme: each is labelled', ui.labels.join(' / ') === 'Match my phone / Light / Dark', ui.labels.join(' / '));
  ok('theme: each explains itself', ui.descs.every(d => d.length > 20), JSON.stringify(ui.descs));
  ok('theme: it is a radio group with exactly one selected',
    ui.group && ui.checked.length === 1 && ui.checked[0] === 'system', JSON.stringify(ui.checked));
  ok('theme: it states which one is actually showing', ui.says === true);

  // ---- default: follows the phone (which is dark here) ----
  const sys = await read();
  ok('theme: by default it follows the phone, so a dark phone gets a dark app',
    sys.ground === '#0E1512' && sys.attr === null, JSON.stringify(sys));

  // ---- the whole point: force LIGHT on a DARK phone ----
  await pick('light');
  const light = await read();
  ok('theme: choosing Light beats the phone', light.ground === '#F7F9F7' && light.attr === 'light', JSON.stringify(light));
  ok('theme: text flips with it', /#0[BbEe]/i.test(light.ink) || light.ink !== '#E7EFE9', light.ink);
  ok('theme: the choice is saved', light.saved === 'light', String(light.saved));
  // the bug: the status bar used to stay dark because its meta followed the phone
  ok('theme: the status bar follows the APP, not the phone', light.bar === '#F7F9F7', String(light.bar));
  ok('theme: the phone-driven meta tags are gone, so they cannot win', light.mediaBars === 0, String(light.mediaBars));
  ok('theme: iOS status bar style follows too', light.ios === 'default', String(light.ios));

  // ---- and force DARK back ----
  await pick('dark');
  const dark = await read();
  ok('theme: choosing Dark works too', dark.ground === '#0E1512' && dark.attr === 'dark', JSON.stringify(dark));
  ok('theme: status bar goes dark with it', dark.bar === '#0E1512' && dark.ios === 'black', JSON.stringify([dark.bar, dark.ios]));

  // ---- back to system ----
  await pick('system');
  const back = await read();
  ok('theme: "Match my phone" clears the override', back.attr === null && back.saved === 'system', JSON.stringify(back));
  ok('theme: and returns to the phone\'s dark setting', back.ground === '#0E1512' && back.bar === '#0E1512', JSON.stringify(back));

  // ---- it survives a reload ----
  await page.evaluate(async () => { S.cfg.theme = 'light'; await saveCfg(); });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => ({
    ground: getComputedStyle(document.documentElement).getPropertyValue('--void').trim(),
    bar: document.querySelector('meta[name="theme-color"]:not([media])')?.getAttribute('content'),
  }));
  ok('theme: the choice survives a restart', after.ground === '#F7F9F7' && after.bar === '#F7F9F7', JSON.stringify(after));

  ok('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));

  await browser.close(); server.close();
  console.log(pass ? '\nALL THEME CHECKS PASS' : '\nFAILURES ABOVE');
  process.exit(pass ? 0 : 1);
})();
