// End-to-end check of the BUILT extension (dist/) in a real Chromium.
//
// Serves a ChatGPT-like fixture page at https://chatgpt.com/* via request
// interception (no real ChatGPT traffic, no login), loads the unpacked
// extension, opens the side panel page bound to that tab (?tabId=N) and drives
// it. Screenshots are written to e2e/output/.
//
// Usage: pnpm build && CHROME_BIN=/path/to/chromium pnpm test:e2e
// Chrome-branded stable builds no longer allow --load-extension; use Chromium
// or Chrome for Testing (e.g. `pnpm exec playwright-core install chromium`).
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EXT = join(ROOT, 'dist');
const OUT = join(ROOT, 'e2e', 'output');
mkdirSync(OUT, { recursive: true });

function findChromium() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  const cache = join(homedir(), '.cache', 'ms-playwright');
  if (!existsSync(cache)) return undefined;
  const dirs = readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse();
  for (const d of dirs) {
    const bin = join(cache, d, 'chrome-linux64', 'chrome');
    if (existsSync(bin)) return bin;
  }
  return undefined;
}
const CHROME = findChromium();
if (!existsSync(join(EXT, 'manifest.json'))) {
  console.error('dist/manifest.json not found. Run `pnpm build` first.');
  process.exit(2);
}
if (!CHROME) {
  console.error('No Chromium found. Set CHROME_BIN or run `pnpm exec playwright-core install chromium`.');
  process.exit(2);
}

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

function turn(i, role, id, body) {
  const inner = role === 'user' ? `<div class="whitespace-pre-wrap">${body}</div>` : `<div class="markdown prose">${body}</div>`;
  return `<article data-testid="conversation-turn-${i}" data-turn="${role}" style="padding:24px 0;min-height:120px"><h5 class="sr-only">${role === 'user' ? 'You said:' : 'ChatGPT said:'}</h5><div data-message-author-role="${role}" data-message-id="${id}">${inner}</div><div><button>Copy</button></div></article>`;
}
function conversation(prefix, n) {
  let html = '';
  for (let i = 1; i <= n; i++) {
    const role = i % 2 ? 'user' : 'assistant';
    const topic = ['Redis', 'RabbitMQ prefetch', 'Kafka', 'tiếng Việt', 'Postgres'][i % 5];
    const body =
      role === 'user'
        ? `Question ${i}: explain ${topic}?`
        : `<h3>About ${topic}</h3><p>Answer ${i}: ${topic} details. ${'Lorem ipsum dolor sit amet. '.repeat(i % 3 ? 3 : 30)}</p>${i % 4 === 0 ? '<pre><code class="language-js">const x = 1;</code></pre>' : ''}${i % 6 === 0 ? '<table><tr><td>a</td></tr></table>' : ''}`;
    html += turn(i, role, `${prefix}-${i}`, body);
  }
  return html;
}
const PAGE = (title, prefix, n) => `<!doctype html><html><head><meta charset="utf-8"><title>${title} - ChatGPT</title>
<style>.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)} body{margin:0;font:14px sans-serif} #scroll{height:100vh;overflow-y:auto} #thread{max-width:700px;margin:auto}</style></head>
<body><div id="app"><main><div id="scroll"><div id="thread">${conversation(prefix, n)}</div></div>
<form id="composer" style="position:fixed;bottom:0;left:0;right:0;background:#eee"><div id="prompt-textarea" contenteditable="true"><p>draft prompt</p></div><button type="button" data-testid="send-button">Send</button></form>
</main></div></body></html>`;

const userDataDir = mkdtempSync(join(tmpdir(), 'cmn-e2e-'));
const ctx = await chromium.launchPersistentContext(userDataDir, {
  executablePath: CHROME,
  headless: true,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  viewport: { width: 1100, height: 800 },
});

const foreignRequests = [];
const errors = [];
ctx.on('request', (r) => {
  const u = r.url();
  if (!u.startsWith('https://chatgpt.com/') && !u.startsWith('chrome-extension://') && !u.startsWith('data:')) foreignRequests.push(u);
});
await ctx.route('https://chatgpt.com/**', (route) => {
  const url = new URL(route.request().url());
  if (url.pathname.startsWith('/c/conv-one')) return route.fulfill({ contentType: 'text/html; charset=utf-8', body: PAGE('Redis questions', 'm1', 60) });
  return route.fulfill({ contentType: 'text/html; charset=utf-8', body: PAGE('Other', 'mx', 4) });
});

