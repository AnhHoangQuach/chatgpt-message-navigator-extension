# Chat Navigator

> Works on chatgpt.com. Not affiliated with, endorsed by, or sponsored by OpenAI. "ChatGPT" is a trademark of OpenAI.

A Chrome extension (Manifest V3) that adds a searchable, filterable navigation panel for the messages of the ChatGPT conversation open at `chatgpt.com`. It runs in Chrome's **Side Panel**, next to the conversation.

- **Message index**: every rendered message, in order, as a card with role, the first sentence and a one-line preview.
- **Jump to message**: click a message (or press Enter) to scroll ChatGPT to it smoothly. The message is centered, or top-aligned if it is tall, and briefly highlighted.
- **Instant search**: case-insensitive and Unicode-normalized. Vietnamese works accent-insensitively: `tieng viet` finds *tiếng Việt*, while typing diacritics makes the match exact. Matches are highlighted and a result count is shown.
- **Filters**: All / Mine / ChatGPT / Saved (bookmarks). Filters combine with search.
- **Live updates**: new prompts, streaming responses, edits, branch switches and conversation switches are picked up automatically.
- **Active message tracking**: the message you are reading in ChatGPT is marked in the list, and the list follows it unless you are using the list.
- **Bookmarks**: stored locally in `chrome.storage.local`, persist across reloads and restarts, and show an *unavailable* state when the message isn't on the page.
- **Indexing as you scroll**: ChatGPT only keeps the turns near the viewport in the page. The navigator never scrolls by itself: it indexes what ChatGPT renders, so scrolling up through a thread adds the older messages. **Index more** scrolls through the whole thread on demand, then returns you to where you were; any wheel, key or click stops it.
- **Per-thread memory**: the index (and where each message was) of the last 10 threads you visited is kept in memory, so switching threads and coming back doesn't lose what was already indexed.
- **Jump to any message**, including ones ChatGPT has unmounted: the navigator scrolls to where the message was last seen, waits for ChatGPT to render it, then centers and highlights it.
- **Keyboard**: Alt+Shift+J opens the panel. Arrow keys, Enter, Esc, `/` and `B` work inside the panel.
- **Local only**: no backend, no third-party APIs, no analytics, and no network requests.

---

## Quick start

Requirements: Node.js 26.13 LTS (see `.nvmrc`), pnpm 11 (pinned via `packageManager`) and Chrome 116+.
Node 26 no longer ships corepack, so install pnpm once with `npm install -g pnpm@11`; pnpm then switches itself to the exact pinned version.

pnpm 11 refuses packages published less than a day ago (`minimumReleaseAge`) and runs dependency build scripts only for packages listed under `allowBuilds` in `pnpm-workspace.yaml` (only `esbuild`).

```bash
pnpm install
pnpm build         # type-check + production build into dist/
```

Load it in Chrome:

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the **`dist/`** folder. Select `dist/`, not the project root.
4. Open <https://chatgpt.com>, open a conversation, and click the extension's toolbar icon, or press **Alt+Shift+J**. The navigator opens in the side panel.

> Tip: pin the extension from the puzzle-piece menu so the icon is always visible.

### All commands

