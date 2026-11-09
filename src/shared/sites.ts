/**
 * The AI chat sites the navigator supports. Single source of truth for hosts,
 * permissions and display names (shared by the side panel and content script).
 *
 * Every site is a host permission granted at install, with the manifest content
 * script, so the panel recognises the site as soon as you switch to it. (Users
 * can still restrict an extension's site access in Chrome; the panel then
 * offers to allow it again.) A test keeps manifest.json in sync with this list.
 */

export type SiteId = 'chatgpt' | 'gemini' | 'claude' | 'grok' | 'deepseek';

export interface SiteInfo {
  id: SiteId;
  /** Display name, also used as the assistant's name in the list. */
  name: string;
  /** Exact hostnames (https only). */
  hosts: readonly string[];
  /** Match patterns for chrome.permissions / manifest. */
  origins: readonly string[];
  /** Where "Open" takes the user. */
  home: string;
}

export const SITES: readonly SiteInfo[] = [
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    hosts: ['chatgpt.com'],
    origins: ['https://chatgpt.com/*'],
    home: 'https://chatgpt.com/',
  },
  {
    id: 'gemini',
    name: 'Gemini',
    hosts: ['gemini.google.com'],
    origins: ['https://gemini.google.com/*'],
    home: 'https://gemini.google.com/app',
  },
  {
    id: 'claude',
    name: 'Claude',
    hosts: ['claude.ai'],
    origins: ['https://claude.ai/*'],
    home: 'https://claude.ai/new',
  },
  {
    id: 'grok',
    name: 'Grok',
    hosts: ['grok.com'],
    origins: ['https://grok.com/*'],
    home: 'https://grok.com/',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    hosts: ['chat.deepseek.com'],
    origins: ['https://chat.deepseek.com/*'],
    home: 'https://chat.deepseek.com/',
  },
];

/** Match patterns of every supported site (manifest host_permissions and content script matches). */
export const ALL_ORIGINS: readonly string[] = SITES.flatMap((s) => s.origins);

export function siteById(id: SiteId): SiteInfo {
  return SITES.find((s) => s.id === id)!;
}

/** The supported site a URL belongs to (https and exact host only), or null. */
export function siteForUrl(url: string | undefined): SiteInfo | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return null;
    return SITES.find((s) => s.hosts.includes(u.hostname)) ?? null;
  } catch {
    return null;
  }
}

export function siteForHost(hostname: string): SiteInfo | null {
  return SITES.find((s) => s.hosts.includes(hostname)) ?? null;
}