let sw = ctx.serviceWorkers()[0];
if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 10000 });
const extId = new URL(sw.url()).host;
check('extension service worker running', !!extId, extId);

const behavior = await sw.evaluate(() => chrome.sidePanel.getPanelBehavior());
check('toolbar action opens side panel', behavior.openPanelOnActionClick === true);
const manifest = await sw.evaluate(() => chrome.runtime.getManifest());
check('manifest v3 with minimal permissions', manifest.manifest_version === 3 && JSON.stringify(manifest.permissions) === '["sidePanel","storage","scripting"]', JSON.stringify(manifest.permissions));
const cmds = await sw.evaluate(() => chrome.commands.getAll());
check('Alt+Shift+J command registered', cmds.some((c) => c.name === 'open-navigator'), JSON.stringify(cmds.map((c) => [c.name, c.shortcut])));

const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push('page: ' + e.message));
page.on('console', (m) => m.type() === 'error' && errors.push('page console: ' + m.text()));
await page.goto('https://chatgpt.com/c/conv-one-1111');
await page.waitForTimeout(500);
const tabId = await sw.evaluate(async () => (await chrome.tabs.query({ url: 'https://chatgpt.com/*' }))[0]?.id);
check('ChatGPT tab found', typeof tabId === 'number', String(tabId));

const panel = await ctx.newPage();
panel.on('pageerror', (e) => errors.push('panel: ' + e.message));
panel.on('console', (m) => m.type() === 'error' && errors.push('panel console: ' + m.text()));
await panel.setViewportSize({ width: 380, height: 760 });
await panel.goto(`chrome-extension://${extId}/src/sidepanel/index.html?tabId=${tabId}`);
await panel.waitForSelector('[role=option]', { timeout: 10000 });
// Counts are exposed as data attributes on the list header (the visible text is Vietnamese).
const statsText = async () =>
  panel.$eval('[data-testid=stats]', (el) => `${el.dataset.total} indexed ${el.dataset.user} you ${el.dataset.assistant} ChatGPT ${el.dataset.unmounted} not rendered`);
check('initial index shows 60 messages', /60 indexed/.test(await statsText()), await statsText());
check('conversation title shown', (await panel.textContent('[data-testid=conversation-title]')) === 'Redis questions');
const firstRow = await panel.$eval('[role=option]', (el) => ({
  num: el.querySelector('[data-testid=row-num]')?.textContent,
  role: el.querySelector('[data-testid=role]')?.textContent,
  title: el.querySelector('[data-testid=row-title]')?.textContent,
}));
check('first row is #1 user message', firstRow.num === '#1' && firstRow.role === 'Bạn' && firstRow.title === 'Question 1: explain RabbitMQ prefetch?', JSON.stringify(firstRow));
await panel.screenshot({ path: join(OUT, 'panel-light.png') });

// Search (accent-insensitive Vietnamese)
await panel.fill('input[type=search]', 'tieng viet');
await panel.waitForTimeout(400);
const count = await panel.textContent('[data-testid=result-count]');
check('search "tieng viet" finds accented messages', /^12 \/ 60$/.test(count?.trim() ?? ''), count);
check('search highlights matches', (await panel.$$eval('mark', (ms) => ms.map((m) => m.textContent))).includes('tiếng'));
await panel.screenshot({ path: join(OUT, 'panel-search.png') });
await panel.keyboard.press('Escape');
await panel.waitForTimeout(250);
check('Escape clears search', (await panel.inputValue('input[type=search]')) === '');

// Filters
await panel.click('button[role=radio]:has-text("Của tôi")');
await panel.waitForTimeout(100);
const mineRoles = await panel.$$eval('[role=option] [data-testid=role]', (els) => [...new Set(els.map((e) => e.textContent))]);
check('"Của tôi" filter shows only user messages', mineRoles.length === 1 && mineRoles[0] === 'Bạn', JSON.stringify(mineRoles));
await panel.click('button[role=radio]:has-text("ChatGPT")');
await panel.waitForTimeout(100);
const gptRoles = await panel.$$eval('[role=option] [data-testid=role]', (els) => [...new Set(els.map((e) => e.textContent))]);
check('"ChatGPT" filter shows only responses', gptRoles.length === 1 && gptRoles[0] === 'ChatGPT', JSON.stringify(gptRoles));
check('no Code / Tables filter chips', (await panel.$$('button[aria-pressed]:has-text("Code"), button[aria-pressed]:has-text("Tables")')).length === 0);
await panel.click('button[role=radio]:has-text("Tất cả")');

