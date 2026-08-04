/* Parse index.html's script the way the browser will, and fail with a real
   line number.
 *
 * Everything else in test/ boots the app in a browser, which means a syntax
 * error shows up as every single suite failing with "S is not defined" — no
 * file, no line, no clue. This runs first and takes about 50ms, so a stray
 * bracket costs seconds instead of a confused hunt through nineteen suites.
 *
 * The line numbers reported are offset to the real file, not the extracted
 * fragment, because a number that doesn't match the editor is worse than
 * none. */
const fs = require('fs'), path = require('path'), vm = require('vm');

const FILE = path.resolve(__dirname, '..', 'index.html');
const src = fs.readFileSync(FILE, 'utf8');

/* Inline scripts only — a src= tag is a separate file with its own life. */
const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
let m, blocks = [];
while ((m = re.exec(src))) {
  blocks.push({ code: m[1], line: src.slice(0, m.index).split('\n').length });
}

if (!blocks.length) {
  console.log('FAIL  no inline script found in index.html');
  process.exit(1);
}

let bad = 0;
for (const b of blocks) {
  try {
    new vm.Script(b.code, { filename: 'index.html' });
  } catch (e) {
    bad++;
    /* v8 reports the line within the fragment; shift it onto the real file. */
    const rel = Number(String(e.stack || '').match(/index\.html:(\d+)/)?.[1] || 0);
    const abs = rel ? b.line + rel - 1 : b.line;
    console.log(`FAIL  index.html:${abs}  ${e.message}`);
    const lines = src.split('\n');
    for (let i = Math.max(0, abs - 3); i < Math.min(lines.length, abs + 2); i++) {
      console.log(`   ${i + 1 === abs ? '>' : ' '} ${i + 1}| ${lines[i]}`);
    }
  }
}

/* The service worker is a real script too, and a broken one takes the
   offline behaviour with it while the app still looks fine. */
for (const f of ['sw.js']) {
  const p = path.resolve(__dirname, '..', f);
  if (!fs.existsSync(p)) continue;
  try { new vm.Script(fs.readFileSync(p, 'utf8'), { filename: f }); }
  catch (e) { bad++; console.log(`FAIL  ${f}  ${e.message}`); }
}

/* The manifest is JSON that the browser silently ignores when malformed —
   which costs the install prompt, the icon and the share target at once. */
for (const f of ['manifest.webmanifest']) {
  const p = path.resolve(__dirname, '..', f);
  if (!fs.existsSync(p)) continue;
  try { JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { bad++; console.log(`FAIL  ${f}  ${e.message}`); }
}

console.log(bad
  ? `\n${bad} file(s) will not parse.`
  : `${blocks.length} inline script(s), sw.js and the manifest all parse.`);
process.exit(bad ? 1 : 0);
