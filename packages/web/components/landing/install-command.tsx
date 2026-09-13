"use client"

import type { JSX } from "react"
import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"

import { cn } from "@/lib/utils"

const COPIED_MS = 2000

export interface CommandBarProps {
  readonly command: string
  readonly className?: string
}

function useCopy(): { copied: boolean; copy: (text: string) => void } {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), COPIED_MS)
    return () => window.clearTimeout(timer)
  }, [copied])

  function copy(text: string): void {
    navigator.clipboard
      .writeText(text)
      .then(() => setCopied(true))
      .catch((error: unknown) => console.warn("Failed to copy install command", error))
  }

  return { copied, copy }
}

/**
 * DESIGN.md §5 CommandBar — the site's primary CTA. Prompt cell (40px, `--accent` glyph on
 * `--ink-2`), mono command on `--ink-1`, fixed-width COPY cell that action-swaps to COPIED
 * for 2s. 48px tall, 0px radius, `focus-within` selection ring.
 */
export function CommandBar({ command, className }: CommandBarProps): JSX.Element {
  const t = useTranslations("landing.command")
  const { copied, copy } = useCopy()

  return (
    <div
      data-testid="command-bar"
      className={cn(
        "border-line bg-ink-1 flex h-12 w-full border focus-within:shadow-[inset_0_0_0_1px_var(--accent-32)]",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="bg-ink-2 text-accent border-line flex w-10 shrink-0 items-center justify-center border-r font-mono text-sm"
      >
        $
      </span>
      <code className="text-text-hi flex min-w-0 flex-1 scrollbar-none items-center overflow-x-auto px-3 font-mono text-[0.8125rem] leading-[1.55] tracking-[-0.01em] whitespace-nowrap sm:text-sm">
        {command}
      </code>
      <button
        type="button"
        onClick={() => copy(command)}
        aria-label={t("copyAria")}
        data-copied={copied ? "true" : undefined}
        className="eyebrow border-line hover:text-text-hi data-[copied=true]:text-accent ease-standard focus-visible:outline-accent-32 w-20 shrink-0 border-l transition-colors duration-[var(--dur-micro)] focus-visible:outline-2 focus-visible:-outline-offset-2"
      >
        {copied ? t("copied") : t("copy")}
      </button>
    </div>
  )
}

export function InstallCommand(props: CommandBarProps): JSX.Element {
  return <CommandBar {...props} />
}