// Jump to message
const scrollBefore = await page.evaluate(() => document.getElementById('scroll').scrollTop);
await panel.fill('input[type=search]', 'Answer 40');
await panel.waitForTimeout(400);
await panel.click('[role=option]');
// Smooth scrolling of a background page can stall in headless Chromium: wait for the result, not a fixed time.
await page
  .waitForFunction(() => { const r = document.querySelector('[data-message-id="m1-40"]').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }, null, { timeout: 5000 })
  .catch(() => null);
const jump = await page.evaluate(() => {
  const el = document.querySelector('[data-message-id="m1-40"]');
  const r = el.getBoundingClientRect();
  return { top: r.top, bottom: r.bottom, vh: innerHeight, scrollTop: document.getElementById('scroll').scrollTop, draft: document.querySelector('#prompt-textarea').textContent, active: document.activeElement?.tagName };
});
check('click scrolls ChatGPT to the message', jump.scrollTop > scrollBefore && jump.top < jump.vh && jump.bottom > 0, JSON.stringify(jump));
check('composer untouched by navigation', jump.draft === 'draft prompt');
await panel.waitForFunction(() => !document.querySelector('[role=option][aria-busy=true]'), null, { timeout: 3000 }).catch(() => null);
check('jump loading indicator clears once the jump is done', (await panel.$$('[role=option][aria-busy=true]')).length === 0);
await panel.fill('input[type=search]', '');
await panel.waitForTimeout(400);

// Active message tracking (the ChatGPT tab is visible next to a real side panel)
await page.bringToFront();
await page.evaluate(() => document.getElementById('scroll').scrollBy(0, -300));
await page.waitForTimeout(800);
// Listen on a second port to the content script for ACTIVE_MESSAGE while the user scrolls.
const probe = panel.evaluate((tabId) => new Promise((resolve) => {
  const seen = [];
  const port = chrome.tabs.connect(tabId, { name: 'cmn-navigator' });
  port.onMessage.addListener((m) => { if (m.type === 'ACTIVE_MESSAGE') seen.push(m.messageId); });
  setTimeout(() => { port.disconnect(); resolve(seen); }, 2500);
}), tabId);
await page.waitForTimeout(300);
await page.evaluate(() => document.getElementById('scroll').scrollBy(0, 900));
await page.waitForTimeout(800);
await page.evaluate(() => document.getElementById('scroll').scrollBy(0, 900));
const activeSeen = await probe;
const expected = await page.evaluate(() => {
  const y = innerHeight * 0.375;
  const el = document.elementFromPoint(300, y)?.closest('[data-testid^="conversation-turn-"]');
  return el?.querySelector('[data-message-id]')?.getAttribute('data-message-id') ?? null;
});
check('active message follows ChatGPT scrolling', activeSeen.length >= 2 && activeSeen.at(-1) === expected, JSON.stringify({ activeSeen, expected }));
// The panel highlights it once the list follows (pointer left the list + grace period).
await panel.mouse.move(5, 5);
await panel.waitForTimeout(4700); // > INTERACTION_GRACE_MS (4000) with margin
await page.evaluate(() => document.getElementById('scroll').scrollBy(0, 300));
await panel.waitForSelector('[role=option][data-active]', { timeout: 4000 }).catch(() => null);
const activeRow = await panel.$eval('[role=option][data-active]', (e) => e.querySelector('[data-testid=row-num]')?.textContent).catch(() => null);
check('panel list follows and highlights the active message', activeRow !== null, String(activeRow));

