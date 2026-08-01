"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { ROLE_LABELS, ROLE_ORDER } from "@/lib/labels";
import { createUser } from "./actions";

// ROLE_ORDER comes from @/lib/labels, whose only Prisma import is a TYPE — so
// no Prisma runtime reaches the client bundle, exactly as before. What changed
// is that the four roles are no longer a second, unchecked copy of the enum
// (AM-09 DESIGN §4.1). The server action re-validates regardless.

export function AddUserForm() {
  const [state, formAction, pending] = useActionState(createUser, null);

  return (
    <form action={formAction} className="flex max-w-md flex-col gap-3">
      <h2 className="text-lg font-medium">Add user</h2>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="add-name">Name</Label>
        <Input id="add-name" name="name" required disabled={pending} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="add-email">Work email</Label>
        <Input
          id="add-email"
          name="email"
          type="email"
          required
          disabled={pending}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="add-employee-ref">Employee ref (optional)</Label>
        <Input id="add-employee-ref" name="employeeRef" disabled={pending} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="add-role">Role</Label>
        <Select
          id="add-role"
          name="role"
          defaultValue="STAFF_RO"
          disabled={pending}
        >
          {ROLE_ORDER.map((role) => (
            <option key={role} value={role}>
              {ROLE_LABELS[role]}
            </option>
          ))}
        </Select>
      </div>
      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? "Adding…" : "Add user"}
      </Button>
      {state ? (
        <p
          role="status"
          className={
            state.ok
              ? "text-muted-foreground text-sm"
              : "text-destructive text-sm"
          }
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
