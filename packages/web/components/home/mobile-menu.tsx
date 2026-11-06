"use client"

import type { JSX, ReactNode } from "react"
import { useEffect, useRef, useState } from "react"

import { Link } from "@/i18n/routing"

export interface MenuItem {
  readonly label: string
  /** Same-page anchor (home) or a locale path (other pages). */
  readonly href: string
  readonly local: boolean
}

/**
 * The phone header menu: a toggle that shows under 860 px, where the section links hide, and a sheet below the pill
 * with every link plus Install. Escape closes it and returns focus to the toggle when focus was inside.
 */
export function MobileMenu({
  items,
  install,
  labels,
  children,
}: {
  readonly items: readonly MenuItem[]
  readonly install: MenuItem
  readonly labels: { readonly open: string; readonly close: string; readonly nav: string }
  /** Shown at the top of the sheet on narrow phones, where the header has no room for it. */
  readonly children?: ReactNode
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const toggle = useRef<HTMLButtonElement | null>(null)
  const sheet = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return
      const focus = document.activeElement
      const inside = focus === toggle.current || (focus !== null && sheet.current?.contains(focus))
      setOpen(false)
      if (inside) toggle.current?.focus()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [open])

  const item = (entry: MenuItem, className: string): JSX.Element =>
    entry.local ? (
      <a
        className={className}
        href={entry.href}
        tabIndex={open ? undefined : -1}
        onClick={() => setOpen(false)}
      >
        {entry.label}
      </a>
    ) : (
      <Link
        className={className}
        href={entry.href}
        tabIndex={open ? undefined : -1}
        onClick={() => setOpen(false)}
      >
        {entry.label}
      </Link>
    )

  return (
    <>
      <button
        ref={toggle}
        type="button"
        className="nav__menu-btn"
        aria-label={open ? labels.close : labels.open}
        aria-expanded={open}
        aria-controls="mobile-nav"
        onClick={() => setOpen((value) => !value)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d={open ? "M6 6l12 12M18 6L6 18" : "M4 7h16M4 12h16M4 17h16"} />
        </svg>
      </button>
      <div id="mobile-nav" ref={sheet} className="nav__sheet" data-open={open} aria-hidden={!open}>
        {children ? <div className="nav__sheet-theme">{children}</div> : null}
        <nav aria-label={labels.nav}>
          <ul>
            {items.map((entry) => (
              <li key={entry.href}>{item(entry, "nav__sheet-link")}</li>
            ))}
          </ul>
          {item(install, "btn btn--primary nav__sheet-install")}
        </nav>
      </div>
    </>
  )
}