// Auto update: new message + streaming
await page.evaluate(() => {
  const t = document.getElementById('thread');
  t.insertAdjacentHTML('beforeend', '<article data-testid="conversation-turn-61" data-turn="user"><div data-message-author-role="user" data-message-id="m1-61"><div class="whitespace-pre-wrap">Brand new question about streaming</div></div></article>');
  document.getElementById('composer').insertAdjacentHTML('beforeend', '<button type="button" data-testid="stop-button">Stop</button>');
  t.insertAdjacentHTML('beforeend', '<article data-testid="conversation-turn-62" data-turn="assistant"><div data-message-author-role="assistant" data-message-id="m1-62"><div class="markdown"><p id="stream">Streaming</p></div></div></article>');
});
await page.waitForTimeout(700);
check('new messages appear automatically', /62 indexed/.test(await statsText()), await statsText());
await panel.focus('[role=listbox]');
await panel.keyboard.press('End');
await panel.waitForTimeout(100);
check('streaming badge shown', (await panel.$$('[data-testid=badge-live]')).length === 1);
for (const w of [' response', ' grows', ' word', ' by', ' word']) {
  await page.evaluate((w) => document.getElementById('stream').append(w), w);
  await page.waitForTimeout(150);
}
await page.evaluate(() => document.querySelector('[data-testid=stop-button]').remove());
await page.waitForTimeout(1800);
await panel.fill('input[type=search]', 'grows word');
await panel.waitForTimeout(400);
const streamed = await panel.$$eval('[role=option] [data-testid=row-title]', (els) => els.map((e) => e.textContent));
check('streamed text indexed once, no duplicates', streamed.length === 1 && streamed[0] === 'Streaming response grows word by word', JSON.stringify(streamed));
check('streaming badge cleared when done', (await panel.$$('[data-testid=badge-live]')).length === 0);
await panel.fill('input[type=search]', '');
await panel.waitForTimeout(300);

// Bookmarks
await panel.hover('[role=option] >> nth=2');
await panel.click('[role=option] >> nth=2 >> button[aria-label="Thêm vào yêu thích"]');
await panel.waitForTimeout(300);
const stored = await sw.evaluate(() => chrome.storage.local.get(null));
const bm = Object.values(stored['cmn.bookmarks.v1'] ?? {});
check('bookmark saved to chrome.storage.local (metadata only)', bm.length === 1 && bm[0].messageId === 'm1-3' && bm[0].conversationId === 'conv-one-1111' && bm[0].preview.length <= 160, JSON.stringify(bm));
await panel.reload();
await panel.waitForSelector('[role=option]');
await panel.click('button[role=radio]:has-text("Yêu thích")');
await panel.waitForTimeout(200);
const savedRows = await panel.$$eval('[role=option] [data-testid=row-num]', (els) => els.map((e) => e.textContent));
check('bookmark persists after panel reload', savedRows.length === 1 && savedRows[0] === '#3', JSON.stringify(savedRows));
await panel.click('button[role=radio]:has-text("Tất cả")');

// Keyboard navigation in list
await panel.focus('[role=listbox]');
await panel.keyboard.press('Home');
await panel.keyboard.press('ArrowDown');
await panel.keyboard.press('ArrowDown');
await panel.keyboard.press('Enter');
await page.waitForTimeout(1200);
const kbSel = await panel.$eval('[role=option][aria-selected=true] [data-testid=row-num]', (e) => e.textContent).catch(() => null);
const kbTarget = await page.evaluate(() => { const r = document.querySelector('[data-message-id="m1-3"]').getBoundingClientRect(); return { top: Math.round(r.top), vh: innerHeight, st: document.getElementById('scroll').scrollTop }; });
check('keyboard Arrow/Enter jumps to message #3', kbSel === '#3' && kbTarget.top >= 0 && kbTarget.top < kbTarget.vh, JSON.stringify({ kbSel, ...kbTarget }));

// Index more (all messages are mounted here, so nothing new should be found)
await panel.click('button[aria-label="Quét toàn bộ"]');
await panel.waitForFunction(() => /Xong/.test(document.querySelector('[data-testid=banner]')?.textContent ?? ''), null, { timeout: 30000 }).catch(() => null);
const bannerText = await panel.textContent('[data-testid=banner]').catch(() => '');
check('Index more completes and restores position', /Xong/.test(bannerText ?? ''), bannerText);
check('Index more button is back to idle', (await panel.$$('button[aria-label="Quét toàn bộ"]:not([aria-busy])')).length === 1);

