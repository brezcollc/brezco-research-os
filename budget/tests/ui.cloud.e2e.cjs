// Cloud sign-in + sync end-to-end, with Supabase replaced by tests/fake-supabase.js.
// Run: node budget/tests/ui.cloud.e2e.cjs
const { open } = require('./harness.cjs');
const fs = require('fs'), path = require('path');
const assert = require('assert');
let failed = 0;
(async () => {
  const { b, ctx, p, errs } = await open();
  await ctx.route('https://esm.sh/**', r => r.fulfill({ status: 200, headers: { 'content-type': 'text/javascript' }, body: fs.readFileSync(path.join(__dirname, 'fake-supabase.js')) }));
  const step = async (name, fn) => { try { await fn(); console.log('✓', name); } catch (e) { failed++; console.log('✗', name, '\n   ', e.message.split('\n')[0]); } };
  const db = () => p.evaluate(() => JSON.parse(sessionStorage.getItem('fakeSupabase') || '{}'));
  const count = async t => Object.keys((await db()).tables?.[t] || {}).length;
  await p.reload(); await p.waitForSelector('.welcome');

  await step('device-only use first: add a transaction', async () => {
    await p.click('text=Use on this device only'); await p.waitForSelector('.hero');
    await p.click('.fab'); await p.fill('.sheet [name="amount"]', '12.34');
    await p.click('.sheet .cat-grid button:has-text("Groceries")'); await p.click('.sheet button[type="submit"]');
    await p.waitForSelector('.sheet', { state: 'detached' });
  });
  await step('"Create account" with an email that already exists explains what to do', async () => {
    await p.click('.nav button[data-tab="settings"]'); await p.click('[data-act="signInSheet"]');
    await p.click('.sheet [data-amode] button[data-k="signup"]');
    await p.fill('.sheet [name="email"]', 'me@example.com'); await p.fill('.sheet [name="password"]', 'whatever123');
    await p.click('.sheet button[type="submit"]');
    await p.waitForSelector('.sheet [data-err]:has-text("already has an account")');
  });
  await step('"Sign in" without a password set gives the Forgot-password hint', async () => {
    await p.click('.sheet [data-amode] button[data-k="signin"]');
    await p.click('.sheet button[type="submit"]');
    await p.waitForSelector('.sheet [data-err]:has-text("Forgot password")');
  });
  await step('Forgot password, then sign in', async () => {
    await p.click('.sheet [data-forgot]');
    await p.waitForSelector('.sheet [data-err]:has-text("reset email sent")');
    await p.fill('.sheet [name="password"]', 'newpassword1');
    await p.click('.sheet button[type="submit"]');
    await p.waitForSelector('.sheet', { state: 'detached' });
    await p.waitForSelector('.sync-dot.synced', { timeout: 5000 });
  });
  await step('device data + default categories uploaded, nothing rejected', async () => {
    await p.waitForTimeout(800);
    assert.equal(await count('budget_transactions'), 1);
    assert.equal(await count('budget_categories'), 17);
    assert.equal(await count('budget_settings'), 1);
    const outbox = await p.evaluate(() => Object.keys(localStorage).filter(k => k.endsWith('.outbox')).map(k => JSON.parse(localStorage.getItem(k)).length));
    assert.deepEqual(outbox, [0]);
    const txt = await p.locator('.nav button[data-tab="settings"]').count();
    void txt;
  });
  await step('new entries sync; balance + budget + bill reach the server', async () => {
    await p.click('[data-act="editBalance"] >> nth=0'); await p.fill('.sheet [name="amount"]', '1800'); await p.click('.sheet button[type="submit"]');
    await p.waitForSelector('.sheet', { state: 'detached' });
    await p.click('.nav button[data-tab="budget"]'); await p.click('.seg button[data-seg="bills"]');
    await p.click('text=Add recurring bill'); await p.fill('.sheet [name="name"]', 'Rent'); await p.fill('.sheet [name="amount"]', '1500');
    await p.click('.sheet button[type="submit"]'); await p.waitForSelector('.sheet', { state: 'detached' });
    await p.waitForTimeout(900);
    assert.equal(await count('budget_bills'), 1);
    assert.equal((await db()).tables.budget_settings['u-existing'].balance_cents, 180000);
  });
  await step('sign out and back in restores everything from the server', async () => {
    await p.click('.nav button[data-tab="settings"]'); await p.click('[data-act="signOut"]'); await p.click('.sheet button[data-c="1"]');
    await p.waitForSelector('.welcome');
    await p.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('runway.v1.cloud')) localStorage.removeItem(k); }); // like a new phone
    await p.click('.welcome [data-mode="signin"]');
    await p.fill('.sheet [name="email"]', 'me@example.com'); await p.fill('.sheet [name="password"]', 'newpassword1');
    await p.click('.sheet button[type="submit"]'); await p.waitForSelector('.hero');
    await p.waitForSelector('.sync-dot.synced', { timeout: 5000 });
    const st = await p.evaluate(() => { const k = Object.keys(localStorage).find(k => k.startsWith('runway.v1.cloud') && k.endsWith('.data')); return JSON.parse(localStorage.getItem(k)); });
    assert.equal(st.transactions.length, 1);
    assert.equal(st.bills.length, 1);
    assert.equal(st.categories.length, 17, 'no duplicate default categories');
  });
  console.log(errs.length ? 'console errors:\n' + errs.join('\n') : 'no console errors');
  await b.close();
  process.exit(failed || errs.length ? 1 : 0);
})();
