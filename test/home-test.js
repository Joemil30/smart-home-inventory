/* The money row is the reason the dashboard exists, so the arithmetic has to
   be right and it has to stay quiet when it doesn't know anything. */
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
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  const errs = [];
  const noise = /openfoodfacts|themealdb|net::ERR|Failed to load resource|ERR_/i;
  page.on('pageerror', e => { if (!noise.test(e.message)) errs.push(e.message); });
  await page.goto(base, { waitUntil: 'networkidle' });

  let pass = true;
  const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${x ? '  — ' + x : ''}`); if (!c) pass = false; };

  const seed = () => page.evaluate(async () => {
    S.household = { id:'household', locations:[{id:'uf',name:'Fridge',kind:'fridge'}],
      members:[{name:'Sam'}], staples:[], people:2, stores:[] };
    S.who = S.household.members[0];
    S.items = []; S.catalog = []; S.shopping = []; S.plan = []; S.saved = [];
    S.cfg = { autoPhotos:false }; S.view = 'home'; S.q = ''; S.store = '';
    welcomed = true; document.getElementById('welcomeOverlay')?.remove();
  });

  // ---- A. the app opens on Home ----
  await seed();
  const nav = await page.evaluate(() => {
    render();
    return { tabs: [...document.getElementById('nav').querySelectorAll('button span')].map(s => s.textContent.split(' ·')[0]),
      view: S.view, title: document.getElementById('title').textContent,
      greets: /Good (morning|afternoon|evening)/.test(document.getElementById('app').textContent) };
  });
  ok('home: it is the first tab', nav.tabs[0] === 'Home', nav.tabs.join(' / '));
  ok('home: five tabs, not six', nav.tabs.length === 5, String(nav.tabs.length));
  ok('home: opens with a greeting', nav.greets === true);

  // ---- B. this month's counts ----
  await seed();
  const m = await page.evaluate(async () => {
    const day = 864e5, now = Date.now();
    const thisMonth = () => { const d = new Date(); d.setDate(2); d.setHours(12,0,0,0); return d.getTime(); };
    const lastMonth = () => { const d = new Date(); d.setMonth(d.getMonth()-1, 15); return d.getTime(); };
    S.items = [
      { id:'a', name:'Milk', cat:'dairy-milk', loc:'uf', deleted:false, mode:'count', qty:2, expires:now+5*day, added:now },
      { id:'d', name:'Spinach', cat:'produce-leafy', loc:'uf', deleted:true, wasted:true, wastedAt:thisMonth(), mode:'count', qty:0, expires:now-day, added:now },
      { id:'e', name:'Pasta', cat:'dry-pasta-rice', loc:'uf', deleted:true, goneAt:thisMonth(), mode:'count', qty:0, expires:now+40*day, added:now },
      { id:'f', name:'Yogurt', cat:'dairy-yogurt', loc:'uf', deleted:true, goneAt:thisMonth(), rescued:true, mode:'count', qty:0, expires:now+day, added:now },
      { id:'g', name:'Old bread', cat:'bread', loc:'uf', deleted:true, wasted:true, wastedAt:lastMonth(), mode:'count', qty:0, expires:now-60*day, added:now },
    ];
    return monthStats();
  });
  ok('month: counts what was finished', m.used === 2, String(m.used));
  ok('month: counts what was binned', m.binned === 1, String(m.binned));
  ok('month: rescued is the subset finished near its date', m.rescued === 1, String(m.rescued));
  ok('month: last month is outside the window', m.binned === 1);

  // ---- C. the glance row shows it ----
  await seed();
  const glance = await page.evaluate(async () => {
    S.items = [{ id:'x', name:'Thing', cat:'other', loc:'uf', deleted:false, mode:'count', qty:1, expires:Date.now()+9e8, added:Date.now() },
      { id:'y', name:'Saved one', cat:'other', loc:'uf', deleted:true, goneAt:Date.now(), rescued:true, mode:'count', qty:0, expires:Date.now(), added:Date.now() }];
    render();
    const t = document.getElementById('app').textContent.replace(/\s+/g, ' ');
    return { labels: /Items/.test(t) && /Use soon/.test(t) && /Expired/.test(t) && /Rescued/.test(t),
      noMoney: !/\$/.test(t) };
  });
  ok('home: four counts, including Rescued', glance.labels === true);
  ok('home: no money anywhere on the screen', glance.noMoney === true);

  // ---- D. depleting stamps when, and whether it was a rescue ----
  await seed();
  const dep = await page.evaluate(async () => {
    const day = 864e5;
    // Some categories track by level rather than count, so empty it properly
    // instead of assuming one tap finishes it.
    const drain = async id => { for (let i = 0; i < 8; i++) {
      const cur = S.items.find(x => x.id === id); if (!cur || cur.deleted) break; await deplete(cur);
    } };
    await addItem({ name:'Cream', cat:'dairy-milk', loc:'uf', qty:1, expires:Date.now()+day });
    const it = S.items.find(i => i.name === 'Cream');
    await drain(it.id);
    const gone = S.items.find(i => i.id === it.id);
    await addItem({ name:'Flour', cat:'dry-pasta-rice', loc:'uf', qty:1, expires:Date.now()+200*day });
    const f = S.items.find(i => i.name === 'Flour');
    await drain(f.id);
    const gone2 = S.items.find(i => i.id === f.id);
    return { goneAt: !!gone.goneAt, rescued: gone.rescued === true,
      goneAt2: !!gone2.goneAt, rescued2: gone2.rescued === true, stats: monthStats() };
  });
  ok('deplete: stamps when the item ran out', dep.goneAt && dep.goneAt2);
  ok('deplete: finishing it near its date counts as a rescue', dep.rescued === true);
  ok('deplete: finishing something with months left does not', dep.rescued2 === false);
  ok('deplete: both land in "finished", only one in "rescued"',
    dep.stats.used === 2 && dep.stats.rescued === 1, JSON.stringify(dep.stats));

  // ---- G. weeks ----
  const wk = await page.evaluate(() => {
    const a = weekRange(0), b = weekRange(1), c = weekRange(-1);
    return { len: a.days.length, mon: a.days[0].getDay(), sun: a.days[6].getDay(),
      next: b.from > a.to, prev: c.to < a.from, label: weekLabel(a) };
  });
  ok('weeks: seven days, Monday to Sunday', wk.len === 7 && wk.mon === 1 && wk.sun === 0, JSON.stringify(wk));
  ok('weeks: next and previous do not overlap the current one', wk.next && wk.prev);
  ok('weeks: the range has a readable label', /\w+ \d+/.test(wk.label), wk.label);

  // ---- H. Home surfaces what needs a person ----
  await seed();
  const surf = await page.evaluate(async () => {
    const day = 864e5;
    S.items = [{ id:'s', name:'Dying spinach', cat:'produce-leafy', loc:'uf', deleted:false, mode:'count', qty:1, expires:Date.now()+day, added:Date.now() }];
    await planMeal(weekRange(0).days[2] && dayKey(weekRange(0).days[2]), { name:'Taco night', emoji:'🌮' });
    render();
    const t = document.getElementById('app').textContent;
    return { soon: /Eat these first/.test(t), item: /Dying spinach/.test(t),
      week: /This week/.test(t), meal: /Taco night/.test(t), quick: /Scan/.test(t) && /Receipt/.test(t) };
  });
  ok('home: surfaces what is dying', surf.soon && surf.item);
  ok('home: shows this week\'s plan', surf.week && surf.meal);
  ok('home: keeps the three ways to add food one tap away', surf.quick === true);

  ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));

  await browser.close(); server.close();
  console.log(pass ? '\nALL HOME CHECKS PASS' : '\nFAILURES ABOVE');
  process.exit(pass ? 0 : 1);
})();
