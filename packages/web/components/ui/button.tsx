import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * DESIGN.md §5 Button. Radius 2px, 150ms color transitions, 1px press.
 * `outline` is a compatibility alias of `secondary` for sections not yet migrated.
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-[2px] font-medium whitespace-nowrap transition-[color,background-color,border-color,transform] duration-[var(--dur-micro)] ease-standard select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-32 active:translate-y-px disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-accent text-ink-0 hover:bg-accent-dim",
        secondary:
          "border border-line-strong bg-ink-1 text-text-hi hover:border-accent-32 hover:text-accent",
        outline:
          "border border-line-strong bg-ink-1 text-text-hi hover:border-accent-32 hover:text-accent",
        ghost: "text-text-mid hover:text-text-hi",
        link: "underline-grow h-auto rounded-none px-0 font-mono text-xs tracking-nav text-text-mid uppercase hover:text-text-hi",
      },
      size: {
        sm: "h-9 px-3 text-sm",
        md: "h-11 px-5 text-sm",
        lg: "h-12 px-6 text-base",
        icon: "size-11",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  readonly asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    )
  },
)
Button.displayName = "Button"

export { Button, buttonVariants }
