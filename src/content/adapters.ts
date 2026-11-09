import { siteForHost } from '../shared/sites';
import { ChatGPTDomAdapter } from './chatgpt-dom-adapter';
import { SelectorAdapter } from './selector-adapter';
import type { SiteAdapter } from './site-adapter';
import { SITE_SELECTORS } from './site-selectors';

/** The adapter for the page's site (ChatGPT's own adapter for chatgpt.com and unknown hosts). */
export function createSiteAdapter(doc: Document = document): SiteAdapter {
  const site = siteForHost(doc.location?.hostname ?? '');
  if (site && site.id !== 'chatgpt') return new SelectorAdapter(SITE_SELECTORS[site.id], doc);
  return new ChatGPTDomAdapter(doc);
}
