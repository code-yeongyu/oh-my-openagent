"use client"

import * as React from "react"

const ACTIVE_LINE_OFFSET_PX = 100

export function findHashSectionId(hash: string, sectionIds: readonly string[]): string | null {
  const id = hash.replace(/^#/, "")
  return sectionIds.find((sectionId) => sectionId === id) ?? null
}

/**
 * Section navigation for the docs shell. The scroll owner is the `<main>` at >= lg
 * (DESIGN.md §4 fixed-sidenav-shell) and the document below lg, so every scroll and
 * every active-section measurement goes through `scrollIntoView` and the scroller's
 * bounding box instead of `window.scrollY` / `offsetTop`.
 */
export function useDocsNavigation(
  scrollerRef: React.RefObject<HTMLElement | null>,
  sectionIds: readonly string[],
) {
  const firstSection = sectionIds[0] ?? ""
  const [activeSection, setActiveSection] = React.useState(firstSection)
  const activeSectionRef = React.useRef(firstSection)

  const markActive = React.useCallback((id: string) => {
    if (activeSectionRef.current === id) return
    activeSectionRef.current = id
    setActiveSection(id)
  }, [])

  const scrollToSection = React.useCallback(
    (id: string, updateHash = true) => {
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
      const sectionId = findHashSectionId(window.location.hash, sectionIds)
      if (!sectionId) return
      window.requestAnimationFrame(() => scrollToSection(sectionId, false))
    }

    scrollToHashSection()
    window.addEventListener("hashchange", scrollToHashSection)
    return () => window.removeEventListener("hashchange", scrollToHashSection)
  }, [scrollToSection, sectionIds])

  React.useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return

    const sectionEls = sectionIds.map((id) => document.getElementById(id))
    let rafId: number | null = null

    const measure = () => {
      rafId = null
      const scrollerTop = Math.max(scroller.getBoundingClientRect().top, 0)
      const line = scrollerTop + ACTIVE_LINE_OFFSET_PX
      let nextActive: string | null = null

      for (const el of sectionEls) {
        if (!el) continue
        const id = findHashSectionId(el.id, sectionIds)
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
  }, [markActive, scrollerRef, sectionIds])

  const handleInternalLinkClick = React.useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      if (!(event.target instanceof Element)) return

      const anchor = event.target.closest("a[href]")
      if (!(anchor instanceof HTMLAnchorElement)) return

      const sectionId = findHashSectionId(anchor.hash, sectionIds)
      if (!sectionId) return

      const href = anchor.getAttribute("href")
      const isSamePath =
        anchor.origin === window.location.origin && anchor.pathname === window.location.pathname
      if (!href?.startsWith("#") && !isSamePath) return

      event.preventDefault()
      scrollToSection(sectionId)
    },
    [scrollToSection, sectionIds],
  )

  return { activeSection, scrollToSection, handleInternalLinkClick }
}
