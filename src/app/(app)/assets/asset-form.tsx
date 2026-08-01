"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { createAsset, updateAsset } from "./actions";

// Enum vocabularies hardcoded rather than imported from @prisma/client so no
// Prisma runtime reaches the client bundle (same rule as ROLE_OPTIONS). The
// server action re-validates against the real enum regardless.
export const CONDITION_OPTIONS = [
  "NEW",
  "GOOD",
  "FAIR",
  "POOR",
  "DEFECTIVE",
] as const;

/** The only statuses an asset may be created in — see INITIAL_ASSET_STATUSES. */
const INITIAL_STATUS_OPTIONS = [
  { value: "ON_ORDER", label: "On order (not yet delivered)" },
  { value: "IN_STOCK", label: "In stock (already on the shelf — needs a tag)" },
] as const;

export type AssetFormOption = { id: string; name: string };

/**
 * Every value is a string: this crosses the server/client boundary, and
 * Prisma's Decimal (purchasePrice) is not serialisable — the server component
 * converts it before it ever gets here.
 */
export type AssetFormValues = {
  id: string;
  tag: string;
  categoryId: string;
  make: string;
  model: string;
  serial: string;
  purchasedAt: string;
  purchasePrice: string;
  supplier: string;
  warrantyUntil: string;
  condition: string;
  siteId: string;
};

export function AssetForm({
  categories,
  sites,
  asset,
}: {
  categories: AssetFormOption[];
  sites: AssetFormOption[];
  /** Present for an edit, absent for a create. */
  asset?: AssetFormValues;
}) {
  const isEdit = asset !== undefined;
  const [state, formAction, pending] = useActionState(
    isEdit ? updateAsset : createAsset,
    null,
  );
  const fieldId = (name: string) => `${isEdit ? "edit" : "new"}-${name}`;

  return (
    <form action={formAction} className="flex max-w-xl flex-col gap-3">
      {isEdit ? <input type="hidden" name="assetId" value={asset.id} /> : null}

      {isEdit ? null : (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={fieldId("status")}>Starting status</Label>
          <Select
            id={fieldId("status")}
            name="status"
            defaultValue="ON_ORDER"
            disabled={pending}
          >
            {INITIAL_STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={fieldId("tag")}>Asset tag</Label>
        <Input
          id={fieldId("tag")}
          name="tag"
          defaultValue={asset?.tag}
          disabled={pending}
        />
        <p className="text-muted-foreground text-xs">
          Required from delivery onwards. Leave blank for kit still on order —
          you tag it when it arrives.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={fieldId("categoryId")}>Category</Label>
        <Select
          id={fieldId("categoryId")}
          name="categoryId"
          defaultValue={asset?.categoryId}
          required
          disabled={pending}
        >
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </Select>
      </div>

      <div className="flex gap-3">
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor={fieldId("make")}>Make</Label>
          <Input
            id={fieldId("make")}
            name="make"
            defaultValue={asset?.make}
            required
            disabled={pending}
          />
        </div>
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor={fieldId("model")}>Model</Label>
          <Input
            id={fieldId("model")}
            name="model"
            defaultValue={asset?.model}
            required
            disabled={pending}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={fieldId("serial")}>Serial number</Label>
        <Input
          id={fieldId("serial")}
          name="serial"
          defaultValue={asset?.serial}
          disabled={pending}
        />
      </div>

      <div className="flex gap-3">
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor={fieldId("purchasedAt")}>Purchased</Label>
          <Input
            id={fieldId("purchasedAt")}
            name="purchasedAt"
            type="date"
            defaultValue={asset?.purchasedAt}
            disabled={pending}
          />
        </div>
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor={fieldId("purchasePrice")}>Purchase price</Label>
          <Input
            id={fieldId("purchasePrice")}
            name="purchasePrice"
            type="number"
            min="0"
            step="0.01"
            defaultValue={asset?.purchasePrice}
            disabled={pending}
          />
        </div>
      </div>

      <div className="flex gap-3">
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor={fieldId("supplier")}>Supplier</Label>
          <Input
            id={fieldId("supplier")}
            name="supplier"
            defaultValue={asset?.supplier}
            disabled={pending}
          />
        </div>
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor={fieldId("warrantyUntil")}>Warranty until</Label>
          <Input
            id={fieldId("warrantyUntil")}
            name="warrantyUntil"
            type="date"
            defaultValue={asset?.warrantyUntil}
            disabled={pending}
          />
        </div>
      </div>

      <div className="flex gap-3">
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor={fieldId("condition")}>Condition</Label>
          <Select
            id={fieldId("condition")}
            name="condition"
            defaultValue={asset?.condition ?? ""}
            disabled={pending}
          >
            <option value="">Not recorded</option>
            {CONDITION_OPTIONS.map((condition) => (
              <option key={condition} value={condition}>
                {condition}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor={fieldId("siteId")}>Site</Label>
          <Select
            id={fieldId("siteId")}
            name="siteId"
            defaultValue={asset?.siteId ?? ""}
            disabled={pending}
          >
            <option value="">Unassigned</option>
            {sites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <Button type="submit" disabled={pending} className="w-fit">
        {pending
          ? isEdit
            ? "Saving…"
            : "Adding…"
          : isEdit
            ? "Save changes"
            : "Add asset"}
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
