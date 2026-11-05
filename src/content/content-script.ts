import { isPanelToContent, PORT_NAME, type ContentToPanel } from '../shared/messages';
import { NavigatorController, type PanelChannel } from './navigator-controller';

/**
 * Content script entry (runs on https://chatgpt.com/* only).
 *
 * Talks exclusively to this extension's side panel over a chrome.runtime Port.
 * It makes no network requests and never reads cookies, storage or
 * credentials of the page.
 */

const TAKEOVER_EVENT = 'cmn:content-script-takeover';

function main(): void {
  // If an older copy of this script is still alive (extension reloaded or the
  // panel re-injected us), tell it to shut down before we start.
  document.dispatchEvent(new CustomEvent(TAKEOVER_EVENT));

  const controller = new NavigatorController();
  const ports = new Map<chrome.runtime.Port, PanelChannel>();

  const onConnect = (port: chrome.runtime.Port) => {
    if (port.name !== PORT_NAME) return;
    // Only accept connections from our own extension pages.
    if (port.sender?.id !== undefined && port.sender.id !== chrome.runtime.id) {
      port.disconnect();
      return;
    }
    const channel: PanelChannel = {
      post: (message: ContentToPanel) => port.postMessage(message),
    };
    ports.set(port, channel);
    port.onMessage.addListener((message: unknown) => {
      if (isPanelToContent(message)) controller.handleMessage(channel, message);
    });
    port.onDisconnect.addListener(() => {
      ports.delete(port);
      controller.disconnect(channel);
    });
    controller.connect(channel);
  };

  let torn = false;
  const teardown = () => {
    if (torn) return;
    torn = true;
    controller.dispose();
    for (const port of ports.keys()) {
      try {
        port.disconnect();
      } catch {
        /* already gone */
      }
    }
    ports.clear();
    try {
      chrome.runtime.onConnect.removeListener(onConnect);
    } catch {
      /* extension context invalidated */
    }
    document.removeEventListener(TAKEOVER_EVENT, teardown);
    clearInterval(contextCheck);
  };

  // Registered after dispatching, so we never receive our own takeover event.
  document.addEventListener(TAKEOVER_EVENT, teardown);
  chrome.runtime.onConnect.addListener(onConnect);

  // When the extension is reloaded/removed this copy becomes orphaned.
  const contextCheck = setInterval(() => {
    if (!chrome.runtime?.id) teardown();
  }, 5000);
}

main();
