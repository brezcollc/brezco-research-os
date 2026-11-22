// Test harness: serves /budget from disk via request interception (no server process).
const { chromium, devices } = require('playwright');
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
async function open({ today = '2026-11-22', device = 'iPhone 14 Pro', query = '' } = {}) {
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices[device], deviceScaleFactor: 1 });
  await ctx.route('http://app.test/**', route => {
    const u = new URL(route.request().url());
    let f = decodeURIComponent(u.pathname.replace(/^\/budget\/?/, '')) || 'index.html';
    const full = path.join(ROOT, f);
    if (!full.startsWith(ROOT) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) return route.fulfill({ status: 404, body: 'nf' });
    route.fulfill({ status: 200, body: fs.readFileSync(full), headers: { 'content-type': TYPES[path.extname(full)] || 'application/octet-stream' } });
  });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await p.goto(`http://app.test/budget/?today=${today}${query}`);
  return { b, ctx, p, errs };
}
module.exports = { open };
