"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { createUser } from "./actions";

// The four PRD roles, hardcoded rather than imported from @prisma/client so
// no Prisma runtime reaches the client bundle. The server action re-validates
// against the real enum regardless.
export const ROLE_OPTIONS = [
  "STAFF_RO",
  "PROCUREMENT",
  "FINANCE",
  "ADMIN_IT",
] as const;

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
          {ROLE_OPTIONS.map((role) => (
            <option key={role} value={role}>
              {role}
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
