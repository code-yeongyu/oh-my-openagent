"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { Github, Menu, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Link } from "@/i18n/routing"

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
              <Github className="h-3 w-3" />
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
            <Github className="h-4 w-4" />
            <span>{t("starOnGitHub")}</span>
          </a>
        </nav>
      </div>
    </header>
  )
}
