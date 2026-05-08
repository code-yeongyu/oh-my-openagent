"use client"

import * as React from "react"
import { Menu, Search } from "lucide-react"
import { Link } from "@/i18n/routing"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DOC_SECTION_IDS, type DocSectionId } from "@/lib/docs-sections"

type DocsShellSection = {
  id: DocSectionId
  title: string
}

export function DocsShell({
  mobileHeader,
  searchPlaceholder,
  sections,
  children,
}: {
  mobileHeader: string
  searchPlaceholder: string
  sections: DocsShellSection[]
  children: React.ReactNode
}) {
  const [searchQuery, setSearchQuery] = React.useState("")
  const [activeSection, setActiveSection] = React.useState<DocSectionId>("overview")
  const [isMobileMenuOpen, setIsMobileMenuOpen] = React.useState(false)

  const activeSectionRef = React.useRef<DocSectionId>("overview")

  React.useEffect(() => {
    activeSectionRef.current = activeSection
  }, [activeSection])

  const filteredSections = React.useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return sections
    return sections.filter((section) => section.title.toLowerCase().includes(query))
  }, [searchQuery, sections])

  React.useEffect(() => {
    const sectionEls = DOC_SECTION_IDS.map((id) => document.getElementById(id))
    let rafId: number | null = null

    const handleScroll = () => {
      if (rafId !== null) return

      rafId = window.requestAnimationFrame(() => {
        rafId = null

        const scrollPosition = window.scrollY + 100
        let nextActive: DocSectionId | null = null

        for (let i = 0; i < sectionEls.length; i++) {
          const el = sectionEls[i]
          if (!el) continue
          if (el.offsetTop <= scrollPosition && el.offsetTop + el.offsetHeight > scrollPosition) {
            nextActive = el.id as DocSectionId
            break
          }
        }

        if (nextActive && nextActive !== activeSectionRef.current) {
          activeSectionRef.current = nextActive
          setActiveSection(nextActive)
        }
      })
    }

    window.addEventListener("scroll", handleScroll, { passive: true })
    handleScroll()

    return () => {
      window.removeEventListener("scroll", handleScroll)
      if (rafId !== null) window.cancelAnimationFrame(rafId)
    }
  }, [])

  const scrollToSection = (id: DocSectionId) => {
    const element = document.getElementById(id)
    if (!element) return

    window.scrollTo({ top: element.offsetTop - 80, behavior: "auto" })
    activeSectionRef.current = id
    setActiveSection(id)
    setIsMobileMenuOpen(false)
  }

  return (
    <div className="bg-background text-foreground flex min-h-screen">
      <div className="bg-background/95 fixed top-0 right-0 left-0 z-50 flex items-center justify-between border-b px-4 py-3 backdrop-blur md:hidden">
        <Link href="/" className="font-bold">
          {mobileHeader}
        </Link>
        <Button
          variant="ghost"
          size="icon"
          type="button"
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          aria-label="Toggle sidebar menu"
        >
          <Menu className="h-5 w-5" />
        </Button>
      </div>

      <aside
        className={`bg-background fixed inset-y-0 left-0 z-40 w-64 transform border-r transition-transform duration-200 ease-in-out md:translate-x-0 ${isMobileMenuOpen ? "translate-x-0" : "-translate-x-full"} pt-16`}
      >
        <div className="flex h-full flex-col">
          <div className="p-4">
            <div className="relative">
              <Search className="text-muted-foreground absolute top-2.5 left-2 h-4 w-4" />
              <Input
                placeholder={searchPlaceholder}
                className="pl-8"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>
          <nav className="flex-1 overflow-y-auto px-2 pb-4">
            <ul className="space-y-1">
              {filteredSections.map((section) => (
                <li key={section.id}>
                  <button
                    type="button"
                    onClick={() => scrollToSection(section.id)}
                    className={`w-full rounded-md px-3 py-2 text-left text-sm font-medium transition-colors ${
                      activeSection === section.id
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    } `}
                  >
                    {section.title}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </aside>

      <main className="flex-1 px-4 pt-20 pb-20 md:ml-64 md:px-8 md:pt-8">
        <div className="mx-auto max-w-4xl space-y-12">{children}</div>
      </main>
    </div>
  )
}
