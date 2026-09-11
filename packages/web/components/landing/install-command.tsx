"use client"

import type { JSX } from "react"
import { useEffect, useId, useState } from "react"
import { useTranslations } from "next-intl"

import { cn } from "@/lib/utils"

const COPIED_MS = 2000

export interface CommandTab {
  readonly id: string
  readonly label: string
  readonly command: string
}

export interface CommandBarProps {
  /** Single command (no tab row). */
  readonly command?: string
  /** Tab row (`OPENCODE · CODEX · SENPI`); the first tab is selected initially. */
  readonly tabs?: readonly CommandTab[]
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
 * for 2s. 48px tall, 0px radius, `focus-within` selection ring. Optional tab row above.
 */
export function CommandBar({ command, tabs, className }: CommandBarProps): JSX.Element {
  const t = useTranslations("landing.command")
  const baseId = useId()
  const [activeId, setActiveId] = useState(tabs?.[0]?.id)
  const { copied, copy } = useCopy()

  const activeTab = tabs?.find((tab) => tab.id === activeId) ?? tabs?.[0]
  const text = activeTab?.command ?? command ?? ""
  const panelId = `${baseId}-panel`

  return (
    <div className={cn("w-full", className)}>
      {tabs ? (
        <div role="tablist" aria-label={t("tabsLabel")} className="border-line flex border-b">
          {tabs.map((tab) => {
            const selected = tab.id === activeTab?.id
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                id={`${baseId}-tab-${tab.id}`}
                aria-selected={selected}
                aria-controls={panelId}
                tabIndex={selected ? 0 : -1}
                onClick={() => setActiveId(tab.id)}
                className={cn(
                  "eyebrow ease-standard focus-visible:outline-accent-32 -mb-px min-h-11 border-b px-3 transition-colors duration-[var(--dur-micro)] focus-visible:outline-2 focus-visible:-outline-offset-2",
                  selected
                    ? "border-accent text-text-hi"
                    : "hover:text-text-hi text-text-lo border-transparent",
                )}
              >
                {tab.label}
              </button>
            )
          })}
        </div>
      ) : null}
      <div
        id={panelId}
        role={tabs ? "tabpanel" : undefined}
        aria-labelledby={tabs && activeTab ? `${baseId}-tab-${activeTab.id}` : undefined}
        className="border-line bg-ink-1 flex h-12 border focus-within:shadow-[inset_0_0_0_1px_var(--accent-32)]"
      >
        <span
          aria-hidden="true"
          className="bg-ink-2 text-accent border-line flex w-10 shrink-0 items-center justify-center border-r font-mono text-sm"
        >
          $
        </span>
        <code className="text-text-hi flex min-w-0 flex-1 scrollbar-none items-center overflow-x-auto px-3 font-mono text-[0.8125rem] leading-[1.55] tracking-[-0.01em] whitespace-nowrap sm:text-sm">
          {text}
        </code>
        <button
          type="button"
          onClick={() => copy(text)}
          aria-label={t("copyAria")}
          data-copied={copied ? "true" : undefined}
          className="eyebrow border-line hover:text-text-hi data-[copied=true]:text-accent ease-standard focus-visible:outline-accent-32 w-20 shrink-0 border-l transition-colors duration-[var(--dur-micro)] focus-visible:outline-2 focus-visible:-outline-offset-2"
        >
          {copied ? t("copied") : t("copy")}
        </button>
      </div>
    </div>
  )
}

/** Single-command bar (editions, CTA). Kept for the existing import name. */
export function InstallCommand({
  command,
  className,
}: {
  readonly command: string
  readonly className?: string
}): JSX.Element {
  return <CommandBar command={command} className={className} />
}
