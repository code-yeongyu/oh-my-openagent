"use client"

import * as React from "react"
import { DOC_SECTION_IDS, type DocSectionId } from "@/lib/docs-sections"

const ACTIVE_LINE_OFFSET_PX = 100

export function findHashSectionId(hash: string): DocSectionId | null {
  const id = hash.replace(/^#/, "")
  return DOC_SECTION_IDS.find((sectionId) => sectionId === id) ?? null
}

/**
 * Section navigation for the docs shell. The scroll owner is the `<main>` at >= lg
 * (DESIGN.md §4 fixed-sidenav-shell) and the document below lg, so every scroll and
 * every active-section measurement goes through `scrollIntoView` and the scroller's
 * bounding box instead of `window.scrollY` / `offsetTop`.
 */
export function useDocsNavigation(scrollerRef: React.RefObject<HTMLElement | null>) {
  const [activeSection, setActiveSection] = React.useState<DocSectionId>("overview")
  const activeSectionRef = React.useRef<DocSectionId>("overview")

  const markActive = React.useCallback((id: DocSectionId) => {
    if (activeSectionRef.current === id) return
    activeSectionRef.current = id
    setActiveSection(id)
  }, [])

  const scrollToSection = React.useCallback(
    (id: DocSectionId, updateHash = true) => {
      const element = document.getElementById(id)
      if (!element) return

      element.scrollIntoView({ block: "start", behavior: "auto" })
      if (updateHash && window.location.hash !== `#${id}`) {
        window.history.pushState(null, "", `#${id}`)
      }
      markActive(id)
    },
    [markActive],
  )

  React.useEffect(() => {
    const scrollToHashSection = () => {
      const sectionId = findHashSectionId(window.location.hash)
      if (!sectionId) return
      window.requestAnimationFrame(() => scrollToSection(sectionId, false))
    }

    scrollToHashSection()
    window.addEventListener("hashchange", scrollToHashSection)
    return () => window.removeEventListener("hashchange", scrollToHashSection)
  }, [scrollToSection])

  React.useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return

    const sectionEls = DOC_SECTION_IDS.map((id) => document.getElementById(id))
    let rafId: number | null = null

    const measure = () => {
      rafId = null
      const scrollerTop = Math.max(scroller.getBoundingClientRect().top, 0)
      const line = scrollerTop + ACTIVE_LINE_OFFSET_PX
      let nextActive: DocSectionId | null = null

      for (const el of sectionEls) {
        if (!el) continue
        const id = findHashSectionId(el.id)
        if (id && el.getBoundingClientRect().top <= line) nextActive = id
      }

      if (nextActive) markActive(nextActive)
    }

    const handleScroll = () => {
      if (rafId !== null) return
      rafId = window.requestAnimationFrame(measure)
    }

    scroller.addEventListener("scroll", handleScroll, { passive: true })
    window.addEventListener("scroll", handleScroll, { passive: true })
    handleScroll()

    return () => {
      scroller.removeEventListener("scroll", handleScroll)
      window.removeEventListener("scroll", handleScroll)
      if (rafId !== null) window.cancelAnimationFrame(rafId)
    }
  }, [markActive, scrollerRef])

  const handleInternalLinkClick = React.useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      if (!(event.target instanceof Element)) return

      const anchor = event.target.closest("a[href]")
      if (!(anchor instanceof HTMLAnchorElement)) return

      const sectionId = findHashSectionId(anchor.hash)
      if (!sectionId) return

      const href = anchor.getAttribute("href")
      const isSamePath =
        anchor.origin === window.location.origin && anchor.pathname === window.location.pathname
      if (!href?.startsWith("#") && !isSamePath) return

      event.preventDefault()
      scrollToSection(sectionId)
    },
    [scrollToSection],
  )

  return { activeSection, scrollToSection, handleInternalLinkClick }
}
