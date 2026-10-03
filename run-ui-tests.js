/* Runs every test-ui*.html page in headless Chrome and exits non-zero on any
   failure. Each page gets a fresh profile, so localStorage never leaks between
   pages or runs.
   Run: node run-ui-tests.js          (needs Chrome or Edge installed) */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
/* Async on purpose: a sync spawn blocks this process's event loop, so the
   in-process server below could never answer Chrome and the run hangs. */
const run = (cmd, args) => new Promise(res =>
  execFile(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 120000 },
    (err, stdout) => res(String(stdout || ''))));

const CHROMES = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
].filter(Boolean);
const chrome = CHROMES.find(p => fs.existsSync(p));
if (!chrome) { console.error('No Chrome/Edge found; set CHROME=<path>'); process.exit(2); }

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
                '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
const root = __dirname;
const server = http.createServer((req, res) => {
  const file = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); return res.end();
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

server.listen(0, async () => {
  const port = server.address().port;
  const pages = fs.readdirSync(root).filter(f => /^test-ui.*\.html$/.test(f)).sort();
  let failed = 0;
  for (const page of pages) {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-ui-'));
    const dom = await run(chrome, ['--headless=new', '--disable-gpu', `--user-data-dir=${profile}`,
      '--virtual-time-budget=10000', '--dump-dom', `http://localhost:${port}/${page}`]);
    fs.rmSync(profile, { recursive: true, force: true });
    const m = dom.match(/data-result="([^"]*)"/);
    let r = null;
    try { r = m && m[1] ? JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&')) : null; } catch {}
    if (!r) { failed++; console.log(`✗ ${page}: no result (page crashed or never called finish())`); continue; }
    if (r.fail) failed++;
    console.log(`${r.fail ? '✗' : '✓'} ${page}: ${r.pass} passed, ${r.fail} failed`);
    (r.failMsgs || []).forEach(msg => console.log('    ✗ ' + msg));
  }
  server.close();
  process.exit(failed ? 1 : 0);
});
