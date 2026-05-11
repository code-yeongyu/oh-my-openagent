import * as React from "react"
import { cn } from "@/lib/utils"

interface CodeBlockProps extends React.HTMLAttributes<HTMLDivElement> {
  code: string
  language?: string
}

export function CodeBlock({ code, language = "json", className, ...props }: CodeBlockProps) {
  return (
    <div
      className={cn(
        "border-border/50 relative my-4 overflow-x-auto rounded-lg border bg-[#1e1e2e] p-4 font-mono text-sm text-[#cdd6f4] shadow-sm",
        className,
      )}
      {...props}
    >
      <pre>
        <code className={`language-${language}`}>{code}</code>
      </pre>
    </div>
  )
}
