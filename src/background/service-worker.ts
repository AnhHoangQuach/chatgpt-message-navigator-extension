import type { RuntimeMessage } from '../shared/messages';

/**
 * Background service worker. Responsibilities are deliberately minimal:
 *  - make the toolbar button open the side panel;
 *  - handle the "open-navigator" keyboard command (Alt+Shift+J by default).
 * It does no network access and holds no conversation data.
 */

function configurePanel(): void {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((error: unknown) => {
    console.warn('[Chat Navigator] setPanelBehavior failed', error);
  });
}

chrome.runtime.onInstalled.addListener(configurePanel);
chrome.runtime.onStartup.addListener(configurePanel);
configurePanel(); // cheap and idempotent; covers worker restarts

chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== 'open-navigator') return;
  const windowId = tab?.windowId;
  if (windowId === undefined) return;
  // sidePanel.open() must be called synchronously in the user-gesture handler.
  chrome.sidePanel
    .open({ windowId })
    .then(() => {
      const message: RuntimeMessage = { type: 'FOCUS_NAVIGATOR' };
      // The panel may still be loading; it also focuses search on load.
      return chrome.runtime.sendMessage(message).catch(() => undefined);
    })
    .catch((error: unknown) => {
      console.warn('[Chat Navigator] could not open side panel', error);
    });
});
