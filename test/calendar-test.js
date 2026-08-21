/* The expiry calendar, and the list-progress header.

   The calendar stores nothing — it lays out dates the app already had. So
   what's worth protecting is the layout maths, which is the part that goes
   quietly wrong:
     1. The month grid must start on the right weekday (Monday-first) or
        every date sits under the wrong column and the screen lies.
     2. A day is tinted by the WORST thing on it, so a bad week reads as a
        block of colour before you read a number.
     3. Only the month on screen is counted — a jar expiring next March must
        not inflate this month's total. */
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

  await page.evaluate(async () => {
    S.household = { id:'household', locations:[{id:'uf',name:'Fridge',kind:'fridge'}],
      members:[{name:'Joe'},{name:'Sam'}], staples:[], allergies:[], people:2,
      stores:[{ id:'cst', name:'Costco' }], aisleOrder:{} };
    S.who = S.household.members[0];
    S.items = []; S.catalog = []; S.shopping = []; S.plan = []; S.saved = [];
    S.cfg = { autoPhotos:false, confirmActions:false };
    welcomed = true;
    await saveHousehold();
  });

  /* ---- 1. the grid lines up with the weekdays -------------------------- */
  /* March 2027 starts on a Monday, so a Monday-first grid needs no leading
     blanks at all. September 2027 starts on a Wednesday, which needs two. */
  const grid = await page.evaluate(() => {
    const look = (y, m) => {
      S.calMonth = new Date(y, m, 1).getTime();
      S.view = 'calendar'; render();
      const cells = [...document.querySelectorAll('.cal .cc')];
      const lead = cells.findIndex(c => !c.classList.contains('empty'));
      return { lead, days: cells.length - lead,
        first: cells[lead]?.querySelector('.dn')?.textContent,
        heads: [...document.querySelectorAll('.cal .cd')].map(d => d.textContent).join('') };
    };
    return { mar: look(2027, 2), sep: look(2027, 8), feb: look(2028, 1) };
  });
  ok('the week starts on Monday', grid.mar.heads === 'MTWTFSS', grid.mar.heads);
  ok('a month starting Monday has no leading blanks', grid.mar.lead === 0, `lead=${grid.mar.lead}`);
  ok('a month starting Wednesday has two', grid.sep.lead === 2, `lead=${grid.sep.lead}`);
  ok('March has 31 cells', grid.mar.days === 31, `n=${grid.mar.days}`);
  ok('September has 30', grid.sep.days === 30, `n=${grid.sep.days}`);
  ok('a leap February has 29', grid.feb.days === 29, `n=${grid.feb.days}`);
  ok('the first drawn day is the 1st', grid.mar.first === '1', grid.mar.first);

  /* ---- 2. only this month counts --------------------------------------- */
  const counted = await page.evaluate(async () => {
    const at = (y, m, d) => new Date(y, m, d, 12).getTime();
    await addItem({ name:'Milk',    cat:'dairy-milk',    loc:'uf', qty:1, expires: at(2027, 2, 10) });
    await addItem({ name:'Yoghurt', cat:'dairy-yogurt',  loc:'uf', qty:1, expires: at(2027, 2, 10) });
    await addItem({ name:'Cheddar', cat:'dairy-cheese',  loc:'uf', qty:1, expires: at(2027, 2, 22) });
    await addItem({ name:'Pickles', cat:'condiment',     loc:'uf', qty:1, expires: at(2027, 8, 4) });
    S.calMonth = new Date(2027, 2, 1).getTime(); S.view = 'calendar'; render();
    const badge = document.querySelector('.sect .n')?.textContent;
    const marked = [...document.querySelectorAll('.cal .cc.has')].map(c =>
      ({ day: c.querySelector('.dn').textContent, n: c.querySelector('.dc')?.textContent }));
    return { badge, marked };
  });
  ok('the month total counts only this month', counted.badge === '3', counted.badge);
  ok('two days are marked', counted.marked.length === 2, JSON.stringify(counted.marked));
  ok('a day with two items says 2', counted.marked.find(x => x.day === '10')?.n === '2',
    JSON.stringify(counted.marked));
  ok('a day with one says 1', counted.marked.find(x => x.day === '22')?.n === '1',
    JSON.stringify(counted.marked));

  const other = await page.evaluate(() => {
    S.calMonth = new Date(2027, 8, 1).getTime(); render();
    return document.querySelector('.sect .n')?.textContent;
  });
  ok('next September counts its own one item', other === '1', other);

  /* ---- 3. a day is tinted by the worst thing on it ---------------------- */
  const tint = await page.evaluate(async () => {
    const d = new Date(); d.setHours(12, 0, 0, 0);
    const plus = n => { const x = new Date(d); x.setDate(x.getDate() + n); return x.getTime(); };
    S.items = [];
    await addItem({ name:'Fine',   cat:'condiment',    loc:'uf', qty:1, expires: plus(20) });
    await addItem({ name:'Soon',   cat:'dairy-milk',   loc:'uf', qty:1, expires: plus(2) });
    await addItem({ name:'AlsoOk', cat:'condiment',    loc:'uf', qty:1, expires: plus(2) });   // same day as Soon
    const cell = n => [...document.querySelectorAll('.cal .cc.has')]
      .find(c => c.querySelector('.dn').textContent === String(new Date(plus(n)).getDate()));
    const farDate = new Date(plus(20));
    S.calMonth = new Date(farDate.getFullYear(), farDate.getMonth(), 1).getTime(); render();
    const far = cell(20)?.className || '';
    const nearDate = new Date(plus(2));
    S.calMonth = new Date(nearDate.getFullYear(), nearDate.getMonth(), 1).getTime(); render();
    return { far, near: cell(2)?.className || '', today: !!document.querySelector('.cc.today') };
  });
  ok('a distant date reads as fine', /have/.test(tint.far), tint.far);
  ok('a date within three days reads as soon', /low/.test(tint.near), tint.near);
  ok('today is marked', tint.today);

  /* Past dates read as expired, not merely soon. */
  const past = await page.evaluate(async () => {
    const d = new Date(); d.setHours(12, 0, 0, 0);
    const back = new Date(d); back.setDate(back.getDate() - 2);
    S.items = [];
    await addItem({ name:'Gone', cat:'dairy-milk', loc:'uf', qty:1, expires: back.getTime() });
    S.calMonth = new Date(d.getFullYear(), d.getMonth(), 1).getTime(); render();
    const c = [...document.querySelectorAll('.cal .cc.has')]
      .find(x => x.querySelector('.dn').textContent === String(back.getDate()));
    return c?.className || '';
  });
  ok('a date already passed reads as expired', /out/.test(past), past);

  /* ---- 4. paging never lands on an impossible date --------------------- */
  const paged = await page.evaluate(() => {
    S.calMonth = new Date(2027, 0, 31).getTime();   // 31 Jan
    S.view = 'calendar'; render();                  // viewCalendar normalises to the 1st
    const jan = document.querySelector('.calnav b').textContent;
    document.querySelector('.calnav [data-a=n]').click();
    const feb = document.querySelector('.calnav b').textContent;
    document.querySelector('.calnav [data-a=p]').click();
    document.querySelector('.calnav [data-a=p]').click();
    return { jan, feb, dec: document.querySelector('.calnav b').textContent };
  });
  ok('the 31st still shows January, not February', /January 2027/.test(paged.jan), paged.jan);
  ok('paging forward from the 31st lands on February', /February 2027/.test(paged.feb), paged.feb);
  ok('paging back across the year boundary works', /December 2026/.test(paged.dec), paged.dec);

  /* ---- 5. list progress ------------------------------------------------ */
  const prog = await page.evaluate(async () => {
    S.store = 'cst'; S.view = 'shop'; S.shopMap = false;
    const empty = (render(), !!document.querySelector('.prog'));
    for (const n of ['Milk','Bread','Eggs','Rice']) await addToList(n, '', 'cst');
    render();
    const start = document.querySelector('.prog')?.innerText;
    const s = S.shopping.find(x => x.name === 'Bread');
    s.done = true; s.doneAt = Date.now(); await saveShopping(s);
    render();
    const bar = document.querySelector('.pgbar i');
    return { empty, start, after: document.querySelector('.prog')?.innerText,
      width: bar?.style.width, faces: document.querySelectorAll('.face').length };
  });
  ok('no progress bar on an empty list', !prog.empty);
  ok('a fresh list reads 0 of 4', /0\/4/.test(prog.start), prog.start);
  ok('ticking one off advances it', /1\/4/.test(prog.after), prog.after);
  ok('the bar fills to match', prog.width === '25%', prog.width);
  ok('faces stay hidden until sync is actually on', prog.faces === 0, `n=${prog.faces}`);

  ok('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));

  await browser.close();
  server.close();
  console.log(pass ? '\nAll checks pass.' : '\nFailures above.');
  process.exit(pass ? 0 : 1);
})();