// Rescan shows a loading state until the fresh snapshot arrives. Bring the panel
// to the front first: Playwright's actionability checks wait for animation
// frames, which are throttled in a background tab.
await panel.bringToFront();
const rescanBusy = panel.waitForSelector('button[aria-label="Quét lại"][aria-busy=true]', { timeout: 5000 }).then(() => true, () => false);
await panel.click('button[aria-label="Quét lại"]');
const rescanSawBusy = await rescanBusy;
await panel.waitForSelector('button[aria-label="Quét lại"][aria-busy=false]', { timeout: 5000 }).catch(() => null);
check('Rescan shows loading, then returns to idle', rescanSawBusy && (await panel.$$('button[aria-label="Quét lại"][aria-busy=false]')).length === 1, String(rescanSawBusy));
check('no "Cuộc trò chuyện mới" button and no code/table icons', (await panel.$$('button:has-text("Cuộc trò chuyện mới"), [title="Có code"], [title="Có bảng"]')).length === 0);

// SPA navigation to another conversation
await page.evaluate(() => {
  history.pushState({}, '', '/c/conv-two-2222');
  document.title = 'Kafka chat - ChatGPT';
  document.getElementById('thread').innerHTML = '<article data-testid="conversation-turn-1" data-turn="user"><div data-message-author-role="user" data-message-id="c2-1"><div class="whitespace-pre-wrap">Second conversation question</div></div></article><article data-testid="conversation-turn-2" data-turn="assistant"><div data-message-author-role="assistant" data-message-id="c2-2"><div class="markdown"><p>Second conversation answer</p></div></div></article>';
});
await page.waitForTimeout(1500);
check('conversation switch re-indexes without mixing', /2 indexed/.test(await statsText()) && (await panel.textContent('[data-testid=conversation-title]')) === 'Kafka chat', `${await statsText()} | ${await panel.textContent('[data-testid=conversation-title]')}`);
await panel.click('button[role=radio]:has-text("Yêu thích")');
await panel.waitForTimeout(200);
check('bookmarks scoped to conversation', (await panel.$$('[role=option]')).length === 0);
await panel.click('button[role=radio]:has-text("Tất cả")');

// Navigate back -> the thread's index is remembered: the bookmarked message is
// listed (not rendered) even though ChatGPT hasn't rendered it.
await page.evaluate(() => {
  history.pushState({}, '', '/c/conv-one-1111');
  document.getElementById('thread').innerHTML = '';
});
await page.waitForTimeout(1200);
await panel.click('button[role=radio]:has-text("Yêu thích")');
await panel.waitForTimeout(200);
check('switching back remembers the thread (bookmark listed, not rendered)', (await panel.$$('[role=option][data-unmounted]')).length === 1, String((await panel.$$('[role=option]')).length));
check('remembered thread keeps its full index', /62 indexed/.test(await statsText()), await statsText());

// Fresh page load where the bookmarked message is never rendered -> unavailable
await page.addInitScript(() => {
  if (location.search !== '?empty') return;
  document.addEventListener('DOMContentLoaded', () => {
    const thread = document.getElementById('thread');
    if (thread) thread.innerHTML = '';
  });
});
await page.goto('https://chatgpt.com/c/conv-one-1111?empty');
await page.waitForTimeout(1500);
await panel.click('button[role=radio]:has-text("Yêu thích")');
await panel.waitForTimeout(300);
check('missing bookmarked message shows unavailable state', (await panel.$$('[role=option][data-missing]')).length === 1);
await panel.screenshot({ path: join(OUT, 'panel-unavailable.png') });

// Dark mode render
await page.goto('https://chatgpt.com/c/conv-one-1111');
await panel.emulateMedia({ colorScheme: 'dark' });
await panel.click('button[role=radio]:has-text("Tất cả")');
await panel.waitForSelector('[role=option]', { timeout: 10000 });
await panel.waitForTimeout(500);
check('reconnects after full page reload', /60 indexed/.test(await statsText()), await statsText());
await panel.screenshot({ path: join(OUT, 'panel-dark.png') });

check('no JS errors in page or panel', errors.length === 0, errors.join(' | '));
check('no requests to third-party hosts', foreignRequests.length === 0, foreignRequests.join(', '));

await ctx.close();
rmSync(userDataDir, { recursive: true, force: true });
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
