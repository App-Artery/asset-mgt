"use client";

import { useActionState, useState } from "react";
import type { Role } from "@prisma/client";
import { ROLE_LABELS, ROLE_ORDER } from "@/lib/labels";
import { exactTimestamp, relativeTime } from "@/lib/relative-time";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { changeRole, deactivateUser, reactivateUser } from "./actions";

export type AdminUserRow = {
  id: string;
  name: string | null;
  email: string;
  employeeRef: string | null;
  role: Role;
  deactivated: boolean;
  /**
   * Last successful magic-link sign-in — `User.emailVerified`, whose semantic
   * and its Resend-is-the-only-provider precondition are spelled out at the
   * read site (page.tsx). Null is "has never signed in".
   */
  lastSignInAt: Date | null;
  /**
   * When a magic link was last ISSUED for this address, from a surviving
   * `VerificationToken` row. Null is "no unredeemed link outstanding".
   */
  lastLinkSentAt: Date | null;
};

export function UsersTable({
  users,
  currentAdminId,
  now,
}: {
  users: AdminUserRow[];
  currentAdminId: string;
  /** Passed in so every row on the page agrees about what "now" is. */
  now: Date;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Email</TableHead>
          <TableHead>Employee ref</TableHead>
          <TableHead>Role</TableHead>
          <TableHead>Last signed in</TableHead>
          {/* A "Status" header used to sit here, and the table has had six
              headers over five cells since AM-01: "Status" was printed above
              the activation buttons, and "Actions" above a column that was
              never rendered at all. Adding a seventh header to a row already
              off by one would only move the misalignment along, so "Status"
              goes: the buttons now sit under the header that describes them,
              and the deactivated badge stays in the Name cell where it has
              always been rendered. */}
          <TableHead>Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {users.map((user) => (
          <UserRow
            key={user.id}
            user={user}
            isSelf={user.id === currentAdminId}
            now={now}
          />
        ))}
      </TableBody>
    </Table>
  );
}

/**
 * "Last signed in", and — when they never have — how far the invitation got.
 *
 * One column, two facts (issue #11). The question an admin brings to this
 * screen is "did the magic link work?", and "never signed in" on its own
 * cannot answer it: a person whose link was issued but never delivered looks
 * exactly like a person nobody has invited yet. The first is a broken
 * `AUTH_EMAIL_FROM`; the second is a forgotten task. Splitting these across
 * two columns would make the reader do the join.
 *
 * The phrase leads and the exact UTC value stays one hover away, never
 * replaced — the same contract as the asset history.
 */
function SignInCell({
  lastSignInAt,
  lastLinkSentAt,
  now,
}: {
  lastSignInAt: Date | null;
  lastLinkSentAt: Date | null;
  now: Date;
}) {
  if (lastSignInAt) {
    return (
      <time
        dateTime={lastSignInAt.toISOString()}
        title={exactTimestamp(lastSignInAt)}
      >
        {relativeTime(lastSignInAt, now)}
      </time>
    );
  }

  return (
    <div className="flex flex-col items-start gap-0.5">
      {/* Not a colour. The five status hues are the asset vocabulary and mean
          nothing about a person, and this state has to survive a monochrome
          print and colour-vision deficiency alike — so the distinction is
          carried by the words and by the chip's own shape. */}
      <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs">
        Never signed in
      </span>
      <span className="text-muted-foreground text-xs">
        {lastLinkSentAt ? (
          <>
            Link sent{" "}
            <time
              dateTime={lastLinkSentAt.toISOString()}
              title={exactTimestamp(lastLinkSentAt)}
            >
              {relativeTime(lastLinkSentAt, now)}
            </time>
          </>
        ) : (
          "No link sent yet"
        )}
      </span>
    </div>
  );
}

