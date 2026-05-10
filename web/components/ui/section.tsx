import * as React from "react"
import { cn } from "@/lib/utils"

interface SectionProps extends React.ComponentPropsWithoutRef<"section"> {
  children: React.ReactNode
}

export function Section({ children, className, ...props }: SectionProps) {
  return (
    <section className={cn("px-6 py-24 md:py-32", className)} {...props}>
      {children}
    </section>
  )
}
