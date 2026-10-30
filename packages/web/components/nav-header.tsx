"use client"

import type { JSX } from "react"
import { useEffect, useRef, useState } from "react"
import Image from "next/image"
import { useTranslations } from "next-intl"
import { Menu, Star, X } from "lucide-react"

import { GithubIcon } from "@/components/icons/github-icon"
import { useLiveStats } from "@/components/landing/live-stats"
import { Button } from "@/components/ui/button"
import { Chip } from "@/components/ui/badge"
import { Link, usePathname } from "@/i18n/routing"
import { cn } from "@/lib/utils"

const GITHUB_URL = "https://github.com/code-yeongyu/oh-my-openagent"
const SCROLL_THRESHOLD = 24

type NavLinkKey = "features" | "docs" | "manifesto"

interface NavItem {
  readonly key: NavLinkKey
  readonly href: "/#features" | "/docs" | "/manifesto"
  readonly isActive: (pathname: string) => boolean
}

const NAV_ITEMS: readonly NavItem[] = [
  { key: "features", href: "/#features", isActive: () => false },
  { key: "docs", href: "/docs", isActive: (p) => p.startsWith("/docs") },
  { key: "manifesto", href: "/manifesto", isActive: (p) => p.startsWith("/manifesto") },
]

export interface NavHeaderProps {
  /** Formatted star count rendered on the server ("68.8k"); refreshed client-side. */
  readonly stars: string
}

function useScrolled(threshold: number): boolean {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const update = (): void => setScrolled(window.scrollY > threshold)
    update()
    window.addEventListener("scroll", update, { passive: true })
    return () => window.removeEventListener("scroll", update)
  }, [threshold])
  return scrolled
}

/**
 * DESIGN.md §5 Nav: sticky 60px, transparent until scrollY > 24 then `--ink-0/72%` +
 * blur(12px); mono uppercase links with a growing underline; GitHub star chip; Install.
 */
export function NavHeader({ stars }: NavHeaderProps): JSX.Element {
  const t = useTranslations("nav")
  const pathname = usePathname()
  const scrolled = useScrolled(SCROLL_THRESHOLD)
  const [isOpen, setIsOpen] = useState(false)
  const menuToggleRef = useRef<HTMLButtonElement | null>(null)
  const sheetRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!isOpen) return
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return
      const focus = document.activeElement
      const focusWasInSheet =
        focus === menuToggleRef.current || (focus !== null && sheetRef.current?.contains(focus))
      setIsOpen(false)
      if (focusWasInSheet) menuToggleRef.current?.focus()
    }
    document.addEventListener("keydown", closeOnEscape)
    return () => document.removeEventListener("keydown", closeOnEscape)
  }, [isOpen])
  const live = useLiveStats({
    stars,
    totalDownloads: "",
    monthlyDownloads: "",
    weeklyDownloads: "",
  })

  return (
    <header
      data-scrolled={scrolled ? "true" : "false"}
      className="border-line data-[scrolled=true]:bg-ink-0/72 ease-standard sticky top-0 z-50 w-full border-b bg-transparent transition-colors duration-[var(--dur-micro)] data-[scrolled=true]:backdrop-blur-md"
    >
      <div className="mx-auto flex h-(--nav-h) w-full max-w-[90rem] items-center justify-between px-4 sm:px-5 lg:px-8">
        <Link href="/" className="focus-ring flex min-h-11 items-center gap-2.5 rounded-[2px]">
          <Image src="/brand/omo-mark.svg" alt="" width={24} height={24} priority />
          <span className="text-text-hi text-[15px] font-medium tracking-[-0.02em]">
            {t("brand")}
          </span>
        </Link>

        <nav aria-label={t("primary")} className="hidden items-center gap-8 md:flex">
          {NAV_ITEMS.map((item) => {
            const active = item.isActive(pathname)
            return (
              <Link
                key={item.key}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "underline-grow tracking-nav ease-standard focus-ring font-mono text-xs uppercase transition-colors duration-[var(--dur-micro)]",
                  active ? "text-text-hi" : "text-text-mid hover:text-text-hi",
                )}
              >
                {t(item.key)}
              </Link>
            )
          })}
        </nav>

        <div className="flex items-center gap-3">
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t("githubStars", { count: live.stars })}
            className="focus-ring inline-flex min-h-11 items-center rounded-[2px]"
          >
            <Chip className="bg-ink-1 hover:border-line-strong hover:text-text-hi">
              <GithubIcon className="size-3.5" />
              <Star aria-hidden="true" className="size-3" />
              <span className="tabular-nums">{live.stars}</span>
            </Chip>
          </a>
          <Button size="sm" className="hidden md:inline-flex" asChild>
            <Link href="/docs/install">{t("install")}</Link>
          </Button>
          <Button
            ref={menuToggleRef}
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setIsOpen((open) => !open)}
            aria-label={isOpen ? t("closeMenu") : t("openMenu")}
            aria-expanded={isOpen}
            aria-controls="mobile-nav"
          >
            {isOpen ? <X className="size-5" /> : <Menu className="size-5" />}
          </Button>
        </div>
      </div>

      <div
        id="mobile-nav"
        ref={sheetRef}
        aria-hidden={!isOpen}
        className={cn(
          "bg-ink-3 ease-standard grid transition-[grid-template-rows] duration-[var(--dur-micro)] md:hidden",
          isOpen ? "border-line grid-rows-[1fr] border-t" : "pointer-events-none grid-rows-[0fr]",
        )}
      >
        <nav aria-label={t("primary")} className="min-h-0 overflow-hidden">
          <ul className="flex flex-col p-3">
            {NAV_ITEMS.map((item) => (
              <li key={item.key}>
                <Link
                  href={item.href}
                  tabIndex={isOpen ? undefined : -1}
                  aria-current={item.isActive(pathname) ? "page" : undefined}
                  onClick={() => setIsOpen(false)}
                  className="text-text-mid hover:text-text-hi hover:bg-accent-4 aria-[current=page]:text-text-hi tracking-nav ease-standard focus-ring-inset flex min-h-11 items-center px-3 font-mono text-xs uppercase transition-colors duration-[var(--dur-micro)]"
                >
                  {t(item.key)}
                </Link>
              </li>
            ))}
            <li className="p-3">
              <Button size="md" className="w-full" asChild>
                <Link
                  href="/docs/install"
                  tabIndex={isOpen ? undefined : -1}
                  onClick={() => setIsOpen(false)}
                >
                  {t("install")}
                </Link>
              </Button>
            </li>
          </ul>
        </nav>
      </div>
    </header>
  )
}
