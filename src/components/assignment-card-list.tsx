import Link from "next/link";
import type { AssetStatus } from "@prisma/client";

import { AssetTagLink } from "@/components/asset-tag-link";
import { Timestamp } from "@/components/timestamp";
import { StatusChip } from "@/components/ui/status-chip";
import {
  DataCard,
  DataCardHeadline,
  DataCardList,
  DataCardMeta,
} from "@/components/ui/data-card";

/**
 * The phone shape of an assignment, wherever one is listed.
 *
 * Three tables render the same row — an asset, a person, and a
 * checked-out/returned pair — from two different angles:
 *
 * - /me/assignments and /people/[id] list ASSETS held by one person, so the
 *   asset is the headline and no person is fetched at all.
 * - /assets/[id] lists PEOPLE who have held one asset, so the person leads and
 *   there is no asset in the row.
 *
 * Hence the discriminated union rather than one loose type with everything
 * optional: `subject: "asset"` genuinely has no `person` key, and making both
 * optional would let a caller pass neither and render an empty card.
 *
 * This component renders what it is handed. It is NOT where the privacy rule
 * lives — `personSelectFor(role)` decides which person fields were ever
 * fetched, and a STAFF_RO viewer reaches none of these three tables carrying a
 * person.
 */
export type AssignmentAssetCard = {
  id: string;
  checkedOutAt: Date;
  returnedAt: Date | null;
  conditionNotes?: string | null;
  asset: {
    id: string;
    tag: string | null;
    make: string;
    model: string;
    status: AssetStatus;
  };
};

export type AssignmentPersonCard = {
  id: string;
  checkedOutAt: Date;
  returnedAt: Date | null;
  conditionNotes?: string | null;
  /** `employeeRef` is optional because personSelectFor may not have selected it. */
  person: { id: string; name: string; employeeRef?: string | null };
};

type Props =
  | { subject: "asset"; rows: AssignmentAssetCard[]; label: string }
  | { subject: "person"; rows: AssignmentPersonCard[]; label: string };

export function AssignmentCardList(props: Props) {
  return (
    <DataCardList label={props.label}>
      {props.subject === "asset"
        ? props.rows.map((row) => <AssetSubjectCard key={row.id} row={row} />)
        : props.rows.map((row) => <PersonSubjectCard key={row.id} row={row} />)}
    </DataCardList>
  );
}

/**
 * "Out" and "Back" rather than "Checked out" and "Returned": the card has a
 * fraction of the table's width, and the table's own column headers are not
 * there to carry the label.
 */
function dateParts(row: {
  checkedOutAt: Date;
  returnedAt: Date | null;
}): React.ReactNode[] {
  return [
    <>
      Out <Timestamp value={row.checkedOutAt} exact />
    </>,
    row.returnedAt ? (
      <>
        Back <Timestamp value={row.returnedAt} exact />
      </>
    ) : null,
  ];
}

/**
 * The condition note, on its own line rather than in the meta run.
 *
 * It is operator-typed free text of unbounded length, so dot-joining it after a
 * timestamp gives it no room to wrap and reads as a continuation of the dates.
 * The table already gives it its own column with `whitespace-normal`; this is
 * the card's version of that.
 */
function ConditionNote({ notes }: { notes?: string | null }) {
  if (!notes) return null;
  return <span className="text-muted-foreground text-xs">{notes}</span>;
}

function AssetSubjectCard({ row }: { row: AssignmentAssetCard }) {
  return (
    // No `href` on the card: the tag inside it is the link, and wrapping a card
    // that contains a link in another link is invalid HTML.
    <DataCard>
      <DataCardHeadline>
        <AssetTagLink id={row.asset.id} tag={row.asset.tag} />
        <StatusChip status={row.asset.status} />
      </DataCardHeadline>
      <span className="text-sm">
        {row.asset.make} {row.asset.model}
      </span>
      <DataCardMeta parts={dateParts(row)} />
      <ConditionNote notes={row.conditionNotes} />
    </DataCard>
  );
}

function PersonSubjectCard({ row }: { row: AssignmentPersonCard }) {
  return (
    <DataCard>
      <DataCardHeadline>
        <Link
          href={`/people/${row.person.id}`}
          className="font-medium underline underline-offset-4"
        >
          {row.person.name}
        </Link>
        {row.returnedAt === null ? (
          // Not a status chip. The five hues are the ASSET vocabulary and mean
          // nothing about an assignment; this is a plain badge, and it states a
          // fact (`returnedAt IS NULL`) rather than marking an empty field.
          <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs whitespace-nowrap">
            Still held
          </span>
        ) : null}
      </DataCardHeadline>
      <DataCardMeta parts={[row.person.employeeRef, ...dateParts(row)]} />
      <ConditionNote notes={row.conditionNotes} />
    </DataCard>
  );
}