| Command | What it does |
| --- | --- |
| `pnpm install` | Install dependencies. |
| `pnpm dev` | Rebuild `dist/` on every change (watch mode). After a rebuild, click ↻ on the extension card in `chrome://extensions`, then reload the ChatGPT tab or reopen the panel. |
| `pnpm build` | Strict TypeScript check (`tsc --noEmit`) and production build. |
| `pnpm test` | Unit and integration tests (Vitest + jsdom). |
| `pnpm test:e2e` | Optional end-to-end run of the built extension in real Chromium (see [Testing](#testing)). |
| `pnpm typecheck` | TypeScript only. |
| `pnpm package` | Build and pack `dist/` into `release/chat-navigator-<version>.zip` for the Chrome Web Store. |
| `pnpm icons` | Regenerate the PNG icons in `public/icons/` from `assets/brand/logo-source.png` (uses `sharp`). |

---

## Using the navigator

The panel UI is in **Vietnamese**. This README uses the English names below:

| In this README | In the panel | What it does |
| --- | --- | --- |
| Index more | **Quét toàn bộ** (layers icon, header) | Scroll through the whole thread once, then return. Shows a spinner while running; click it (or Esc) to stop (*Dừng quét*). |
| Rescan | **Quét lại** (refresh icon, header) | Re-read the page. The icon spins until the fresh index arrives. |
| Filters All / Mine / ChatGPT / Saved | **Tất cả / Của tôi / ChatGPT / ☆ Yêu thích** | Saved = bookmarks (*yêu thích*, star icon). |
| Sort | **Cũ nhất / Mới nhất** (list header) | Oldest-first (default) or newest-first. |
| Card menu | **⋯** on a card | *Đi tới tin nhắn* (jump), *Sao chép nội dung* (copy the message text), add/remove favourite. |
| Prev / Next / Bottom / Details | **Trước / Sau / Cuối trang / Chi tiết** (bottom bar) | Step through the list, scroll ChatGPT to the latest message, show indexing diagnostics. |

Each message is a card: a coloured tile (speech bubble for you, sparkles for ChatGPT), the first sentence in bold, one line of preview (or the text around the search match), the message number `#N`, small state indicators (*writing…* dot, eye-off for *not rendered*, a spinner while a jump to it is in progress), a star and the ⋯ menu.

**Loading states.** Actions that wait for the ChatGPT tab show progress until they finish: a jump shows a spinner on the card (bringing back a virtualised message can take up to ~1.7 s), *Quét lại* spins until the new index arrives, and *Quét toàn bộ* shows a spinner plus a progress notice. Each has a fallback timeout, so nothing spins forever if the tab navigates away.

| Where | Key | Action |
| --- | --- | --- |
| Anywhere in Chrome | **Alt+Shift+J** | Open the navigator and focus search. You can change this at `chrome://extensions/shortcuts`. |
| Panel | `/` | Focus the search field. |
| Search field | ↓ | Move into the list. |
| Search field | Enter | Jump to the selected (or first) result. |
| List | ↑ / ↓, PgUp / PgDn, Home / End | Move the selection. |
| List | Enter / Space | Jump to the selected message in ChatGPT. |
| List | B | Bookmark or un-bookmark the selected message. |
| Panel | Alt+↑ / Alt+↓ | Previous / next message (same as the footer buttons). |
| Panel | Esc | Stop *Index more*, then dismiss a notice, clear the search, reset the filters, or close details (one per press, in that order). |

Shortcuts are handled only inside the side panel. Nothing is added to the ChatGPT page, so the composer and ChatGPT's own shortcuts keep working as before.

**Prev / Next** (*Trước / Sau*) step through the currently filtered list, in the chosen order. For example, with *Của tôi* selected they jump between your own prompts. If nothing is selected, they step relative to the message you are reading in ChatGPT.

**The list header** shows the list name and how many cards it has, how many messages are *not rendered* (eye-off count: seen earlier, but ChatGPT no longer shows them on the page), which message you are reading (*Đang xem #N*) and the sort order. **Chi tiết** in the bottom bar shows indexing details and diagnostics (a dot marks warnings).

---

## Architecture

```
┌──────────────────────────── chatgpt.com tab ───────────────────────────┐
│ content.js (isolated world, IIFE)                                       │
│                                                                         │
│  NavigatorController ── starts only while a side panel is connected     │
│   ├─ ChatGPTDomAdapter   all selectors & DOM assumptions (one file)     │
│   ├─ MutationObserver    classified: structural vs. dirty message       │
│   ├─ MessageIndexer      dedupe, order merge, mounted/unmounted, patches│
│   ├─ ActiveTracker       IntersectionObserver "reading band"            │
│   ├─ ScrollManager       scroll + Web Animations highlight              │
│   ├─ ProgressiveIndexer  whole-thread pass ("Index more", on demand)    │
│   └─ route watcher       Navigation API + popstate + 700 ms URL poll    │
└──────────────▲──────────────────────────────────────────────────────────┘
               │ chrome.runtime Port "cmn-navigator"
               │  panel → content: SCROLL_TO, RESCAN, INDEX_MORE, …
               │  content → panel: SNAPSHOT, PATCH (changed msgs only),
               │                   ACTIVE_MESSAGE, SCROLL_RESULT, INDEX_MORE_STATE
┌──────────────┴───────────── Side panel (React) ─────────────────────────┐
│ PanelConnection  follows the active tab, (re)connects, injects if needed│
│ SearchIndexCache precomputed lower-case / accent-folded text per revision│
│ App + components: SearchBar, FilterBar, MessageList (virtualized),      │
│                   MessageItem, NavigatorToolbar, StatusViews            │
│ BookmarkStore    chrome.storage.local (metadata only)                   │
└─────────────────────────────────────────────────────────────────────────┘
service-worker.js: opens the panel from the toolbar button and handles Alt+Shift+J.
```

### Data flow

1. When the side panel opens, it connects a Port to the active ChatGPT tab. If the tab was open before the extension was installed or reloaded, the panel injects `content.js` once with `chrome.scripting` and retries.
2. The controller starts observing, scans, and sends a full `SNAPSHOT`.
3. DOM mutations are classified cheaply:
   - typing in the composer is ignored;
   - text changes inside a message mark only that message *dirty*;
   - added or removed message containers trigger a re-collection.
   Scans are debounced (200 ms, with an 800 ms max wait so streaming text keeps updating).
4. Each scan reuses cached extraction for clean messages (per element, in a `WeakMap`), merges the result into the index, and sends a `PATCH` containing only the changed messages plus the ID order.
5. When the last panel disconnects, the controller disconnects its observers, clears all timers, and drops its DOM references.

### Message model

```ts
interface ChatMessage {
  id: string;                 // data-message-id, or turn:<testid>, or a derived per-element ID
  idSource: 'message-id' | 'turn' | 'derived';
  conversationId: string;
  role: 'user' | 'assistant';
  index: number;              // chronological position in the index
  turnNumber: number | null;  // from data-testid="conversation-turn-N"
  preview: string;            // ≤ 280 chars
  text: string;               // normalized plain text, capped at 50,000 chars
  truncated: boolean;
  hasCode: boolean;
  hasTable: boolean;
  headings: string[];
  mounted: boolean;           // currently attached to ChatGPT's DOM?
  streaming: boolean;
  revision: number;           // bumps on change; used for memoization
}
```

The side panel adds `searchText` (lower-cased NFC) and `foldedText` (lower-cased, without diacritics, đ→d). They are computed once per message revision rather than sent over the port, which halves the payload during streaming.

### Ordering, deduplication and removal rules (`MessageIndexer`)

- **One entry per stable ID.** Re-rendered elements never create new entries, and duplicate IDs within a single scan are collapsed.
- **Order:** each scan is authoritative for the relative order of the messages it contains. Messages that were seen before but are not in the current scan are kept before or after it.
  - If a scan doesn't overlap the known list at all, turn numbers decide where it goes.
- **Retained messages are dropped (treated as deleted) when** they:
  - sit *between* scanned messages, since virtualization only unmounts from the ends;
  - lie past a scroll edge, e.g. the user is at the bottom, so nothing can be hidden below;
  - conflict with a branch switch, i.e. a scanned message now occupies their turn number.
- **Editing a prompt** puts its text in a `<textarea>`, which is never indexed. The previous text is kept until the edit finishes.

---

## ChatGPT DOM assumptions

ChatGPT's markup is **not a public API**. Every selector lives in [`src/content/chatgpt-dom-adapter.ts`](src/content/chatgpt-dom-adapter.ts) (`SELECTORS`), and extraction falls back through several strategies:

Three message strategies are tried in order; the ⓘ panel shows which one matched (*Extraction*).

| Strategy | Markup | Notes |
| --- | --- | --- |
| `author-role` | `[data-message-author-role="user\|assistant"]` with `data-message-id` | Classic markup (2023–2025). |
| `conversation-turn` | `[data-testid^="conversation-turn-"]`; role from `data-turn`, then `.markdown` / `.whitespace-pre-wrap` | Fallback for the classic markup. |
| `turn-key` | One `[data-turn-key]` per prompt/response pair: prompt = `[data-user-message-bubble]`, response = `[data-talvt-turn-state]` (fallback: `[data-content-search-unit-key$=":assistant"]`, `[data-chatgpt-selection-message-id]`, …) | Markup seen on chatgpt.com in **November 2026** (structure-only probe, confirmed in a project chat `/g/…/c/…`). IDs are `tk:<turn-key>:user` / `tk:<turn-key>:assistant`. Turns outside the viewport are virtualised (removed from the DOM). |

| Purpose | Primary | Fallback |
| --- | --- | --- |
| Message ID | `data-message-id`; `tk:<data-turn-key>:<role>` | `turn:<data-testid>`, then a derived ID tied to the element (stable for the page session). |
| Order / position | DOM order | `conversation-turn-N` numbers. |
| Message body | `.markdown` / `.prose` (assistant), `.whitespace-pre-wrap` (user) | The whole message element (turn-key responses are always read whole). |
| Skipped text | `button, svg, textarea, input, .sr-only, [aria-hidden="true"]`, `[data-code-block-controls]`, `[data-loading-indicator]`, … | — |
| Code / tables / headings | `pre`, `code[class*="language-"]`, `.cm-editor`, `[data-code-block]` / `table`, `[data-d-table-viewport]` / `h1`–`h6`, `[role="heading"]` | — |
| Generating | `[data-testid="stop-button"]`, `button[aria-label="Stop streaming"]`, a *Stop…* button in `[data-chatgpt-composer]` | `.result-streaming`, `[data-is-streaming="true"]`, `[data-talvt-turn-state]` other than complete/error/stopped |
| Composer (mutations ignored) | `form`, `#prompt-textarea`, `[data-chatgpt-composer]`, `[data-composer-input]` | — |
| Scroll container | `.thread-scroll-container` | Nearest scrollable ancestor of the first message. |
| Conversation ID | URL `/c/<id>` (also `/g/<gpt>/c/<id>` and project chats) | `/share/<id>` → `share:<id>`; anything else is an *unsaved chat*. |

The classic selectors match ChatGPT's markup as of 2025. The `turn-key` selectors were derived from a structure-only DOM probe of the live chatgpt.com (November 2026); the fixture `src/tests/fixtures/chatgpt-turn-key-dom.ts` reproduces that structure.

If ChatGPT changes its markup:

- The navigator shows **"No messages found"** with a **Rescan** button. The ⓘ panel shows which strategy is in use and any warnings, such as fallback selectors, missing scroll container, or messages without stable IDs.
- Fix it by editing `SELECTORS` and the `collectBy…` methods, and update the fixtures in `src/tests/fixtures/` to match.

---

## Long conversations and the limits of indexing

The navigator can only index what ChatGPT has **rendered in the tab**. It tracks three states:

| State | Shown as | Meaning |
| --- | --- | --- |
| Indexed and mounted | normal row | In the DOM right now. Clicking jumps to it. |
| Observed, not mounted | dimmed row with an eye-off badge, counted as "not rendered" | Seen earlier in this session and kept in memory, with its last scroll offset. Clicking scrolls there, waits for ChatGPT to render it (up to ~1.7 s, stepping toward it if needed), then jumps. If it never comes back (edited, deleted, other branch) a notice says so. |
| Never loaded | not listed | The navigator doesn't claim these exist. |

- **Whole-thread pass.** ChatGPT (November 2026) virtualises long conversations: only the turns near the viewport exist in the DOM. The pass scrolls ChatGPT's own scroll area up one screen at a time to the top, rescanning after each step (it waits until the DOM is quiet, 80–700 ms per step), then from the starting point down to the bottom, and finally restores your position (anchored to the bottom, so content loaded above doesn't shift your view).
  - It runs only when you click **Index more**. Otherwise the navigator never scrolls the page: it indexes the turns ChatGPT renders as you scroll.
  - It only scrolls: no clicks, no network calls, no private APIs.
  - Any real wheel, key, pointer or touch input on the page, the **Stop** button, or Esc cancels it. Jumping to a message or pressing **Bottom** in the panel also stops it, without jumping back.
- The index lives in memory (never in storage). The last 10 threads visited in the tab keep their index and message offsets, so switching back restores them. Reloading the page starts fresh.
- ChatGPT keeps threads opened earlier mounted but hidden (`[data-app-shell-active-page="false"]`). All reading, scrolling and observing is scoped to the active page, so a hidden thread never gets indexed or scrolled by mistake.
- Message numbers (`#N`) are positions **within the index**. If older messages were never loaded, the numbering starts from the earliest one seen.
- Full text per message is capped at 50,000 characters for search. The preview is 280 characters.

---

## Performance

- The content script does nothing until a panel connects.
- Mutation classification is O(changes). Re-extraction happens only for dirty messages, and a scan with nothing dirty is mostly one `querySelectorAll`.
- Only the newest message is checked for streaming.
- Patches carry only changed messages. The panel keeps object identity for unchanged ones, so memoized rows and search strings are reused.
- Search uses precomputed strings and plain `includes`. Highlight ranges are computed only for the ~20 rows on screen.
- The list is virtualized with fixed 68 px rows, so only visible rows are rendered.
- Measured in jsdom (much slower than Chrome) by `src/tests/performance.test.ts`:
  - 1,000 messages indexed in ~0.3 s;
  - a streaming update re-extracts exactly 1 message;
  - search over 1,000 messages takes ~0.5 ms per query.

---

## Privacy and security

This extension can read private conversations, so it is deliberately minimal:

- **No network access.** No `fetch` or XHR, no analytics, no remote code. The build contains no `eval` / `new Function`, and the extension-page CSP is `script-src 'self'`. Tailwind CSS is compiled at build time into a static stylesheet, and lucide-react icons are bundled as inline SVG components, so the panel loads no fonts, styles or icons from the network.
- **Nothing leaves your browser.**
  - Conversation text goes only from the ChatGPT tab to this extension's side panel, over a `chrome.runtime` Port.
  - The content script accepts Port connections only from this extension.
- **No cookies, tokens, credentials or ChatGPT APIs.** The extension reads only the rendered DOM of the open conversation. It does not call ChatGPT's internal APIs or intercept requests.
- **Not stored by default.** The message index is kept in memory only, and is discarded when the panel closes or the page reloads.
- **Bookmarks store only metadata:** conversation ID, message ID, role, a ≤160-character preview, and a timestamp. They are kept in `chrome.storage.local`, which is local and not synced.
- **Safe rendering.** Message text is rendered as React text nodes. Matches are wrapped in `<mark>` elements built by React, never with `innerHTML` (there is a test for this).
- **The ChatGPT page is never modified.**
  - The highlight is a Web Animations API animation (`element.animate`), so no attributes, classes or content change.
  - The extension never focuses, clicks, or types into the page.

### Permissions

| Permission | Why |
| --- | --- |
| `sidePanel` | Show the navigator in Chrome's side panel. |
| `storage` | Save bookmarks locally. |
| `scripting` | Inject the content script into ChatGPT tabs that were already open when the extension was installed or reloaded. Without it, those tabs need a manual reload. |
| Host `https://chatgpt.com/*` | Run the content script there, and read the active tab's URL to know whether it is a ChatGPT tab. No other sites. |

---

## Testing

### Unit and integration tests

Run with `pnpm test`: 103 tests in jsdom, using mocked ChatGPT-shaped DOM fixtures.

| Requirement | Tests |
| --- | --- |
| Extract user and assistant messages; skip buttons, labels and composer; detect code, tables and headings; fallbacks | `dom-adapter.test.ts` |
| Deduplication | `message-indexer.test.ts` (dedup) |
| Conversation and navigation detection | `dom-adapter.test.ts` (URLs), `navigator-controller.test.ts` (SPA switch, new chat → permanent URL) |
| Search and filtering (Vietnamese, NFD, AND terms, highlighting, snippets) | `search.test.ts` |
| Bookmark persistence (restart simulation, concurrent toggles, malformed data) | `storage.test.ts` |
| Message ordering (virtualized prepend, mid-insert, turn numbers) | `message-indexer.test.ts` (ordering) |
| Removed DOM elements (unmounted vs. deleted, branch switch) | `message-indexer.test.ts`, `navigator-controller.test.ts` |
| Streaming responses (single entry, patches carry one message, streaming flag clears) | `message-indexer.test.ts`, `navigator-controller.test.ts` |
| Scroll-to-message (center vs. top, reduced motion, no DOM mutation, not-mounted result) | `scroll-manager.test.ts`, `navigator-controller.test.ts` |
| 1,000 synthetic messages (index, incremental rescan, search) | `performance.test.ts` |
| UI: keyboard navigation, virtualization, safe rendering | `sidepanel-ui.test.tsx` |
| Index more (walk up, restore position, cancel) | `progressive-indexer.test.ts` |
| Virtualised thread: no scrolling on open, indexing as the user scrolls, Index more, jump to an unmounted message; switching threads (hidden pages, per-thread memory for ≥ 8 threads) | `turn-key-dom.test.ts` |

### End-to-end in real Chromium (optional)

```bash
pnpm build
pnpm exec playwright-core install chromium   # once, if you don't already have a Chromium build
pnpm test:e2e                     # or: CHROME_BIN=/path/to/chromium pnpm test:e2e
```

[`e2e/extension.e2e.mjs`](e2e/extension.e2e.mjs) loads `dist/` as an unpacked extension in headless Chromium and serves a **ChatGPT-like fixture page** at `https://chatgpt.com/c/…` using request interception. No real ChatGPT traffic or login is involved. It opens the panel page bound to that tab (`index.html?tabId=N`) and checks 31 things:

- the manifest, permissions and command;
- indexing;
- search, including accent-insensitive Vietnamese;
- filters;
- click-to-jump and keyboard jump, with the composer left untouched;
- active-message tracking;
- new and streaming messages;
- bookmark persistence;
- Index more;
- SPA conversation switches;
- the unavailable-bookmark state;
- reconnecting after a page reload;
- **no JS errors** and **no third-party requests**.

Screenshots are saved to `e2e/output/`.

> Branded Google Chrome stable no longer supports `--load-extension`. Use Chromium or Chrome for Testing for this script.

### Manual browser test checklist (real chatgpt.com)

1. Load `dist/` unpacked. Check that `chrome://extensions` shows no errors.
2. Open an existing long conversation. Click the toolbar icon: the panel opens and lists the messages in order, and the counts match.
3. Press **Alt+Shift+J** from the ChatGPT page: the panel opens or focuses, with the cursor in search.
4. Click messages near the top, middle and bottom. ChatGPT scrolls there, highlights the message briefly, and leaves the composer draft untouched.
5. Search for a word, then the same word without accents (if it's Vietnamese). Matches are highlighted and the count updates. Esc clears the search.
6. Try *Mine*, *ChatGPT* and *Saved*, alone and together with a search.
7. Send a prompt. Your message appears, then the response appears with a "writing…" badge and grows. The badge disappears when it is done, and there are no duplicate rows.
8. Edit an earlier prompt, or switch branches with `< 2/2 >`. The list matches what's on screen.
9. Switch to another conversation in the sidebar. The list is replaced, with nothing mixed from the previous conversation. Start a **New chat** and send a prompt: the messages stay when the URL changes to `/c/…`.
10. Bookmark two messages. Reload the tab and restart Chrome: they are still under *Saved*. Delete one of the messages in ChatGPT (or open the conversation on another branch): it shows as *unavailable*.
11. Scroll ChatGPT manually. The active marker (yellow bar) follows, and the list scrolls to it only while your pointer is outside the list.
12. Open the panel on a long conversation: the page does not move. Scroll up: the count grows. Click a message far away (dimmed, *not rendered*): ChatGPT scrolls there and it is highlighted. Switch to another thread and back: the earlier messages are still listed, and clicking them still scrolls. Click **Index more** and scroll the wheel during the run: it stops immediately.
13. Switch to a non-ChatGPT tab: the panel shows "Open a ChatGPT conversation". Switch back: it reconnects.
14. In DevTools, open the Network tab on the ChatGPT page, and the panel's own DevTools (right-click the panel → Inspect). The extension makes no requests.
15. Toggle the OS or Chrome dark mode: the panel follows it.

### Verification status

What was actually run while building this project:

- `pnpm build` (strict type-check plus production build) succeeds. `dist/` contains a valid MV3 extension that Chromium loads without errors.
- All 103 unit and integration tests pass.
- The end-to-end script passes 38/38 in **headless Chromium 1248 (Playwright)** against the **mocked** ChatGPT fixture described above.

What was **not** done:

- Testing against the live chatgpt.com: no ChatGPT account or browser session was available. The selectors in the DOM adapter therefore haven't been confirmed against today's markup.
- Opening the panel through the real Side Panel UI (toolbar click or Alt+Shift+J) under automation. That setup was checked only through `chrome.sidePanel.getPanelBehavior()` and `chrome.commands.getAll()`.

Run the manual checklist above before relying on it.

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| "Can't reach this ChatGPT tab" | Reload the ChatGPT tab, then click **Retry**. This happens if Chrome blocks injection, e.g. while the page is still loading. |
| "No messages found" | Click **Rescan**. If it persists on a conversation that has messages, ChatGPT's markup has likely changed: see [ChatGPT DOM assumptions](#chatgpt-dom-assumptions). |
| Shortcut doesn't work | Another extension may be using it. Change it at `chrome://extensions/shortcuts`. |
| After `pnpm dev` rebuilds, nothing changes | Reload the extension in `chrome://extensions`, then reopen the panel. |

---

## Project structure

```
├── manifest.json                 MV3 manifest (copied into dist/)
├── assets/brand/logo-source.png  master logo (1024×1024); icons are generated from it
├── public/icons/                 generated PNG icons (16/32/48/128)
├── scripts/
│   ├── build.mjs                 builds pages + worker (ESM) and content script (IIFE); --watch for dev
│   └── generate-icons.mjs        cuts the logo out of its white background and resizes it
├── src/
│   ├── background/service-worker.ts
│   ├── content/
│   │   ├── content-script.ts     entry: Port handling, takeover of stale instances
│   │   ├── navigator-controller.ts
│   │   ├── chatgpt-dom-adapter.ts   ← all ChatGPT DOM assumptions
│   │   ├── message-indexer.ts
│   │   ├── active-tracker.ts
│   │   ├── scroll-manager.ts
│   │   └── progressive-indexer.ts
│   ├── sidepanel/
│   │   ├── index.html, main.tsx, App.tsx
│   │   ├── connection.ts         tab tracking + Port client (store for useSyncExternalStore)
│   │   ├── index-state.ts        snapshot/patch application
│   │   ├── hooks/                usePanelConnection, useBookmarks, useDebouncedValue
│   │   ├── components/           SearchBar, FilterBar, MessageList, MessageItem, NavigatorToolbar, …
│   │   ├── lib/cn.ts             class-name helper
│   │   └── styles/sidepanel.css  Tailwind v4 entry + brand tokens (light/dark via prefers-color-scheme)
│   ├── shared/                   types, messages (protocol), search, storage, timing
│   └── tests/                    Vitest suites + DOM fixtures
├── e2e/extension.e2e.mjs         optional real-browser test
├── vite.config.ts                side panel + service worker build
├── vite.content.config.ts        content script build (single IIFE file)
└── vitest.config.ts
```
