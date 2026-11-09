# AI Chat Navigator: Privacy Policy

_Effective date: November 9, 2026_

AI Chat Navigator is a Chrome extension that adds a side panel listing the messages of the AI chat conversation open in your tab, so you can search, filter, bookmark and jump to them. It works on chatgpt.com, gemini.google.com, claude.ai, grok.com and chat.deepseek.com (the "supported sites"). This policy explains what data the extension handles and what it does with it.

**In short: everything stays on your device. The extension makes no network requests, has no servers, and never sends, sells or shares your data.**

## What the extension handles

| Data | Why | Where it is kept |
| --- | --- | --- |
| Text and author role (you or the AI) of the messages in the conversation open on a supported site | To show them in the side panel, search them and jump to them | In memory in that browser tab only. It is discarded when you reload or close the tab. |
| The conversation's address (URL) and title on that site | To tell conversations apart and show the title in the panel | In memory, as above |
| Favorites you choose to save: conversation ID, message ID, role, a preview of up to 160 characters, and the time you saved it | So your favorites are still there after a reload or browser restart | `chrome.storage.local` on your device. Never synced or uploaded. |

The extension never stores the full text of your conversations. It does not read cookies, passwords or account details, does not access any website other than the supported sites you use it on, and does not track your browsing.

If you choose **Copy page structure** (under Details), the extension copies a description of the page's layout (tag, class and attribute names) to your clipboard. It contains no message text and is only shared if you paste it somewhere yourself.

## What the extension does not do

- It does not send any data off your device. There are no network requests, analytics, telemetry or advertising.
- It does not sell, transfer or share data with third parties.
- It does not use data for any purpose other than navigating the open conversation, and never for credit, lending or profiling.
- It does not load or run remote code.

## Permissions

- **Side panel** (`sidePanel`): shows the extension's interface next to the page.
- **Storage** (`storage`): saves your favorites locally, as described above.
- **Scripting** (`scripting`): injects the extension's own bundled script into a tab of a supported site that was open before the extension was installed or updated.
- **Access to the supported sites** (`https://chatgpt.com/*`, `https://gemini.google.com/*`, `https://claude.ai/*`, `https://grok.com/*`, `https://chat.deepseek.com/*`): reads the messages of the conversation open on that site and scrolls to the one you choose. No other site is accessed. You can restrict this access per site in Chrome's extension settings at any time.

## Your control

You can remove any favorite from the side panel at any time. Uninstalling the extension deletes all of its locally stored data.

## Children

The extension is not directed at children and does not knowingly handle data about children beyond what is described above.

## Changes

If this policy changes, the new version will be published at this address with a new effective date.

## Contact

Questions or concerns about this policy: open an issue at https://github.com/AnhHoangQuach/chatgpt-message-navigator-extension/issues

AI Chat Navigator is not affiliated with OpenAI, Google, Anthropic, xAI or DeepSeek. ChatGPT, Gemini, Claude, Grok and DeepSeek are trademarks of their respective owners.
