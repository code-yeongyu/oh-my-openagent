import * as React from "react"
import { cn } from "@/lib/utils"

type WithChildren = { children?: React.ReactNode; className?: string }

export const mdxComponents = {
  h1: ({ children, className, ...props }: WithChildren) => (
    <h1
      className={cn(
        "mt-8 mb-4 scroll-mt-24 text-4xl font-bold tracking-tight first:mt-0",
        className,
      )}
      {...props}
    >
      {children}
    </h1>
  ),
  h2: ({ children, className, ...props }: WithChildren) => (
    <h2
      className={cn("mt-12 mb-4 scroll-mt-24 text-2xl font-semibold tracking-tight", className)}
      {...props}
    >
      {children}
    </h2>
  ),
  h3: ({ children, className, ...props }: WithChildren) => (
    <h3
      className={cn("mt-8 mb-3 scroll-mt-24 text-xl font-semibold tracking-tight", className)}
      {...props}
    >
      {children}
    </h3>
  ),
  h4: ({ children, className, ...props }: WithChildren) => (
    <h4
      className={cn("mt-6 mb-2 scroll-mt-24 text-lg font-semibold tracking-tight", className)}
      {...props}
    >
      {children}
    </h4>
  ),
  p: ({ children, className, ...props }: WithChildren) => (
    <p className={cn("text-muted-foreground my-4 leading-7", className)} {...props}>
      {children}
    </p>
  ),
  a: ({ children, href, className, ...props }: WithChildren & { href?: string }) => (
    <a
      href={href}
      className={cn("text-primary font-medium underline underline-offset-4", className)}
      {...props}
    >
      {children}
    </a>
  ),
  ul: ({ children, className, ...props }: WithChildren) => (
    <ul className={cn("text-muted-foreground my-4 ml-6 list-disc space-y-1", className)} {...props}>
      {children}
    </ul>
  ),
  ol: ({ children, className, ...props }: WithChildren) => (
    <ol
      className={cn("text-muted-foreground my-4 ml-6 list-decimal space-y-1", className)}
      {...props}
    >
      {children}
    </ol>
  ),
  li: ({ children, className, ...props }: WithChildren) => (
    <li className={cn("leading-7", className)} {...props}>
      {children}
    </li>
  ),
  blockquote: ({ children, className, ...props }: WithChildren) => (
    <blockquote
      className={cn("border-primary/40 my-6 border-l-4 pl-4 italic", className)}
      {...props}
    >
      {children}
    </blockquote>
  ),
  code: ({ children, className, ...props }: WithChildren) => (
    <code
      className={cn("bg-muted text-foreground rounded px-1.5 py-0.5 font-mono text-sm", className)}
      {...props}
    >
      {children}
    </code>
  ),
  pre: ({ children, className, ...props }: WithChildren) => (
    <pre
      className={cn(
        "border-border/50 my-4 overflow-x-auto rounded-lg border bg-[#1e1e2e] p-4 font-mono text-sm text-[#cdd6f4] shadow-sm [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-inherit",
        className,
      )}
      {...props}
    >
      {children}
    </pre>
  ),
  table: ({ children, className, ...props }: WithChildren) => (
    <div className="my-6 overflow-x-auto">
      <table
        className={cn("border-border w-full border-collapse border text-sm", className)}
        {...props}
      >
        {children}
      </table>
    </div>
  ),
  thead: ({ children, className, ...props }: WithChildren) => (
    <thead className={cn("bg-muted", className)} {...props}>
      {children}
    </thead>
  ),
  th: ({ children, className, ...props }: WithChildren) => (
    <th
      className={cn("border-border border px-3 py-2 text-left font-semibold", className)}
      {...props}
    >
      {children}
    </th>
  ),
  td: ({ children, className, ...props }: WithChildren) => (
    <td
      className={cn("border-border text-muted-foreground border px-3 py-2", className)}
      {...props}
    >
      {children}
    </td>
  ),
  hr: ({ className, ...props }: { className?: string }) => (
    <hr className={cn("border-border my-8", className)} {...props} />
  ),
  strong: ({ children, className, ...props }: WithChildren) => (
    <strong className={cn("text-foreground font-semibold", className)} {...props}>
      {children}
    </strong>
  ),
}
