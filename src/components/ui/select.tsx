import * as React from "react";

import { cn } from "@/lib/utils";

// Hand-written shadcn-style primitive over a NATIVE <select> — no Radix
// portal machinery needed for a four-option role picker, and native selects
// stay form-postable (the admin forms submit real FormData).
function Select({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="select"
      className={cn(
        "border-input dark:bg-input/30 dark:hover:bg-input/50 h-9 w-fit rounded-md border bg-transparent px-3 py-1 text-sm shadow-xs transition-[color,box-shadow] outline-none disabled:cursor-not-allowed disabled:opacity-50",
        "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
        className,
      )}
      {...props}
    />
  );
}

export { Select };
