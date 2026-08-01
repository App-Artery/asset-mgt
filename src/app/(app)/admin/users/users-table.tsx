"use client";

import { useActionState } from "react";
import type { Role } from "@prisma/client";
import { ROLE_LABELS, ROLE_ORDER } from "@/lib/labels";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
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
};

export function UsersTable({
  users,
  currentAdminId,
}: {
  users: AdminUserRow[];
  currentAdminId: string;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Email</TableHead>
          <TableHead>Employee ref</TableHead>
          <TableHead>Role</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {users.map((user) => (
          <UserRow
            key={user.id}
            user={user}
            isSelf={user.id === currentAdminId}
          />
        ))}
      </TableBody>
    </Table>
  );
}

function UserRow({ user, isSelf }: { user: AdminUserRow; isSelf: boolean }) {
  const [roleState, roleAction, rolePending] = useActionState(changeRole, null);
  const [activationState, activationAction, activationPending] = useActionState(
    user.deactivated ? reactivateUser : deactivateUser,
    null,
  );
  const message = roleState ?? activationState;

  return (
    <TableRow className={user.deactivated ? "opacity-60" : undefined}>
      <TableCell>
        {user.name ?? "—"}
        {isSelf ? <span className="text-muted-foreground"> (you)</span> : null}
      </TableCell>
      <TableCell>{user.email}</TableCell>
      <TableCell>{user.employeeRef ?? "—"}</TableCell>
      <TableCell>
        <form
          action={roleAction}
          className="flex items-center gap-2"
          onSubmit={(event) => {
            // Self-demotion is permitted when another active admin remains —
            // the server guard decides that; this is UX-only (AM-01 design).
            const chosen = new FormData(event.currentTarget).get("role");
            if (
              isSelf &&
              user.role === "ADMIN_IT" &&
              chosen !== "ADMIN_IT" &&
              !window.confirm(
                "Remove your own admin access? You will lose this screen immediately.",
              )
            ) {
              event.preventDefault();
            }
          }}
        >
          <input type="hidden" name="userId" value={user.id} />
          <Select
            name="role"
            defaultValue={user.role}
            disabled={rolePending}
            aria-label={`Role for ${user.email}`}
          >
            {ROLE_ORDER.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABELS[role]}
              </option>
            ))}
          </Select>
          <Button
            type="submit"
            variant="outline"
            size="sm"
            disabled={rolePending}
          >
            {rolePending ? "Saving…" : "Apply"}
          </Button>
        </form>
      </TableCell>
      <TableCell>{user.deactivated ? "Deactivated" : "Active"}</TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <form
            action={activationAction}
            onSubmit={(event) => {
              if (
                isSelf &&
                !user.deactivated &&
                !window.confirm(
                  "Deactivate your own account? You will be signed out at your next request.",
                )
              ) {
                event.preventDefault();
              }
            }}
          >
            <input type="hidden" name="userId" value={user.id} />
            <Button
              type="submit"
              variant={user.deactivated ? "outline" : "destructive"}
              size="sm"
              disabled={activationPending}
            >
              {user.deactivated ? "Reactivate" : "Deactivate"}
            </Button>
          </form>
          {message ? (
            <span
              role="status"
              className={
                message.ok
                  ? "text-muted-foreground text-xs"
                  : "text-destructive text-xs"
              }
            >
              {message.message}
            </span>
          ) : null}
        </div>
      </TableCell>
    </TableRow>
  );
}
