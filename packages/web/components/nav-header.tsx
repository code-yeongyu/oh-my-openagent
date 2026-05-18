"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { Menu, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Link } from "@/i18n/routing"

function GitHubMark({ className }: { readonly className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="currentColor">
      <path d="M12 2C6.48 2 2 6.58 2 12.25c0 4.53 2.87 8.37 6.84 9.73.5.1.68-.22.68-.49v-1.9c-2.78.62-3.37-1.22-3.37-1.22-.46-1.2-1.11-1.52-1.11-1.52-.91-.64.07-.63.07-.63 1 .07 1.53 1.06 1.53 1.06.9 1.57 2.35 1.12 2.92.85.09-.67.35-1.12.63-1.38-2.22-.26-4.55-1.14-4.55-5.06 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05A9.3 9.3 0 0 1 12 6.94c.85 0 1.7.12 2.5.34 1.9-1.33 2.74-1.05 2.74-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.93-2.34 4.8-4.57 5.05.36.32.68.95.68 1.91v2.84c0 .27.18.59.69.49A10.18 10.18 0 0 0 22 12.25C22 6.58 17.52 2 12 2" />
    </svg>
  )
}

export function NavHeader() {
  const t = useTranslations("nav")
  const [isOpen, setIsOpen] = useState(false)

  return (
    <header className="sticky top-0 z-50 w-full border-b border-white/10 bg-black/50 backdrop-blur-xl">
      <div className="container mx-auto flex h-16 items-center justify-between px-4 md:px-6">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2">
            <span className="text-lg font-bold tracking-tight text-white">{t("brand")}</span>
          </Link>
          <nav className="hidden items-center gap-6 text-sm font-medium text-zinc-400 md:flex">
            <Link href="/#features" className="transition-colors hover:text-cyan-400">
              {t("features")}
            </Link>
            <Link href="/#agents" className="transition-colors hover:text-cyan-400">
              {t("agents")}
            </Link>
            <Link href="/docs" className="transition-colors hover:text-cyan-400">
              {t("docs")}
            </Link>
            <Link href="/manifesto" className="transition-colors hover:text-cyan-400">
              {t("manifesto")}
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <a
            href="https://github.com/code-yeongyu/oh-my-openagent"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden sm:flex"
          >
            <Badge
              variant="secondary"
              className="gap-1 border-zinc-700 bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
            >
              <GitHubMark className="h-3 w-3" />
              <span>{t("starOnGitHub")}</span>
            </Badge>
          </a>
          <Button
            variant="ghost"
            size="icon"
            className="text-zinc-400 hover:bg-zinc-800 hover:text-white md:hidden"
            onClick={() => setIsOpen(!isOpen)}
            aria-label={isOpen ? "Close menu" : "Open menu"}
            aria-expanded={isOpen}
            aria-controls="mobile-nav"
          >
            {isOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>
      </div>

      <div
        id="mobile-nav"
        className={
          `overflow-hidden bg-black/95 backdrop-blur-xl transition-[max-height,opacity] duration-200 ease-in-out md:hidden ` +
          (isOpen
            ? "max-h-[420px] border-b border-white/10 opacity-100"
            : "pointer-events-none max-h-0 opacity-0")
        }
        aria-hidden={!isOpen}
      >
        <nav className="flex flex-col gap-4 p-4 text-sm font-medium text-zinc-400">
          <Link
            href="/#features"
            className="transition-colors hover:text-cyan-400"
            onClick={() => setIsOpen(false)}
          >
            {t("features")}
          </Link>
          <Link
            href="/#agents"
            className="transition-colors hover:text-cyan-400"
            onClick={() => setIsOpen(false)}
          >
            {t("agents")}
          </Link>
          <Link
            href="/docs"
            className="transition-colors hover:text-cyan-400"
            onClick={() => setIsOpen(false)}
          >
            {t("docs")}
          </Link>
          <Link
            href="/manifesto"
            className="transition-colors hover:text-cyan-400"
            onClick={() => setIsOpen(false)}
          >
            {t("manifesto")}
          </Link>
          <a
            href="https://github.com/code-yeongyu/oh-my-openagent"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 transition-colors hover:text-cyan-400 sm:hidden"
            onClick={() => setIsOpen(false)}
          >
            <GitHubMark className="h-4 w-4" />
            <span>{t("starOnGitHub")}</span>
          </a>
        </nav>
      </div>
    </header>
  )
}
