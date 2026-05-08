import * as React from "react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

export interface Option {
  name: string
  type: string
  default?: string
  description: string
}

interface OptionTableProps extends React.HTMLAttributes<HTMLDivElement> {
  options: Option[]
}

export function OptionTable({ options, className, ...props }: OptionTableProps) {
  return (
    <div
      className={cn("border-border my-4 w-full overflow-x-auto rounded-lg border", className)}
      {...props}
    >
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left font-medium">
          <tr>
            <th className="p-3">Option</th>
            <th className="p-3">Type</th>
            <th className="p-3">Default</th>
            <th className="p-3">Description</th>
          </tr>
        </thead>
        <tbody className="divide-border divide-y">
          {options.map((opt) => (
            <tr key={opt.name}>
              <td className="text-primary p-3 font-mono font-medium">{opt.name}</td>
              <td className="p-3">
                <Badge variant="outline" className="font-mono text-xs">
                  {opt.type}
                </Badge>
              </td>
              <td className="text-muted-foreground p-3 font-mono">{opt.default || "-"}</td>
              <td className="text-muted-foreground p-3">{opt.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
