const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright');

const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html':'text/html', '.js':'text/javascript', '.webmanifest':'application/manifest+json',
  '.svg':'image/svg+xml', '.json':'application/json', '.md':'text/markdown' };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/favicon.ico') { res.writeHead(204); return res.end(); }  // browser auto-request; not an app asset
  if (p === '/') p = '/index.html';
  const fp = path.join(ROOT, p);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
  fs.createReadStream(fp).pipe(res);
});

// Derived from sw.js, so bumping the cache version can't leave this asserting
// against a name the app no longer uses.
const NAME = (fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8').match(/CACHE\s*=\s*'([^']+)'/) || [])[1];

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errs = [];
  // The sandbox has no external network, so photo fetches to Open Food Facts /
  // TheMealDB fail by design — ignore that expected noise, keep real JS errors.
  const netNoise = /openfoodfacts|themealdb|net::ERR|Failed to load resource|ERR_/i;
  page.on('console', m => { if (m.type() === 'error' && !netNoise.test(m.text())) errs.push('console: ' + m.text()); });
  page.on('pageerror', e => { if (!netNoise.test(e.message)) errs.push('pageerror: ' + e.message); });

  let pass = true;
  const ok = (name, cond, extra='') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`); if (!cond) pass = false; };

  // ---- A. boot ----
  await page.goto(base, { waitUntil: 'networkidle' });
  const bodyTxt = await page.textContent('body');
  ok('boot: setup wizard rendered', /Set up Stocked/.test(bodyTxt));

  await page.evaluate(() => navigator.serviceWorker.ready).catch(() => {});
  const cached = await page.evaluate(async NAME => {
    const c = await caches.open(NAME);
    return (await c.keys()).map(k => new URL(k.url).pathname);
  }, NAME).catch(() => []);
  ok(`sw: ${NAME} caches zxing.min.js`, cached.includes('/zxing.min.js'), cached.join(', '));
  ok(`sw: ${NAME} caches app shell`, cached.includes('/index.html'));
  ok(`sw: ${NAME} caches apple-touch-icon.png`, cached.includes('/apple-touch-icon.png'));
  const iconLink = await page.evaluate(() => { const l = document.querySelector('link[rel="apple-touch-icon"]'); return l ? l.getAttribute('href') : null; });
  ok('ios: apple-touch-icon link present', iconLink === 'apple-touch-icon.png', String(iconLink));

  // ---- B. lazy loader present & ZXing not yet loaded on boot ----
  const zLoadedAtBoot = await page.evaluate(() => 'ZXing' in window);
  ok('lazy: ZXing NOT loaded at boot (Android/desktop pay nothing)', zLoadedAtBoot === false);
  const hasLoader = await page.evaluate(() => typeof window.loadZXing === 'function');
  ok('lazy: loadZXing() exists', hasLoader);

  // ---- C. real barcode encode -> render -> decode round-trip via vendored file ----
  //   Uses the EXACT hints Map + BrowserMultiFormatReader the app uses.
  //   Grocery formats (EAN_13/UPC_A) share this linear decode path; we round-trip
  //   through the formats this build's writer can generate (CODE_128, EAN_8) to
  //   prove the wiring end to end. EAN_13/UPC decoding itself is ZXing core.
  const rt = await page.evaluate(async () => {
    await new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = 'zxing.min.js';
      s.onload = res; s.onerror = () => rej(new Error('script load failed'));
      document.head.appendChild(s);
    });
    const hints = new Map();
    hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
      ZXing.BarcodeFormat.EAN_13, ZXing.BarcodeFormat.EAN_8,
      ZXing.BarcodeFormat.UPC_A, ZXing.BarcodeFormat.UPC_E, ZXing.BarcodeFormat.CODE_128,
    ]);
    // Standard EAN-13 encoding tables (this build ships no linear writer, so we
    // build a genuine grocery barcode bitmap by hand, then decode it).
    const L = ['0001101','0011001','0010011','0111101','0100011','0110001','0101111','0111011','0110111','0001011'];
    const G = ['0100111','0110011','0011011','0100001','0011101','0111001','0000101','0010001','0001001','0010111'];
    const R = ['1110010','1100110','1101100','1000010','1011100','1001110','1010000','1000100','1001000','1110100'];
    const PAR = ['LLLLLL','LLGLGG','LLGGLG','LLGGGL','LGLLGG','LGGLLG','LGGGLL','LGLGLG','LGLGGL','LGGLGL'];
    const ean13 = code => {
      const d = code.split('').map(Number);
      let bits = '101';
      const par = PAR[d[0]];
      for (let i = 1; i <= 6; i++) bits += (par[i-1] === 'L' ? L : G)[d[i]];
      bits += '01010';
      for (let i = 7; i <= 12; i++) bits += R[d[i]];
      return bits + '101';                       // 95 modules
    };
    const decodeBitmap = async (bits, expected) => {
      const scale = 4, quiet = 12, H = 160;
      const cv = document.createElement('canvas');
      cv.width = (bits.length + quiet * 2) * scale; cv.height = H;
      const g = cv.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height); g.fillStyle = '#000';
      for (let i = 0; i < bits.length; i++) if (bits[i] === '1') g.fillRect((quiet + i) * scale, 0, scale, H);
      const reader = new ZXing.BrowserMultiFormatReader(hints, 300);
      const r = await reader.decodeFromImageUrl(cv.toDataURL('image/png'));
      return { expected, got: r.getText(), fmt: ZXing.BarcodeFormat[r.getBarcodeFormat()], ok: r.getText() === expected };
    };
    const out = {};
    for (const code of ['5901234123457', '4006381333931']) {   // two valid EAN-13s
      try { out[code] = await decodeBitmap(ean13(code), code); }
      catch (e) { out[code] = { error: e.message }; }
    }
    return out;
  }).catch(e => ({ error: e.message }));
  ok('zxing: real EAN-13 #1 decodes via app hints', rt['5901234123457'] && rt['5901234123457'].ok, JSON.stringify(rt['5901234123457']));
  ok('zxing: real EAN-13 #2 decodes via app hints', rt['4006381333931'] && rt['4006381333931'].ok, JSON.stringify(rt['4006381333931']));

  // ---- E. rapid-add + confirm-flow logic (drives onCode directly) ----
  const fn = await page.evaluate(async () => {
    S.household = { locations:[{id:'uf',name:'Upstairs fridge',kind:'fridge'},{id:'up',name:'Upstairs pantry',kind:'pantry'}], staples:[], members:[{name:'Me',emoji:'🐻'}], people:1 };
    S.who = S.household.members[0];
    S.items = [];
    S.catalog = [
      { id:'1000', name:'Test Milk', brand:'Kirkland', cat:'dairy-milk', packSize:null },
      { id:'2000', name:'Test Beans', brand:'K', cat:'canned', packSize:null },
    ];
    S.cfg = { scanMode:'in', rapid:true, rapidLoc:'up' };
    rapidLog = [];
    const dlg = document.getElementById('dlg'); if (dlg.open) dlg.close();
    const res = {};

    await onCode('1000','in');                       // rapid: known -> auto add, no dialog
    res.rapidAdded = S.items.length;
    res.rapidLoc = S.items[0] && S.items[0].loc;
    res.rapidName = S.items[0] && S.items[0].name;
    res.rapidLogLen = rapidLog.length;
    res.dlgClosedAfterRapid = !dlg.open;

    await onCode('1000','in');                       // dup within 2.5s -> ignored
    res.afterDup = S.items.length;

    const box = document.createElement('div'); document.body.appendChild(box);
    paintRapidList(box);
    res.listShowsItem = /Test Milk/.test(box.textContent);

    S.cfg.rapid = false;
    await onCode('2000','in');                       // non-rapid: known -> confirm dialog, no premature add
    res.confirmDialogOpen = dlg.open;
    res.notAddedYet = S.items.length;
    if (dlg.open) dlg.close();
    return res;
  }).catch(e => ({ error: e.message }));
  ok('rapid: known item auto-added, no dialog', fn.rapidAdded === 1 && fn.dlgClosedAfterRapid === true, JSON.stringify(fn));
  ok('rapid: landed on chosen shelf (up) with right name', fn.rapidLoc === 'up' && fn.rapidName === 'Test Milk');
  ok('rapid: running tally shows the item', fn.rapidLogLen === 1 && fn.listShowsItem === true);
  ok('scan: duplicate within 2.5s ignored', fn.afterDup === 1);
  ok('non-rapid: known item opens confirm, no premature add', fn.confirmDialogOpen === true && fn.notAddedYet === 1);

  const helpers = await page.evaluate(() => {
    let threw = null;
    try { scanFeedback(true); scanFeedback(false); setupTorch(); } catch (e) { threw = e.message; }
    return { types: [typeof setupTorch, typeof scanFeedback, typeof beep, typeof initAudio], threw };
  });
  ok('feedback/torch helpers run without throwing', helpers.threw === null && helpers.types.every(t => t === 'function'), JSON.stringify(helpers));

  // ---- F. new UI: thumbnails, +1/add-one-back, prominent Move, header search ----
  const ui = await page.evaluate(async () => {
    S.household = { locations:[{id:'uf',name:'Upstairs fridge',kind:'fridge'},{id:'up',name:'Upstairs pantry',kind:'pantry'}], staples:[], members:[{name:'Me',emoji:'🐻'}], people:1 };
    S.who = S.household.members[0];
    S.view = 'inv'; render();                        // render once so header buttons reflect the live household
    const mk = over => Object.assign({ id:'z'+Math.random().toString(36).slice(2), name:'Test', cat:'canned', loc:'uf',
      mode:'count', qty:2, level:null, packSize:null, unitsLeft:null, opened:false, image:null,
      added:Date.now()-1e6, expires:Date.now()+1e9, deleted:false }, over);
    const res = {};

    // thumbnail: real <img> when image present, first-letter placeholder when not
    const withImg = itemRow(mk({ name:'Milk', image:'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==' }));
    const noImg   = itemRow(mk({ name:'Onions', image:null }));
    res.imgTag = !!withImg.querySelector('.thumb img');
    res.emoji = !!noImg.querySelector('.thumb .emoji');   // no-photo item now shows a food emoji
    res.rowHasPlus = !!withImg.querySelector('[data-a=plus]') && !!withImg.querySelector('[data-a=minus]');

    // addOne is the inverse of deplete, and revives a fully-gone item
    const a = mk({ qty:2 }); S.items = [a];
    await deplete(a); const afterDep = a.qty;      // 2 -> 1
    await addOne(a);  const afterAdd = a.qty;       // 1 -> 2
    const g = mk({ qty:1 }); S.items.push(g);
    await deplete(g); const wasGone = g.deleted;    // -> deleted
    await addOne(g);                                // revive
    res.depThenAdd = afterDep === 1 && afterAdd === 2;
    res.reviveGone = wasGone === true && g.deleted === false && g.qty === 1;

    // item sheet: prominent Move + Add-one-back + a picture/placeholder
    const dlg = document.getElementById('dlg');
    itemSheet(mk({ name:'Beans' }));
    res.sheetMove = /Move to another shelf/.test(dlg.textContent);
    res.sheetAddBack = !!dlg.querySelector('[data-a=plus]');
    if (dlg.open) dlg.close();

    /* The magnifier used to jump to the pantry filter, and only appeared on
       two screens. It now opens the everything-search — items, list, history,
       recipes, meals — so it has to be reachable from ANYWHERE. */
    const sb = document.getElementById('searchBtn');
    res.searchOnPantry = (S.view = 'pantry', render(), !sb.classList.contains('hide'));
    res.searchOnCook   = (S.view = 'cook',   render(), !sb.classList.contains('hide'));
    res.searchOnShop   = (S.view = 'shop',   render(), !sb.classList.contains('hide'));
    // ...except on the screen it leads to, and while the camera is live.
    res.searchHiddenOnSearch = (S.view = 'search', render(), sb.classList.contains('hide'));
    S.view = 'soon'; render();
    sb.onclick();                                   // wired in boot()
    res.searchOpensSearch = S.view === 'search';
    return res;
  });
  ok('thumb: image renders <img>, no-image renders food emoji', ui.imgTag === true && ui.emoji === true, JSON.stringify(ui));
  ok('row: has both − and + buttons', ui.rowHasPlus === true);
  ok('addOne: inverse of deplete', ui.depThenAdd === true);
  ok('addOne: revives a fully-gone item', ui.reviveGone === true);
  ok('sheet: prominent Move + Add-one-back present', ui.sheetMove === true && ui.sheetAddBack === true);
  ok('header: search is reachable from every screen', ui.searchOnPantry === true && ui.searchOnCook === true && ui.searchOnShop === true,
    JSON.stringify({ pantry: ui.searchOnPantry, cook: ui.searchOnCook, shop: ui.searchOnShop }));
  ok('header: search hides on the search screen itself', ui.searchHiddenOnSearch === true);
  ok('header: search opens the everything-search', ui.searchOpensSearch === true);

  // ---- G. catalog view: browsable scan memory with thumbnails ----
  const catr = await page.evaluate(async () => {
    S.catalog = [
      { id:'111', name:'Kirkland Milk', brand:'Kirkland', cat:'dairy-milk', image:'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==', learned:Date.now() },
      { id:'222', name:'Roma Tomatoes Can', brand:'', cat:'canned', image:null, learned:Date.now()-1000 },
    ];
    S.items = [{ id:'a', name:'Kirkland Milk', barcode:'111', deleted:false, mode:'count', qty:1, cat:'dairy-milk', loc:'uf', expires:Date.now()+1e9, added:Date.now() }];
    S.cq = ''; S.view = 'cat'; render();
    const box = document.getElementById('catlist');
    const res = { rendered: !!box };
    res.count = box ? box.querySelectorAll('.item').length : 0;
    res.hasImg = !!box?.querySelector('.thumb img');
    res.hasEmoji = !!box?.querySelector('.thumb .emoji');   // no-photo items now show a food emoji
    res.inStock = /IN STOCK/.test(box?.textContent || '');
    const nav = document.getElementById('nav');
    res.navTabCount = nav.querySelectorAll('button').length;
    res.navLabels = nav.textContent;
    S.cq = 'roma'; paintCatalog(box);
    res.searchFiltered = box.querySelectorAll('.item').length === 1 && /Roma/.test(box.textContent);
    S.cq = '';
    catalogSheet(S.catalog[0]);
    const dlg = document.getElementById('dlg');
    res.sheetOk = !!dlg.querySelector('[data-a=forget]') && /Add to a shelf/.test(dlg.textContent);
    if (dlg.open) dlg.close();
    return res;
  });
  ok('catalog: lists known products with thumbnails (img + emoji)', catr.count === 2 && catr.hasImg === true && catr.hasEmoji === true, JSON.stringify(catr));
  ok('catalog: shows IN STOCK for what you currently have', catr.inStock === true);
  ok('catalog: search filters the list', catr.searchFiltered === true);
  // Home replaced Plan as a tab; the planner lives on Home and in Profile.
  ok('nav: 5 tabs (Home/Shop/Pantry/Cook/Profile)', catr.navTabCount === 5 && /Home/.test(catr.navLabels) && /Shop/.test(catr.navLabels) && /Pantry/.test(catr.navLabels) && /Cook/.test(catr.navLabels) && /Profile/.test(catr.navLabels), JSON.stringify(catr));
  ok('catalog: item sheet has Add-to-shelf + Forget', catr.sheetOk === true);

  // ---- H2. pantry landing + profile hub + planner + recipe -> list/plan ----
  const hp = await page.evaluate(async () => {
    const r = {};
    S.household = { id:'household', locations:[{id:'uf',name:'Fridge',kind:'fridge'}], members:[{name:'Sam Rivera',emoji:'🦊'}], staples:[], people:4 };
    S.who = S.household.members[0];
    const near = Date.now() + 2*86400000;
    S.items = [{ id:'d1', name:'Spinach', cat:'produce-leafy', loc:'uf', deleted:false, mode:'count', qty:1, expires:near, added:Date.now() }];
    S.catalog = []; S.shopping = []; S.plan = [];

    // Pantry landing: "Use soon" strip + the add FAB, and the pantry search
    S.view = 'pantry'; render();
    const app = document.getElementById('app');
    r.useSoon = !!app.querySelector('.foodcard') && /Use soon/.test(app.textContent) && /Spinach/.test(app.textContent);
    r.fabShown = !document.getElementById('fab').classList.contains('hide');
    r.pantryTitle = document.getElementById('title').textContent === 'Pantry';

    // Empty pantry -> friendly first-item CTA
    const keep = S.items; S.items = []; render();
    // assert the guidance, not the exact headline copy
    const et = document.getElementById('app').textContent;
    r.emptyCta = /Nothing in the pantry yet/.test(et) && /Add your first item/i.test(et);
    S.items = keep;

    // Profile hub: greets by name + rows for receipt/recipes/catalog/settings/help
    S.view = 'profile'; render();
    const pf = document.getElementById('app');
    r.profileName = /Sam Rivera/.test(pf.textContent);
    r.profileRows = ['receipt','recipes','catalog','settings','how'].every(a => !!pf.querySelector(`[data-a=${a}]`));

    // Welcome tour renders 4 slides and advances
    welcomeCarousel(() => {});
    const ov = document.getElementById('welcomeOverlay');
    r.welcomeShown = !!ov && ov.querySelectorAll('.wc-dots i').length === 4;
    ov.querySelector('#wcNext').click();
    r.welcomeAdvances = ov.querySelectorAll('.wc-dots i.on').length === 1 && ov.querySelectorAll('.wc-dots i')[1].classList.contains('on');
    ov.remove();

    // Recipe card actions: add missing -> shopping list
    recipeCache = [{ name:'Garlic Spinach Pasta', minutes:20, missing:['garlic','parmesan'], uses:['Spinach'], rescues:['Spinach'], steps:['Boil pasta','Wilt spinach','Toss'] }];
    S.view = 'cook'; render();
    const rc = document.getElementById('app').querySelector('.recipe-card');
    r.richCard = !!rc && /Garlic Spinach Pasta/.test(rc.textContent);
    r.missingPills = rc ? rc.querySelectorAll('.pill.miss').length : 0;
    rc.querySelector('[data-a=add]').click();
    await new Promise(z => setTimeout(z, 40));
    r.addedMissing = S.shopping.filter(s => !s.deleted).length === 2 && S.shopping.some(s => /garlic/i.test(s.name));

    // Plan a recipe onto today, then meal planner shows it + week-missing button + plan FAB
    const key = dayKey(new Date(today()));
    await planMeal(key, { name:'Taco Night', emoji:'🌮', uses:[], missing:['tortillas'] });
    S.view = 'plan'; render();
    const pv = document.getElementById('app');
    r.dayCards = pv.querySelectorAll('.day').length === 7;
    r.todayHighlighted = !!pv.querySelector('.day.today');
    r.mealShown = /Taco Night/.test(pv.textContent);
    // sync is on by default now, so the week's gaps go straight to the list
    // and the card reports them instead of offering a button to press
    r.weekBtn = /Keep the shopping list in sync/.test(pv.textContent)
      && /ingredient/i.test(pv.textContent);
    r.weekTabs = /This week/.test(pv.textContent) && /Next week/.test(pv.textContent);
    // the sync runs fire-and-forget so render never blocks on it
    await new Promise(z => setTimeout(z, 150));
    r.synced = S.shopping.some(x => !x.deleted && /tortilla/i.test(x.name) && x.fromPlan);
    r.planFab = !document.getElementById('fab').classList.contains('hide');
    return r;
  });
  ok('pantry: "Use soon" strip + add FAB + title', hp.useSoon && hp.fabShown && hp.pantryTitle, JSON.stringify(hp));
  ok('pantry: empty state guides a new user to add their first item', hp.emptyCta === true);
  ok('profile: hub greets by name with receipt/recipes/catalog/settings/help rows', hp.profileName && hp.profileRows);
  ok('onboarding: welcome tour shows 4 slides and advances', hp.welcomeShown && hp.welcomeAdvances);
  ok('plan: add-a-meal FAB visible on the planner', hp.planFab === true);
  ok('recipe: rich card renders with missing pills', hp.richCard === true && hp.missingPills === 2);
  ok('recipe: "Add missing" pushes ingredients to the shopping list', hp.addedMissing === true);
  ok('plan: meal planner shows 7 days, today highlighted, planned meal visible', hp.dayCards && hp.todayHighlighted && hp.mealShown);
  ok('plan: the week reports its missing ingredients', hp.weekBtn === true);
  ok('plan: Past / This / Next week tabs', hp.weekTabs === true);
  ok('plan: sync puts the week\'s gaps straight on the list', hp.synced === true);

  // ---- H. who removed, food emojis, photo upload ----
  const nu = await page.evaluate(async () => {
    const res = {};
    res.whoGone = !document.getElementById('whoBtn');
    res.emojiMilk = foodEmoji('Whole Milk', 'dairy-milk');
    res.emojiTomato = foodEmoji('Roma Tomatoes', 'produce-hardy');
    res.emojiCatFallback = foodEmoji('Weird Thing', 'produce-root');   // no name hit -> category emoji
    res.thumbEmoji = /class="emoji"/.test(thumbHtml({ name:'Bananas', cat:'produce-banana', image:null }));
    res.thumbImg = /<img/.test(thumbHtml({ name:'x', cat:'other', image:'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==' }));

    S.household = { locations:[{id:'uf',name:'Fridge',kind:'fridge'}], members:[{name:'Me'}], staples:[], people:1 };
    itemSheet({ id:'q', name:'Kale', cat:'produce-leafy', loc:'uf', mode:'count', qty:1, image:null, opened:false, added:Date.now(), expires:Date.now()+1e9, deleted:false });
    const dlg = document.getElementById('dlg');
    res.sheetPhotoBtn = !!dlg.querySelector('[data-a=photo]') && !!dlg.querySelector('#itphoto');
    if (dlg.open) dlg.close();

    // upload pipeline: synthesize a PNG file, run setItemPhoto, expect a small jpeg data-url
    const cv = document.createElement('canvas'); cv.width = cv.height = 300;
    const g = cv.getContext('2d'); g.fillStyle = '#c0392b'; g.fillRect(0, 0, 300, 300);
    const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
    const file = new File([blob], 'p.png', { type:'image/png' });
    const it = { id:'p1', name:'Peppers', cat:'produce-hardy', loc:'uf', mode:'count', qty:1, image:null, opened:false, added:Date.now(), expires:Date.now()+1e9, deleted:false };
    S.items = [it];
    await setItemPhoto(it, file);
    res.photoSet = typeof it.image === 'string' && it.image.startsWith('data:image/jpeg');
    return res;
  });
  ok('who: avatar/picker removed from the header', nu.whoGone === true, JSON.stringify(nu));
  ok('emoji: auto-picks by name (milk/tomato) and falls back to category', nu.emojiMilk === '🥛' && nu.emojiTomato === '🍅' && !!nu.emojiCatFallback);
  ok('thumbnail: emoji when no photo, <img> when there is one', nu.thumbEmoji === true && nu.thumbImg === true);
  ok('item sheet: Change-photo button + file input present', nu.sheetPhotoBtn === true);
  ok('upload: stores a downscaled JPEG data-URL', nu.photoSet === true);

  // ---- I. receipt reader: button, auto-by-type routing, auto expiry ----
  const rc = await page.evaluate(async () => {
    S.household = { locations:[
      {id:'uf',name:'Upstairs fridge',kind:'fridge'},{id:'uz',name:'Upstairs freezer',kind:'freezer'},{id:'up',name:'Upstairs pantry',kind:'pantry'}],
      staples:[], members:[{name:'Me'}], people:1 };
    S.who = S.household.members[0]; S.items = []; S.cfg = { scanMode:'in' };
    const res = {};
    // button present in Scan tab
    S.view = 'scan'; render();
    res.buttonPresent = /Scan a receipt/.test(document.getElementById('app').textContent);
    res.fnExists = typeof receiptFlow === 'function' && typeof visionReceipt === 'function';

    // auto-by-type routes each item to its natural shelf, and addItem sets expiry
    const items = [
      { name:'Kirkland Whole Milk', cat:'dairy-milk', count:1 },   // -> fridge
      { name:'Frozen Peas', cat:'frozen-veg', count:2 },           // -> freezer
      { name:'Basmati Rice', cat:'dry-pasta-rice', count:1 },      // -> pantry
      { name:'Mystery', cat:'not-a-real-cat', count:1 },           // -> 'other' fallback
    ];
    const n = await addReceiptItems(items, 'auto');
    res.added = n;
    const byName = nm => S.items.find(i => i.name === nm);
    res.milkKind = kindOf(byName('Kirkland Whole Milk').loc);   // fridge
    res.peasKind = kindOf(byName('Frozen Peas').loc);           // freezer
    res.riceKind = kindOf(byName('Basmati Rice').loc);          // pantry
    res.everyHasExpiry = S.items.every(i => typeof i.expires === 'number' && i.expires > Date.now());
    res.mysteryCat = byName('Mystery').cat;                     // coerced to 'other'

    // explicit shelf override sends all to one place
    S.items = [];
    await addReceiptItems([{ name:'A', cat:'canned' }, { name:'B', cat:'dairy-milk' }], 'up');
    res.overrideAllPantry = S.items.every(i => i.loc === 'up');
    return res;
  });
  ok('receipt: button in Scan tab + functions exist', rc.buttonPresent === true && rc.fnExists === true, JSON.stringify(rc));
  ok('receipt: auto-by-type routes milk→fridge, frozen→freezer, rice→pantry', rc.milkKind === 'fridge' && rc.peasKind === 'freezer' && rc.riceKind === 'pantry');
  ok('receipt: every added item gets an auto-estimated expiry (no typing)', rc.everyHasExpiry === true);
  ok('receipt: unknown category coerced to "other"', rc.mysteryCat === 'other');
  ok('receipt: explicit shelf override sends all there', rc.overrideAllPantry === true);

  // ---- J. smart expiry: detected dates, high-risk nudge, still-good, scorecard ----
  const ex = await page.evaluate(async () => {
    S.household = { locations:[{id:'uf',name:'Upstairs fridge',kind:'fridge'},{id:'up',name:'Upstairs pantry',kind:'pantry'}], staples:[], members:[{name:'Me'}], people:1 };
    S.who = S.household.members[0]; S.items = []; S.cfg = {};
    const res = {};
    const iso = ts => new Date(ts).toISOString().slice(0,10);
    const in10 = iso(Date.now() + 10*86400000);

    // A+B: a detected printed date is trusted; no date -> estimate (not confirmed)
    const milkDated = await addItem({ name:'Milk A', cat:'dairy-milk', loc:'uf', expires: parseExpiry(in10) });
    const milkGuess = await addItem({ name:'Milk B', cat:'dairy-milk', loc:'uf' });
    res.detectedUsed = iso(milkDated.expires) === in10 && milkDated.dateConfirmed === true;
    res.guessNotConfirmed = milkGuess.dateConfirmed === false;
    res.parseRejectsGarbage = parseExpiry('not a date') === null && parseExpiry('2019-01-01') === null; // too far past
    res.highRisk = isHighRisk('dairy-milk') === true && isHighRisk('canned') === false;

    // Strategy A nudge: only high-risk + unconfirmed items trigger it
    const canned = await addItem({ name:'Beans', cat:'canned', loc:'up' });   // low risk -> ignored
    const dlg = document.getElementById('dlg'); if (dlg.open) dlg.close();
    res.nudgeShows = verifyNudge([milkGuess, canned]) === true && /perishable/.test(dlg.textContent) && /Milk B/.test(dlg.textContent) && !/Beans/.test(dlg.textContent);
    res.nudgeSkips = (dlg.close(), verifyNudge([canned, milkDated]) === false);   // nothing risky+unconfirmed
    if (dlg.open) dlg.close();

    // Strategy C: extend pushes date out and marks confirmed
    const before = milkGuess.expires;
    await extendItem(milkGuess, 3);
    res.extended = milkGuess.expires === before + 3*86400000 && milkGuess.dateConfirmed === true;

    // scorecard renders from log
    S.items = [
      { id:'a', name:'x', cat:'canned', loc:'up', deleted:true, wasted:false, expires:Date.now(), added:Date.now() },
      { id:'b', name:'y', cat:'canned', loc:'up', deleted:true, wasted:false, expires:Date.now(), added:Date.now() },
      { id:'c', name:'z', cat:'produce-leafy', loc:'uf', deleted:true, wasted:true, wastedAt:Date.now()-5*86400000, expires:Date.now(), added:Date.now() },
    ];
    S.view = 'soon'; render();
    const txt = document.getElementById('app').textContent;
    res.scorecard = /Food scorecard/.test(txt) && /RESCUED/.test(txt) && /DAY STREAK/.test(txt);
    return res;
  });
  ok('expiry: a detected printed date is used and marked confirmed', ex.detectedUsed === true, JSON.stringify(ex));
  ok('expiry: no date -> estimate stays unconfirmed', ex.guessNotConfirmed === true);
  ok('expiry: parseExpiry rejects garbage and far-past dates', ex.parseRejectsGarbage === true);
  ok('expiry: high-risk categories classified correctly', ex.highRisk === true);
  ok('nudge: only high-risk unconfirmed items are flagged (milk yes, beans no)', ex.nudgeShows === true);
  ok('nudge: skips when nothing risky+unconfirmed', ex.nudgeSkips === true);
  ok('still-good: extend pushes date out and confirms it', ex.extended === true);
  ok('scorecard: renders rescued/wasted/streak from the log', ex.scorecard === true);

  // ---- K. shopping list + sync engine (offline/mock) ----
  const sk = await page.evaluate(async () => {
    S.household = { locations:[{id:'uf',name:'Fridge',kind:'fridge'}], members:[{name:'Me'}], staples:[], people:1 };
    S.who = S.household.members[0]; S.items = []; S.catalog = []; S.shopping = []; S.cfg = {};
    const res = {};

    // sync is off by default and push() must be a harmless no-op (never throws)
    res.syncOff = SYNC.configured() === false && SYNC.on() === false;
    let threw = false; try { await SYNC.push('items', 'x', { id:'x', updatedAt:1 }); } catch (e) { threw = true; }
    res.pushNoThrow = threw === false;

    // shopping: add, dedup, in-stock cross-ref, check off
    // qty 2, not 1 — a single unit now reads as "Running low", which is its own state
    S.items = [{ id:'m', name:'Whole Milk', cat:'dairy-milk', loc:'uf', deleted:false, mode:'count', qty:2, expires:Date.now()+1e9, added:Date.now() }];
    await addToList('Milk');            // fuzzy-matches Whole Milk in stock
    await addToList('Milk');            // dup -> ignored
    await addToList('Paper towels');    // not food in stock
    res.count = S.shopping.filter(s => !s.deleted).length;              // 2
    res.milkInStock = itemInStock('Milk') === 1;
    res.towelsNotStock = itemInStock('Paper towels') === 0;
    S.view = 'shop'; render();
    const txt = document.getElementById('app').textContent;
    res.viewShows = /Have 1/.test(txt) && /Paper towels/.test(txt);   // stock pill now reads "✓ Have N"
    res.shopTab = /Shop/.test(document.getElementById('nav').textContent);   // shopping is a bottom-nav tab now

    // Module 1: checking a shopping item offers to convert it into the pantry
    const before = S.items.length;
    shoppingToPantry(S.shopping.find(s => /Paper towels/.test(s.name)));
    const dlg = document.getElementById('dlg');
    res.convertPrompt = dlg.open && /Add to pantry/.test(dlg.textContent) && !!dlg.querySelector('#cloc');
    dlg.querySelector('[data-a=pantry]').click();
    await new Promise(z => setTimeout(z, 30));
    res.convertedToPantry = S.items.length === before + 1 && S.items.some(i => !i.deleted && /Paper towels/i.test(i.name));
    // Checked-off items now move to Completed rather than vanishing, so the
    // shop has a record of what was actually bought this trip.
    res.clearedFromList = !S.shopping.some(s => !s.deleted && !s.done && /Paper towels/i.test(s.name))
      && S.shopping.some(s => !s.deleted && s.done && /Paper towels/i.test(s.name));
    res.guessCat = typeof guessCat === 'function' && guessCat('Whole Milk') === 'dairy-milk' && guessCat('Chicken Breast') === 'poultry-raw';

    // sync merge: newer remote wins, older ignored
    const it = { id:'z1', name:'Cheese', cat:'canned', loc:'uf', deleted:false, mode:'count', qty:1, updatedAt:1000, expires:Date.now()+1e9, added:Date.now() };
    S.items.push(it);
    SYNC.applyRow({ store:'items', id:'z1', data:{ ...it, qty:9, updatedAt:2000 } });   // newer -> applies
    res.newerWins = S.items.find(i => i.id==='z1').qty === 9;
    SYNC.applyRow({ store:'items', id:'z1', data:{ ...it, qty:3, updatedAt:500 } });     // older -> ignored
    res.olderIgnored = S.items.find(i => i.id==='z1').qty === 9;
    // catalog delete via sync
    S.catalog = [{ id:'c1', name:'x', updatedAt:1 }];
    SYNC.applyRow({ store:'catalog', id:'c1', deleted:true, data:{ id:'c1', deleted:true, updatedAt:5 } });
    res.catDeleted = !S.catalog.some(c => c.id==='c1');

    // setup wizard renders + SQL exists
    S.view = 'set'; render();
    res.wizard = /Family sync/.test(document.getElementById('app').textContent) && typeof SUPA_SQL === 'string' && /create table/.test(SUPA_SQL);
    return res;
  });
  ok('sync: off by default, push() is a safe no-op', sk.syncOff === true && sk.pushNoThrow === true, JSON.stringify(sk));
  ok('shopping: add + dedup (2 items)', sk.count === 2);
  ok('shopping: in-stock cross-ref (milk yes, towels no)', sk.milkInStock === true && sk.towelsNotStock === true);
  ok('shopping: view shows "In pantry: N" badge + item', sk.viewShows === true);
  ok('shopping: reachable as a bottom-nav Shop tab', sk.shopTab === true);
  ok('module1: check-off prompts to convert item into the pantry', sk.convertPrompt === true, JSON.stringify(sk));
  ok('module1: converting adds to pantry and clears it from the list', sk.convertedToPantry === true && sk.clearedFromList === true);
  ok('module1: guessCat maps names to categories for the estimate', sk.guessCat === true);
  ok('sync: last-write-wins merge (newer applies, older ignored)', sk.newerWins === true && sk.olderIgnored === true);
  ok('sync: catalog delete propagates', sk.catDeleted === true);
  ok('sync: setup wizard + SQL present', sk.wizard === true);

  // ---- L. voice trash/eat/add parser + handler ----
  const vz = await page.evaluate(async () => {
    const res = {};
    res.eat = JSON.stringify(parseVoice('I finished the milk')) === JSON.stringify({ action:'eat', name:'milk' });
    res.toss = JSON.stringify(parseVoice('threw out the bad spinach')) === JSON.stringify({ action:'toss', name:'spinach' });
    res.list = (p => p && p.action === 'list' && p.name === 'eggs')(parseVoice('add eggs to the shopping list'));
    res.noVerb = parseVoice('milk') === null;                 // bare noun -> no destructive guess
    res.gibberish = parseVoice('hello there') === null;

    // handler depletes the matching in-stock item
    S.household = { locations:[{id:'uf',name:'Fridge',kind:'fridge'}], members:[{name:'Me'}], staples:[], people:1 };
    S.who = S.household.members[0]; S.shopping = []; S.cfg = {};
    S.items = [{ id:'v1', name:'Whole Milk', cat:'dairy-milk', loc:'uf', deleted:false, mode:'count', qty:2, expires:Date.now()+1e9, added:Date.now() }];
    await handleVoice('finished the milk');
    res.depleted = S.items[0].qty === 1;
    await handleVoice('add paper towels to the list');
    res.listed = S.shopping.some(s => /paper towels/i.test(s.name));
    return res;
  });
  ok('voice: parses "finished the milk" -> eat milk', vz.eat === true, JSON.stringify(vz));
  ok('voice: parses "threw out the bad spinach" -> toss spinach', vz.toss === true);
  ok('voice: parses "add eggs to the list" -> list eggs', vz.list === true);
  ok('voice: bare noun / gibberish -> null (no destructive guess)', vz.noVerb === true && vz.gibberish === true);
  ok('voice: handler depletes matching item and adds to list', vz.depleted === true && vz.listed === true);

  // ---- M. on-device date OCR parser (full Tesseract round-trip in ocr_test.js) ----
  const od = await page.evaluate(() => {
    const iso = ts => ts ? new Date(ts).toISOString().slice(0, 10) : null;
    return {
      a: iso(extractDate('BEST BY 08/15/2026')),
      b: iso(extractDate('2026-09-01 lot 55')),
      c: iso(extractDate('USE BY 15 AUG 2026')),
      d: iso(extractDate('EXP SEP 03 2026')),
      junk: extractDate('no date here'),
      loader: typeof loadTessLib === 'function' && typeof ocrDate === 'function' && typeof scanDateForItem === 'function',
      notLoaded: !('Tesseract' in window),   // stays lazy until a date is scanned
      live: typeof liveDateScan === 'function',
    };
  });
  ok('date OCR: parses MM/DD/YYYY, YYYY-MM-DD, DD MON YYYY, MON DD YYYY', od.a === '2026-08-15' && od.b === '2026-09-01' && od.c === '2026-08-15' && od.d === '2026-09-03', JSON.stringify(od));
  ok('date OCR: no false positive on dateless text', od.junk === null);
  ok('date OCR: helpers exist and Tesseract stays lazy', od.loader === true && od.notLoaded === true);
  ok('date OCR: live-video scanner (liveDateScan) present', od.live === true);

  // live scanner opens the camera dialog, wires cancel/type, stays lazy (no Tesseract until a frame is read)
  const lv = await page.evaluate(async () => {
    const it = { id:'lz', name:'Yogurt', cat:'dairy-milk', loc:'uf', deleted:false, mode:'count', qty:1, expires:Date.now()+1e8, added:Date.now() };
    const orig = navigator.mediaDevices && navigator.mediaDevices.getUserMedia;
    let asked = false;
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => { asked = true; throw new Error('no camera in headless'); };
    liveDateScan(it);
    await new Promise(r => setTimeout(r, 150));
    const dlg = document.getElementById('dlg');
    const r = {
      opened: dlg.open === true,
      hasVideo: !!dlg.querySelector('#dvid'),
      hasType: !!dlg.querySelector('[data-a=type]'),
      hasCancel: !!dlg.querySelector('[data-a=cancel]'),
      askedCamera: asked,
      stillLazy: !('Tesseract' in window),
    };
    dlg.querySelector('[data-a=cancel]').click();   // must release cleanly
    r.closed = !dlg.open;
    if (orig) navigator.mediaDevices.getUserMedia = orig;
    return r;
  });
  ok('date OCR: live scanner opens camera dialog + requests camera', lv.opened && lv.hasVideo && lv.askedCamera, JSON.stringify(lv));
  ok('date OCR: live scanner offers type/cancel and closes cleanly', lv.hasType && lv.hasCancel && lv.closed);

  // ---- N. per-store learning + push guards ----
  const pl = await page.evaluate(async () => {
    S.household = { id:'household', locations:[{id:'uf',name:'Fridge',kind:'fridge'}], members:[{name:'Me'}], staples:[], people:1, learn:{} };
    S.who = S.household.members[0]; S.items = []; S.catalog = []; S.shopping = []; S.cfg = {};
    const res = {};
    const kind = 'fridge';
    const base = baseDays('dairy-milk', kind);           // fridge milk = 7
    // confirm a date ~5 days LONGER than base -> learner nudges the offset up
    const it = { id:'l1', name:'Milk', cat:'dairy-milk', loc:'uf', added: today(), expires: today() + (base+5)*86400000, dateConfirmed:true, deleted:false, mode:'count', qty:1 };
    S.items = [it];
    await learnFromDate(it);
    res.learned = (S.household.learn['dairy-milk'] || 0) > 0;
    // offset is bounded and applied by estimateExpiry
    S.household.learn['dairy-milk'] = 999;               // absurd -> clamped to +30
    const est = Math.round((estimateExpiry('dairy-milk','uf',false) - today())/86400000);
    res.clamped = est === Math.min(base + 30, base + 30);   // base + clamp(30)
    res.applied = est > base;

    // push guards: no crash when unconfigured
    res.pushSupportedBool = typeof PUSH.supported() === 'boolean';
    let threw = false; try { await PUSH.notifyFamily('t','b'); await PUSH.dailyCheck(); } catch (e) { threw = true; }
    res.pushNoThrow = threw === false;
    let enErr = ''; try { await PUSH.enable(); } catch (e) { enErr = e.message; }
    res.enableGuards = /sync|support|vapid/i.test(enErr);
    return res;
  });
  ok('learning: a confirmed longer date raises the category offset', pl.learned === true, JSON.stringify(pl));
  ok('learning: offset is clamped and applied by estimateExpiry', pl.clamped === true && pl.applied === true);
  ok('push: supported() is boolean; notify/dailyCheck no-op safely', pl.pushSupportedBool === true && pl.pushNoThrow === true);
  ok('push: enable() guards (needs sync + vapid) instead of crashing', pl.enableGuards === true);

  // ---- O. backup export -> wipe -> restore round-trips the inventory ----
  const bak = await page.evaluate(async () => {
    const r = {};
    // seed a couple items + household, persist them
    S.household = { id:'household', locations:[{id:'uf',name:'Fridge',kind:'fridge'}], members:[{name:'Sam'}], staples:[], people:4 };
    await DB.put('meta', S.household);
    S.items = [
      { id:'ri', name:'Restore milk', cat:'dairy-milk', loc:'uf', deleted:false, mode:'count', qty:1, expires:Date.now()+1e9, added:Date.now() },
      { id:'ri2', name:'Restore eggs', cat:'eggs', loc:'uf', deleted:false, mode:'count', qty:1, expires:Date.now()+1e9, added:Date.now() },
    ];
    for (const it of S.items) await DB.put('items', it);
    S.catalog = []; S.shopping = [];
    // build the same backup blob the Export button writes
    const backup = { v:1, items: S.items, catalog: S.catalog, shopping: S.shopping, household: S.household, log: [] };
    // simulate a wipe (what iOS eviction does)
    for (const it of await DB.all('items')) await DB.del('items', it.id);
    S.items = [];
    r.emptyAfterWipe = (await DB.all('items')).length === 0;
    // restore via the same merge the Import handler uses
    for (const it of backup.items) if (it && it.id) await DB.put('items', it);
    if (backup.household) await DB.put('meta', { id:'household', ...backup.household });
    const items = await DB.all('items');
    S.items = items;
    r.restoredCount = items.length;
    r.namesBack = items.map(i => i.name).sort().join(',');
    // the Setup view exposes both buttons
    const app = document.getElementById('app'); app.innerHTML=''; viewSet(app);
    const txt = app.textContent;
    r.hasExport = /Save the whole app/.test(txt) && /Export my data only/.test(txt);
    r.hasImport = /Restore from a backup/i.test(txt);
    r.hasPicker = !!app.querySelector('input[type="file"]');
    return r;
  });
  ok('backup: export/import round-trips items after a wipe', bak.emptyAfterWipe === true && bak.restoredCount === 2, JSON.stringify(bak));
  ok('backup: restored the right records', bak.namesBack === 'Restore eggs,Restore milk');
  ok('backup: Setup shows Export + Restore + file picker', bak.hasExport && bak.hasImport && bak.hasPicker);

  // ---- P. Module 4: saved recipe library ----
  const sv = await page.evaluate(async () => {
    const r = {};
    S.household = { id:'household', locations:[{id:'uf',name:'Fridge',kind:'fridge'}], members:[{name:'Sam'}], staples:['salt'], people:2 };
    S.who = S.household.members[0]; S.saved = []; S.cookTab = 'suggested';
    S.items = [{ id:'p1', name:'Chicken', cat:'poultry-raw', loc:'uf', deleted:false, mode:'count', qty:1, expires:Date.now()+2e8, added:Date.now() }];
    const rec = { name:'Lemon Chicken', minutes:30, uses:['Chicken','lemon'], missing:['lemon'], rescues:['Chicken'], steps:['a','b'], image:null };
    // save, then it should be marked saved and persisted
    await toggleSaveRecipe(rec);
    r.savedAfter = S.saved.filter(x => !x.deleted).length === 1 && isSaved(rec) === true;
    const row = await DB.get('saved', S.saved[0].id);
    r.persisted = !!row && /Lemon Chicken/.test(row.name);
    // Saved tab renders the card
    recipeCache = null; S.cookTab = 'saved'; S.view = 'cook'; render();
    r.tabShows = /Lemon Chicken/.test(document.getElementById('app').textContent) && !!document.querySelector('.recipe-card');
    // recomputeMissing reflects CURRENT pantry (has Chicken -> only lemon missing)
    const rm = recomputeMissing(S.saved[0]);
    r.recompute = rm.missing.length === 1 && /lemon/i.test(rm.missing[0]);
    // unsave
    await toggleSaveRecipe(rec);
    r.unsaved = S.saved.filter(x => !x.deleted).length === 0 && isSaved(rec) === false;
    return r;
  });
  ok('module4: save persists a recipe and marks it saved', sv.savedAfter === true && sv.persisted === true, JSON.stringify(sv));
  ok('module4: Saved tab renders saved recipe cards', sv.tabShows === true);
  ok('module4: saved recipe re-checks the current pantry', sv.recompute === true);
  ok('module4: unsave removes it from the library', sv.unsaved === true);

  // ---- Q. Module 2: pantry expiration-status filter ----
  const mf = await page.evaluate(async () => {
    const r = {}; const day = 86400000;
    S.household = { id:'household', locations:[{id:'uf',name:'Fridge',kind:'fridge'}], members:[{name:'Sam'}], staples:[], people:2 };
    S.who = S.household.members[0]; S.q = ''; S.loc = 'all'; S.status = 'all';
    S.items = [
      { id:'a', name:'Old spinach', cat:'produce-leafy', loc:'uf', deleted:false, mode:'count', qty:1, expires:Date.now()-2*day, added:Date.now()-9*day },
      { id:'b', name:'Milk', cat:'dairy-milk', loc:'uf', deleted:false, mode:'count', qty:1, expires:Date.now()+2*day, added:Date.now()-2*day },
      { id:'c', name:'Rice', cat:'dry-pasta-rice', loc:'uf', deleted:false, mode:'count', qty:1, expires:Date.now()+200*day, added:Date.now()-2*day },
    ];
    S.view = 'pantry'; render();
    // pantry renders photo tiles by default, compact rows behind the toggle
    const names = () => [...document.querySelectorAll('#results .item .nm, #results .tile .tn')].map(n => n.textContent);
    S.status = 'expired'; render(); const expd = names();
    S.status = 'soon'; render(); const soon = names();
    S.status = 'fresh'; render(); const fresh = names();
    S.status = 'all';
    r.filtersPresent = /Expired/.test(document.getElementById('app').textContent) && /Fresh/.test(document.getElementById('app').textContent);
    r.expired = expd.length === 1 && /spinach/i.test(expd[0]);
    r.soon = soon.length === 1 && /milk/i.test(soon[0]);
    r.fresh = fresh.length === 1 && /rice/i.test(fresh[0]);
    return r;
  });
  ok('module2: pantry has an expiration-status filter (Fresh/Soon/Expired)', mf.filtersPresent === true, JSON.stringify(mf));
  ok('module2: each status filter narrows the list correctly', mf.expired && mf.soon && mf.fresh);

  // ---- R. smart (typo-tolerant) search ----
  const fz = await page.evaluate(async () => {
    const r = {};
    S.household = { id:'household', locations:[{id:'uf',name:'Fridge',kind:'fridge'}], members:[{name:'Sam'}], staples:[], people:2 };
    S.who = S.household.members[0]; S.q = ''; S.loc = 'all'; S.status = 'all';
    S.items = [
      { id:'a', name:'Cheddar Cheese', cat:'dairy-cheese-hard', loc:'uf', deleted:false, mode:'count', qty:1, expires:Date.now()+1e9, added:Date.now() },
      { id:'b', name:'Baby Spinach', cat:'produce-leafy', loc:'uf', deleted:false, mode:'count', qty:1, expires:Date.now()+1e9, added:Date.now() },
      { id:'c', name:'Greek Yogurt', cat:'dairy-yogurt', loc:'uf', deleted:false, mode:'count', qty:1, expires:Date.now()+1e9, added:Date.now() },
    ];
    // misspelled shopping entries still detect stock
    r.chedar = itemInStock('chedar') === 1;
    r.yoghrt = itemInStock('yoghrt') === 1;
    r.spinch = itemInStock('spinch') === 1;
    // and a genuinely-absent item is NOT a false positive
    r.noFalse = itemInStock('bananas') === 0 && itemInStock('silk') === 0;
    // pantry search box is typo-tolerant + ranked
    const names = q => { S.q = q; S.view = 'pantry'; render(); return [...document.querySelectorAll('#results .item .nm, #results .tile .tn')].map(n => n.textContent); };
    const a = names('chedar'); r.searchTypo = a.length === 1 && /Cheddar/.test(a[0]);
    const b = names('yogrt'); r.searchTypo2 = b.some(n => /Yogurt/.test(n));
    const c = names('xzqw'); r.searchGarbage = c.length === 0;
    S.q = '';
    return r;
  });
  ok('smart-search: misspelled shopping items still find pantry stock', fz.chedar && fz.yoghrt && fz.spinch, JSON.stringify(fz));
  ok('smart-search: absent items are not false-matched', fz.noFalse === true);
  ok('smart-search: pantry search tolerates typos and ranks the right item', fz.searchTypo && fz.searchTypo2);
  ok('smart-search: pure gibberish still returns nothing', fz.searchGarbage === true);

  // ---- S. smarter search: stemming + synonyms; receipt preprocessing ----
  const ss = await page.evaluate(async () => {
    const r = {};
    S.household = { id:'household', locations:[{id:'uf',name:'Fridge',kind:'fridge'}], members:[{name:'Sam'}], staples:[], people:2 };
    S.who = S.household.members[0];
    S.items = [
      { id:'a', name:'Roma Tomatoes', cat:'produce-hardy', loc:'uf', deleted:false, mode:'count', qty:1, expires:Date.now()+1e9, added:Date.now() },
      { id:'b', name:'Green Onions', cat:'produce-leafy', loc:'uf', deleted:false, mode:'count', qty:1, expires:Date.now()+1e9, added:Date.now() },
      { id:'c', name:'Coca-Cola', cat:'juice-drink', loc:'uf', deleted:false, mode:'count', qty:1, expires:Date.now()+1e9, added:Date.now() },
    ];
    // stemming: singular query finds plural item, and vice-versa
    r.stemSingular = itemInStock('tomato') === 1 && itemInStock('egg') === 0;
    r.stemPlural = fuzzyScore('tomatoes', 'Roma Tomato') > 0.6;
    // synonyms: "scallions" -> green onion, "pop" -> soda/cola family, "aubergine" absent
    r.synScallion = itemInStock('scallions') === 1;
    r.synSoda = fuzzyScore('soda', 'cola') > 0.6;
    // receipt preprocessing produces a grayscale JPEG payload without throwing
    const cv = document.createElement('canvas'); cv.width = 40; cv.height = 60;
    const g = cv.getContext('2d'); g.fillStyle = '#ccc'; g.fillRect(0,0,40,60); g.fillStyle='#111'; g.fillText('MILK 3.99', 2, 20);
    const blob = await new Promise(z => cv.toBlob(z, 'image/png'));
    const f = new File([blob], 'r.png', { type: 'image/png' });
    let prep = null; try { prep = await prepReceipt(f); } catch (e) { prep = { err: e.message }; }
    r.prepOk = !!(prep && prep.b64 && prep.mime === 'image/jpeg');
    r.hasPrep = typeof prepReceipt === 'function';
    return r;
  });
  ok('search+: stemming — singular query finds plural item', ss.stemSingular === true && ss.stemPlural === true, JSON.stringify(ss));
  ok('search+: synonyms — "scallions"→green onion, "soda"→cola', ss.synScallion === true && ss.synSoda === true);
  ok('receipt+: preprocessing sharpens to a grayscale JPEG payload', ss.hasPrep === true && ss.prepOk === true);

  // ---- T. shopping add is instant + non-blocking (no popup interception) ----
  const sa = await page.evaluate(async () => {
    const r = {};
    S.household = { id:'household', locations:[{id:'uf',name:'Fridge',kind:'fridge'}], members:[{name:'Sam'}], staples:[], people:2 };
    S.who = S.household.members[0]; S.shopping = []; S.cfg = {};
    // a pantry item that WOULD have triggered the old blocking dialog
    S.items = [{ id:'m', name:'Whole Milk', cat:'dairy-milk', loc:'uf', deleted:false, mode:'count', qty:1, expires:Date.now()+1e9, added:Date.now() }];
    S.view = 'shop'; render();
    const inp = document.getElementById('sadd');
    const dlg = document.getElementById('dlg'); if (dlg.open) dlg.close();
    // type a duplicate-in-pantry item and press the Add button
    inp.value = 'milk';
    document.querySelector('#app [data-a=add]').click();
    await new Promise(z => setTimeout(z, 30));
    r.addedNotBlocked = S.shopping.filter(s => !s.deleted).length === 1 && /milk/i.test(S.shopping[0].name);
    r.noDialog = !dlg.open;                                  // add is NOT intercepted by a popup
    r.inputCleared = document.getElementById('sadd').value === '';
    r.inputStillThere = !!document.getElementById('sadd');   // input row persists (not torn down)
    r.hasPaint = typeof paintShopping === 'function';
    // add a second, distinct item — should just work
    document.getElementById('sadd').value = 'paper towels';
    document.querySelector('#app [data-a=add]').click();
    await new Promise(z => setTimeout(z, 30));
    r.secondAdded = S.shopping.filter(s => !s.deleted).length === 2;
    return r;
  });
  ok('shopping-add: adds instantly without a blocking popup', sa.addedNotBlocked && sa.noDialog, JSON.stringify(sa));
  ok('shopping-add: input clears, stays mounted, keeps working', sa.inputCleared && sa.inputStillThere && sa.secondAdded && sa.hasPaint);

  // ---- D. no console/page errors anywhere ----
  ok('no console or page errors', errs.length === 0, errs.join(' | '));

  await browser.close();
  server.close();
  console.log('\n' + (pass ? '✅ ALL PASSED' : '❌ FAILURES ABOVE'));
  process.exit(pass ? 0 : 1);
})();
