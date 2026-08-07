import type { AssetStatus } from "@prisma/client";

import { assetDisplayName } from "@/lib/asset-display";
import { StatusChip } from "@/components/ui/status-chip";
import {
  DataCard,
  DataCardHeadline,
  DataCardList,
  DataCardMeta,
} from "@/components/ui/data-card";

/**
 * The phone shape of the register (docs/DESIGN-SYSTEM.md §5, AM-06).
 *
 * The table sets whitespace-nowrap and lets its wrapper scroll sideways, which
 * is right for a desktop and wrong for a thumb — answering "who has AST-0412?"
 * should not require side-scrolling seven columns. Same rows, chosen by
 * breakpoint, never by a media-query hook: a hook would make this a client
 * component and re-fetch nothing useful.
 *
 * The `md:hidden` that used to live on this `<ul>` now lives on
 * ResponsiveTable's card wrapper, which also carries the `asset-card-list`
 * testid. One owner for one breakpoint.
 *
 * `holder` is null for STAFF_RO because the page never fetched it. This
 * component renders what it is handed; it is NOT where the privacy rule lives.
 */
export type AssetCardRow = {
  id: string;
  tag: string | null;
  make: string | null;
  model: string | null;
  description: string | null;
  status: AssetStatus;
  categoryName: string;
  siteName: string | null;
  holder: { id: string; name: string } | null;
};

export function AssetCardList({ assets }: { assets: AssetCardRow[] }) {
  return (
    <DataCardList label="Asset register">
      {assets.map((asset) => (
        <DataCard key={asset.id} href={`/assets/${asset.id}`}>
          <DataCardHeadline>
            {/* The tag is the headline: looking one up is the entire reason
                someone opens this away from a desk.

                Deliberately NOT an AssetTagLink — the whole card is already the
                link, and nesting an anchor inside an anchor is invalid HTML. */}
            {asset.tag ? (
              <span className="font-mono text-sm font-medium tabular-nums">
                {asset.tag}
              </span>
            ) : (
              // "Untagged", matching the table and the detail page's "Untagged
              // asset". One vocabulary for one state: the card and the row are
              // the same register at two widths, and a reader who learns a word
              // in one must not meet a new one in the other.
              <span className="text-muted-foreground rounded border border-dashed px-1.5 font-mono text-xs">
                Untagged
              </span>
            )}
            <StatusChip status={asset.status} />
          </DataCardHeadline>
          <span className="text-sm">{assetDisplayName(asset)}</span>
          <DataCardMeta
            parts={[asset.holder?.name, asset.siteName, asset.categoryName]}
          />
        </DataCard>
      ))}
    </DataCardList>
  );
}
