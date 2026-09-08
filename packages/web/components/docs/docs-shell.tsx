"use client"

import * as React from "react"
import { ChevronDown } from "lucide-react"
import { DocsSidebar, type DocsShellSection } from "@/components/docs/docs-sidebar"
import { useDocsNavigation } from "@/components/docs/use-docs-navigation"
import type { DocSectionId } from "@/lib/docs-sections"
import { cn } from "@/lib/utils"

export type { DocsShellSection }

export interface DocsShellProps {
  /** Label for the sidebar disclosure (< lg) and the scroll region. */
  readonly mobileHeader: string
  readonly searchPlaceholder: string
  readonly sections: readonly DocsShellSection[]
  readonly children: React.ReactNode
}

/**
 * DESIGN.md §4/§5 `fixed-sidenav-shell`: `16rem minmax(0,1fr)` at >= lg with
 * `min-block-size: 0` on the grid and both children; the content column owns the scroll
 * (`overflow: auto`, `min-inline-size: 0`) and the sidebar sits sticky in its column.
 * Below lg the sidebar folds into a top disclosure (`grid-template-rows: 0fr -> 1fr`)
 * and the document scrolls.
 *
 * The page shell already renders the document `<main>`, so the scroll owner here is a
 * labelled `role="region"` (§8) rather than a second `<main>`.
 */
export function DocsShell({
  mobileHeader,
  searchPlaceholder,
  sections,
  children,
}: DocsShellProps): React.JSX.Element {
  const scrollerRef = React.useRef<HTMLDivElement | null>(null)
  const [searchQuery, setSearchQuery] = React.useState("")
  const [isMenuOpen, setIsMenuOpen] = React.useState(false)
  const { activeSection, scrollToSection, handleInternalLinkClick } = useDocsNavigation(scrollerRef)

  const filteredSections = React.useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return sections
    return sections.filter((section) => section.title.toLowerCase().includes(query))
  }, [searchQuery, sections])

  const handleSelect = React.useCallback(
    (id: DocSectionId) => {
      scrollToSection(id)
      setIsMenuOpen(false)
    },
    [scrollToSection],
  )

  return (
    <div className="mx-auto grid min-h-0 w-full max-w-[90rem] grid-cols-[minmax(0,1fr)] lg:h-[calc(100dvh-60px)] lg:grid-cols-[16rem_minmax(0,1fr)]">
      <aside className="border-line min-h-0 min-w-0 border-b lg:overflow-y-auto lg:border-r lg:border-b-0">
        <button
          type="button"
          aria-expanded={isMenuOpen}
          aria-controls="docs-sidebar-panel"
          onClick={() => setIsMenuOpen((open) => !open)}
          className="text-text-hi focus-visible:outline-accent-32 ease-standard flex min-h-11 w-full items-center justify-between gap-3 px-4 text-sm font-medium transition-colors duration-[var(--dur-micro)] focus-visible:outline-2 focus-visible:-outline-offset-2 sm:px-5 lg:hidden"
        >
          <span>{mobileHeader}</span>
          <ChevronDown
            aria-hidden="true"
            className={cn(
              "text-text-lo ease-standard size-4 shrink-0 transition-transform duration-[var(--dur-micro)] motion-reduce:transition-none",
              isMenuOpen && "rotate-180",
            )}
          />
        </button>

        <div
          id="docs-sidebar-panel"
          data-open={isMenuOpen ? "true" : "false"}
          className="ease-standard grid grid-rows-[0fr] transition-[grid-template-rows] duration-[var(--dur-underline)] data-[open=true]:grid-rows-[1fr] motion-reduce:transition-none lg:sticky lg:top-0 lg:grid-rows-[1fr]"
        >
          <div className="min-h-0 overflow-hidden lg:overflow-visible">
            <DocsSidebar
              sections={filteredSections}
              activeSection={activeSection}
              searchQuery={searchQuery}
              searchPlaceholder={searchPlaceholder}
              onSearchChange={setSearchQuery}
              onSelect={handleSelect}
              className="px-4 pt-4 pb-6 sm:px-5 lg:p-5"
            />
          </div>
        </div>
      </aside>

      <div
        ref={scrollerRef}
        role="region"
        aria-label={mobileHeader}
        tabIndex={0}
        onClickCapture={handleInternalLinkClick}
        className="focus-visible:outline-accent-32 min-h-0 min-w-0 focus-visible:outline-2 focus-visible:-outline-offset-2 lg:overflow-auto"
      >
        <div className="mx-auto w-full max-w-3xl px-4 pt-10 pb-24 sm:px-5 lg:px-8 lg:pt-12">
          {children}
        </div>
      </div>
    </div>
  )
}
