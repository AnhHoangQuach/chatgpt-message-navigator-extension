import { Check, ExternalLink } from 'lucide-preact';
import { useState } from 'preact/hooks';
import { SITES, type SiteId, type SiteInfo } from '../../shared/sites';

interface Props {
  /** Sites the extension currently has access to (all, unless the user restricted it). */
  enabledSites: readonly SiteId[];
  currentSite?: SiteId | null;
  /** Re-request access to a site the user restricted in Chrome's site-access settings. */
  onAllow(site: SiteInfo): Promise<boolean>;
  onOpen(site: SiteInfo): void;
}

/** The supported chat sites; each works automatically once its tab is open. */
export function SitesList({ enabledSites, currentSite = null, onAllow, onOpen }: Props) {
  const [busy, setBusy] = useState<SiteId | null>(null);

  const allow = (site: SiteInfo) => {
    setBusy(site.id);
    // Called synchronously from the click so Chrome sees the user gesture.
    void onAllow(site).finally(() => setBusy((b) => (b === site.id ? null : b)));
  };

  return (
    <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-bg" aria-label="Supported sites">
      {SITES.map((site) => {
        const enabled = enabledSites.includes(site.id);
        return (
          <li key={site.id} data-site={site.id} className="flex items-center gap-2 px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold">
                {site.name}
                {site.id === currentSite && <span className="ml-1.5 text-[11px] font-normal text-muted">(this tab)</span>}
              </p>
              <p className="truncate text-[11.5px] text-muted">{site.hosts[0]}</p>
            </div>
            {enabled ? (
              <span className="inline-flex items-center gap-1 text-[12px] text-muted" title="Works automatically on this site">
                <Check size={13} className="text-ok" /> Active
              </span>
            ) : (
              <button
                type="button"
                className="btn btn-sm border-accent"
                disabled={busy === site.id}
                aria-busy={busy === site.id || undefined}
                onClick={() => allow(site)}
                title={`Site access to ${site.hosts[0]} is restricted in Chrome. Allow it again.`}
              >
                Allow
              </button>
            )}
            <button
              type="button"
              className="icon-btn size-7"
              aria-label={`Open ${site.name}`}
              title={`Open ${site.name} in a new tab`}
              onClick={() => onOpen(site)}
            >
              <ExternalLink size={14} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
