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
/**
 * Teardown of the running copy, kept in the content-script isolated world:
 * page scripts can't see or call it.
 */
const INSTANCE_KEY = '__chatNavigatorTeardown';

type IsolatedGlobal = typeof globalThis & { [INSTANCE_KEY]?: () => void };

function extensionContextAlive(): boolean {
  try {
    return Boolean(chrome.runtime?.id);
  } catch {
    return false;
  }
}

function main(): void {
  const isolated = globalThis as IsolatedGlobal;

  // An older copy in this same isolated world (the panel re-injected us):
  // shut it down directly.
  isolated[INSTANCE_KEY]?.();
  // A copy orphaned by an extension reload may live in another world; it
  // reacts to this DOM event only if its own extension context is gone (see
  // onTakeover), so the page dispatching the same event can't stop us.
  document.dispatchEvent(new CustomEvent(TAKEOVER_EVENT));

  const controller = new NavigatorController();
  const ports = new Map<chrome.runtime.Port, PanelChannel>();

  const onConnect = (port: chrome.runtime.Port) => {
    if (port.name !== PORT_NAME) return;
    // Only accept connections from this extension's own pages.
    if (port.sender?.id !== chrome.runtime.id) {
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
    document.removeEventListener(TAKEOVER_EVENT, onTakeover);
    clearInterval(contextCheck);
    if (isolated[INSTANCE_KEY] === teardown) delete isolated[INSTANCE_KEY];
  };

  // Untrusted (any script on the page can dispatch it): only an orphaned copy
  // whose extension context is gone shuts down.
  const onTakeover = () => {
    if (!extensionContextAlive()) teardown();
  };

  // Registered after dispatching, so we never receive our own takeover event.
  document.addEventListener(TAKEOVER_EVENT, onTakeover);
  chrome.runtime.onConnect.addListener(onConnect);
  isolated[INSTANCE_KEY] = teardown;

  // When the extension is reloaded/removed this copy becomes orphaned.
  const contextCheck = setInterval(() => {
    if (!extensionContextAlive()) teardown();
  }, 5000);
}

main();
