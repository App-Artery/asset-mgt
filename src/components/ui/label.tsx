import * as React from "react";

import { cn } from "@/lib/utils";

// Hand-written shadcn-style primitive on a plain <label> — no Radix dep
// needed for the htmlFor/id association these forms use.
function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      data-slot="label"
      className={cn(
        "flex items-center gap-2 text-sm leading-none font-medium select-none",
        className,
      )}
      {...props}
    />
  );
}

export { Label };
