"use client"

import { useId, type JSX } from "react"
import { Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

export type DocsShellSection = {
  id: string
  title: string
}

export interface DocsSidebarProps {
  readonly sections: readonly DocsShellSection[]
  readonly activeSection: string
  readonly searchQuery: string
  readonly searchLabel: string
  readonly searchPlaceholder: string
  readonly sectionsLabel: string
  readonly onSearchChange: (value: string) => void
  readonly onSelect: (id: string) => void
  readonly className?: string
}

/**
 * DESIGN.md §5 DocsShell sidebar: Chip-styled search input and a hairline-ruled section
 * list; the active item carries a 2px `--accent` left rule over the list's hairline.
 */
export function DocsSidebar({
  sections,
  activeSection,
  searchQuery,
  searchLabel,
  searchPlaceholder,
  sectionsLabel,
  onSearchChange,
  onSelect,
  className,
}: DocsSidebarProps): JSX.Element {
  const searchId = useId()
  return (
    <div className={cn("flex flex-col gap-6", className)}>
      <div className="relative">
        <label htmlFor={searchId} className="sr-only">
          {searchLabel}
        </label>
        <Search
          aria-hidden="true"
          className="text-text-lo pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
        />
        <Input
          id={searchId}
          type="search"
          placeholder={searchPlaceholder}
          className="bg-ink-2 h-11 pl-9 font-mono text-sm lg:h-9"
          value={searchQuery}
          onChange={(event) => onSearchChange(event.target.value)}
        />
      </div>

      <nav aria-label={sectionsLabel}>
        <ul className="border-line border-l">
          {sections.map((section) => {
            const isActive = activeSection === section.id
            return (
              <li key={section.id}>
                <button
                  type="button"
                  data-active={isActive ? "true" : undefined}
                  onClick={() => onSelect(section.id)}
                  className={cn(
                    "ease-standard focus-ring-inset relative -ml-px flex min-h-11 w-full items-center px-4 text-left text-sm transition-colors duration-[var(--dur-micro)] lg:min-h-9",
                    "before:bg-accent before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:opacity-0 before:transition-opacity before:duration-[var(--dur-micro)] before:content-['']",
                    isActive
                      ? "text-text-hi before:opacity-100"
                      : "text-text-mid hover:bg-accent-4 hover:text-text-hi",
                  )}
                >
                  {section.title}
                </button>
              </li>
            )
          })}
        </ul>
      </nav>
    </div>
  )
}
