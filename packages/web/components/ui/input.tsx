import * as React from "react"

import { cn } from "@/lib/utils"

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "border-line bg-ink-1 text-text-hi placeholder:text-text-lo focus-visible:border-line-strong focus-visible:outline-accent-32 ease-standard flex h-9 w-full rounded-[2px] border px-3 py-1 text-base transition-colors duration-[var(--dur-micro)] file:border-0 file:bg-transparent file:text-sm file:font-medium focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className,
        )}
        ref={ref}
        {...props}
      />
    )
  },
)
Input.displayName = "Input"

export { Input }
