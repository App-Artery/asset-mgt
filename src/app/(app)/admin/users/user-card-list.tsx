"use client";

import { ROLE_LABELS } from "@/lib/labels";
import {
  DataCard,
  DataCardHeadline,
  DataCardList,
  DataCardMeta,
} from "@/components/ui/data-card";
import {
  ActivationControl,
  RoleForm,
  SignInCell,
  type AdminUserRow,
} from "./user-controls";

/**
 * The phone shape of the roster.
 *
 * Not a link-card: it carries a select, a submit button and a dialog trigger,
 * so `DataCard` is used without an `href` — nesting a control inside an anchor
 * is invalid HTML and swallows the click.
 *
 * The card is not a read-only summary. Provisioning away from a desk is the
 * whole reason it exists, so it keeps the same controls the row has.
 */
export function UserCardList({
  users,
  currentAdminId,
  now,
}: {
  users: AdminUserRow[];
  currentAdminId: string;
  /** Passed in so every card on the page agrees about what "now" is. */
  now: Date;
}) {
  return (
    <DataCardList label="Users">
      {users.map((user) => {
        const isSelf = user.id === currentAdminId;
        return (
          <DataCard
            key={user.id}
            className={user.deactivated ? "text-muted-foreground" : undefined}
          >
            <DataCardHeadline>
              <span className="text-sm font-medium">
                {user.name ?? "—"}
                {isSelf ? (
                  <span className="text-muted-foreground"> (you)</span>
                ) : null}
              </span>
              {user.deactivated ? (
                <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs whitespace-nowrap">
                  Deactivated
                </span>
              ) : (
                <span className="text-muted-foreground text-xs whitespace-nowrap">
                  {ROLE_LABELS[user.role]}
                </span>
              )}
            </DataCardHeadline>
            {/* break-all, not truncate: an address is what an admin matches
                against, so it has to be readable in full even when it is
                long. */}
            <span className="text-sm break-all">{user.email}</span>
            <DataCardMeta parts={[user.employeeRef]} />
            <div className="text-sm">
              <SignInCell
                lastSignInAt={user.lastSignInAt}
                lastLinkSentAt={user.lastLinkSentAt}
                now={now}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <RoleForm user={user} isSelf={isSelf} />
              <ActivationControl user={user} isSelf={isSelf} />
            </div>
          </DataCard>
        );
      })}
    </DataCardList>
  );
}
