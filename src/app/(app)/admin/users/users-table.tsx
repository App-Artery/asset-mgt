"use client";

import {
  ResponsiveTable,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { UserCardList } from "./user-card-list";
import {
  ActivationControl,
  RoleForm,
  SignInCell,
  type AdminUserRow,
} from "./user-controls";

// Re-exported so page.tsx's import is unchanged. The type moved to
// user-controls.tsx because both shapes consume it and neither owns it.
export type { AdminUserRow };

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
    // No `sticky`: the roster is bounded by headcount, and a scroll pane on a
    // short table is worse than none.
    <ResponsiveTable
      tableTestId="users-table"
      cardsTestId="users-cards"
      cards={
        <UserCardList users={users} currentAdminId={currentAdminId} now={now} />
      }
    >
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
    </ResponsiveTable>
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
        <RoleForm user={user} isSelf={isSelf} />
      </TableCell>
      <TableCell className="text-sm">
        <SignInCell
          lastSignInAt={user.lastSignInAt}
          lastLinkSentAt={user.lastLinkSentAt}
          now={now}
        />
      </TableCell>
      <TableCell>
        <ActivationControl user={user} isSelf={isSelf} />
      </TableCell>
    </TableRow>
  );
}
