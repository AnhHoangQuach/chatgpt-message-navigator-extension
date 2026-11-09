import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { probeDom } from '../content/dom-probe';
import { SITES, type SiteId } from '../shared/sites';
import { SitesList } from '../sidepanel/components/SitesList';
import { mountClaude, mountGemini } from './fixtures/sites';

afterEach(cleanup);

describe('SitesList', () => {
  function setup(enabled: SiteId[]) {
    const onAllow = vi.fn(() => Promise.resolve(true));
    const onOpen = vi.fn();
    render(<SitesList enabledSites={enabled} currentSite="gemini" onAllow={onAllow} onOpen={onOpen} />);
    const row = (id: SiteId) => document.querySelector(`[data-site="${id}"]`)!;
    return { onAllow, onOpen, row };
  }

  it('lists every supported site as active when the extension has access', () => {
    const { row } = setup(SITES.map((s) => s.id));
    expect(screen.getAllByRole('listitem')).toHaveLength(SITES.length);
    for (const site of SITES) expect(row(site.id).textContent).toContain('Active');
    expect(row('gemini').textContent).toContain('(this tab)');
    expect(screen.queryByText('Allow')).toBeNull();
  });

  it('offers to allow a site whose access the user restricted in Chrome', () => {
    const { onAllow, onOpen, row } = setup(['chatgpt', 'gemini', 'grok', 'deepseek']);
    expect(row('claude').textContent).toContain('Allow');
    fireEvent.click(row('claude').querySelector('button')!);
    expect(onAllow).toHaveBeenCalledWith(expect.objectContaining({ id: 'claude', origins: ['https://claude.ai/*'] }));
    fireEvent.click(screen.getByLabelText('Open Grok'));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'grok', home: 'https://grok.com/' }));
  });
});

describe('probeDom (Copy page structure)', () => {
  it('describes the structure without any message text', () => {
    const secret = 'my private prompt about project Zephyr';
    for (const doc of [mountGemini([{ user: secret, assistant: `<p>${secret} — reply</p>` }]), mountClaude([{ user: secret, assistant: `<p>${secret}</p>` }])]) {
      const probe = JSON.stringify(probeDom(doc));
      expect(probe).not.toContain('Zephyr');
      expect(probe).not.toContain('private prompt');
    }
    const gemini = probeDom(mountGemini([{ user: secret, assistant: '<p>x</p>' }]));
    expect(gemini.host).toBe('gemini.google.com');
    expect(gemini.path).toBe('/app/ID');
    expect(gemini.customTags).toMatchObject({ 'user-query': 1, 'model-response': 1 });
    expect((gemini.textBlockChain as string[]).join(' ')).toContain('user-query div#c_0.conversation-container');
  });

  it('keeps attribute values only when they look like identifiers', () => {
    const doc = mountClaude([{ user: 'hi' }]);
    doc.querySelector('[data-testid="user-message"]')!.setAttribute('data-copy-text', 'a sentence with spaces');
    const chain = JSON.stringify(probeDom(doc));
    expect(chain).not.toContain('a sentence with spaces');
  });
});