function UserRow({
  user,
  isSelf,
  now,
}: {
  user: AdminUserRow;
  isSelf: boolean;
  now: Date;
}) {
  const [roleState, roleAction, rolePending] = useActionState(changeRole, null);
  // Controlled, so the confirm dialog can submit the chosen role. Radix renders
  // dialog content in a PORTAL at the document root, outside this <tr> — so a
  // hidden input inside the dialog cannot reach back into the row to read the
  // select. It has to be handed the value.
  const [role, setRole] = useState<Role>(user.role);

  // Demoting yourself out of ADMIN_IT costs you this screen, so it is confirmed
  // — but only that case, and only when the chosen role is actually a demotion.
  // Every other role change is a select and a Save; wrapping those in a dialog
  // would train the operator to dismiss it.
  const selfDemotion =
    isSelf && user.role === "ADMIN_IT" && role !== "ADMIN_IT";

  return (
    <TableRow
      className={user.deactivated ? "text-muted-foreground" : undefined}
    >
      <TableCell>
        {user.name ?? "—"}
        {isSelf ? <span className="text-muted-foreground"> (you)</span> : null}
        {user.deactivated ? (
          <span className="bg-muted text-muted-foreground ml-2 rounded-full px-2 py-0.5 text-xs">
            Deactivated
          </span>
        ) : null}
      </TableCell>
      <TableCell>{user.email}</TableCell>
      <TableCell>{user.employeeRef ?? "—"}</TableCell>
      <TableCell>
        <form action={roleAction} className="flex items-center gap-2">
          <input type="hidden" name="userId" value={user.id} />
          <Select
            name="role"
            value={role}
            onChange={(event) => setRole(event.target.value as Role)}
            disabled={rolePending}
            aria-label={`Role for ${user.email}`}
          >
            {ROLE_ORDER.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABELS[role]}
              </option>
            ))}
          </Select>
          {selfDemotion ? (
            <SelfDemotionConfirm
              userId={user.id}
              role={role}
              pending={rolePending}
            />
          ) : (
            <Button
              type="submit"
              variant="outline"
              size="sm"
              disabled={rolePending}
            >
              {rolePending ? "Saving…" : "Apply"}
            </Button>
          )}
        </form>
      </TableCell>
      <TableCell className="text-sm">
        <SignInCell
          lastSignInAt={user.lastSignInAt}
          lastLinkSentAt={user.lastLinkSentAt}
          now={now}
        />
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <ActivationControl user={user} isSelf={isSelf} />
          {roleState ? (
            <span
              role="status"
              className={
                roleState.ok
                  ? "text-muted-foreground text-xs"
                  : "text-destructive text-xs"
              }
            >
              {roleState.message}
            </span>
          ) : null}
        </div>
      </TableCell>
    </TableRow>
  );
}

/**
 * Self-demotion out of ADMIN_IT.
 *
 * Kept as its own dialog with its own copy rather than folded into a generic
 * confirm: what makes this worth stopping for is not that a role changed, it is
 * that the person doing it is about to lose the screen they are standing on.
 * A generic "are you sure?" would say none of that.
 *
 * The server decides whether it is ALLOWED — a last remaining admin is rejected
 * by the last-admin guard. This is the warning, not the rule.
 */
function SelfDemotionConfirm({
  userId,
  role,
  pending,
}: {
  userId: string;
  role: Role;
  pending: boolean;
}) {
  return (
    <ConfirmActionDialog
      action={changeRole}
      hiddenFields={{ userId, role }}
      trigger={
        <Button type="button" variant="outline" size="sm" disabled={pending}>
          Apply
        </Button>
      }
      title="Remove your own admin access?"
      description={
        <p>
          You lose this screen immediately, and you will not be able to give the
          access back yourself. Another IT admin has to do it. If you are the
          last active one, this is refused.
        </p>
      }
      confirmLabel="Remove my admin access"
      pendingLabel="Saving…"
      destructive
    ></ConfirmActionDialog>
  );
}

/**
 * Deactivation and reactivation.
 *
 * Deactivating is confirmed for EVERYONE, not just for yourself. Before this it
 * was one unguarded click for any other user — the account, their access and
 * their sign-in link all gone on a mis-click, with no undo in the moment. That
 * gap is the reason this component exists.
 *
 * Reactivation is not confirmed: it restores access, and nothing is lost by
 * doing it accidentally.
 */
function ActivationControl({
  user,
  isSelf,
}: {
  user: AdminUserRow;
  isSelf: boolean;
}) {
  const [state, formAction, pending] = useActionState(reactivateUser, null);

  if (user.deactivated) {
    return (
      <form action={formAction}>
        <input type="hidden" name="userId" value={user.id} />
        <Button type="submit" variant="outline" size="sm" disabled={pending}>
          {pending ? "Restoring…" : "Reactivate"}
        </Button>
        {state && !state.ok ? (
          <span role="status" className="text-destructive ml-2 text-xs">
            {state.message}
          </span>
        ) : null}
      </form>
    );
  }

  return (
    <ConfirmActionDialog
      action={deactivateUser}
      hiddenFields={{ userId: user.id }}
      trigger={
        // Not red. Red is for confirming, never for offering.
        <Button type="button" variant="outline" size="sm">
          Deactivate…
        </Button>
      }
      title={
        isSelf ? "Deactivate your own account?" : `Deactivate ${user.email}?`
      }
      description={
        isSelf ? (
          <p>
            You will be signed out at your next request and will not be able to
            sign back in. Another IT admin has to restore your access. If you
            are the last active one, this is refused.
          </p>
        ) : (
          <p>
            They lose access immediately and any sign-in link stops working. The
            person, their assignments and the audit trail all stay — this is a
            flag, not a deletion, and you can reactivate them here.
          </p>
        )
      }
      confirmLabel="Deactivate"
      pendingLabel="Deactivating…"
      destructive
    />
  );
}
