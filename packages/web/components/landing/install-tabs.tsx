"use client"

import type { JSX, KeyboardEvent } from "react"
import { useId, useRef, useState, useSyncExternalStore } from "react"
import { useTranslations } from "next-intl"

import { CommandBar } from "@/components/landing/install-command"
import {
  detectInstallFromNavigator,
  INSTALL_COMMANDS,
  INSTALL_PROMPTS,
  INSTALL_TARGETS,
  type InstallTarget,
} from "@/lib/install-targets"
import { cn } from "@/lib/utils"

const NOSCRIPT_STYLE =
  "<style>[data-install-tabs] [role=tablist],[data-install-tabs] [data-caption]{display:none}[data-install-tabs] [data-panel],[data-install-tabs] [data-panel-label]{display:block}[data-install-tabs] [data-testid=command-bar]{border-top-width:1px}</style>"

const subscribeNever = (): (() => void) => () => undefined

function readDetectedTarget(): InstallTarget {
  return detectInstallFromNavigator(navigator).target
}

function serverTarget(): InstallTarget {
  return "unix"
}

function nextTarget(current: InstallTarget, key: string): InstallTarget | null {
  const index = INSTALL_TARGETS.indexOf(current)
  const last = INSTALL_TARGETS.length - 1
  const next =
    key === "ArrowRight"
      ? (index + 1) % INSTALL_TARGETS.length
      : key === "ArrowLeft"
        ? (index + last) % INSTALL_TARGETS.length
        : key === "Home"
          ? 0
          : key === "End"
            ? last
            : null
  return next === null ? null : (INSTALL_TARGETS[next] ?? null)
}

/**
 * DESIGN.md §5 InstallTabs: one CommandBar per shell under a tab row. Until the visitor picks a
 * tab, CSS shows the target the <head> detect script put on <html>; the tab they pick becomes
 * `data-show`. ARIA follows the same detection once hydrated.
 */
export function InstallTabs({ className }: { readonly className?: string }): JSX.Element {
  const t = useTranslations("landing.install")
  const baseId = useId()
  const tabRefs = useRef<Partial<Record<InstallTarget, HTMLButtonElement | null>>>({})
  const detected = useSyncExternalStore(subscribeNever, readDetectedTarget, serverTarget)
  const [chosen, setChosen] = useState<InstallTarget | null>(null)
  const selected = chosen ?? detected

  function select(target: InstallTarget, focus: boolean): void {
    setChosen(target)
    if (focus) tabRefs.current[target]?.focus()
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const target = nextTarget(selected, event.key)
    if (target === null) return
    event.preventDefault()
    select(target, true)
  }

  return (
    <div data-install-tabs="" data-show={chosen ?? undefined} className={cn("w-full", className)}>
      <noscript dangerouslySetInnerHTML={{ __html: NOSCRIPT_STYLE }} />
      <div
        role="tablist"
        aria-label={t("tabsLabel")}
        onKeyDown={onKeyDown}
        className="border-line flex border-b"
      >
        {INSTALL_TARGETS.map((target) => (
          <button
            key={target}
            ref={(node) => {
              tabRefs.current[target] = node
            }}
            type="button"
            role="tab"
            id={`${baseId}-tab-${target}`}
            data-tab={target}
            aria-selected={selected === target}
            aria-controls={`${baseId}-panel-${target}`}
            tabIndex={selected === target ? 0 : -1}
            onClick={() => select(target, false)}
            className="install-tab eyebrow focus-visible:outline-accent-32 min-h-11 px-2.5 focus-visible:outline-2 focus-visible:-outline-offset-2 sm:px-3"
          >
            {target === "unix" ? null : <span className="max-sm:hidden">{t("windows")} </span>}
            {t(`tabs.${target}`)}
          </button>
        ))}
      </div>
      {INSTALL_TARGETS.map((target) => (
        <div
          key={target}
          role="tabpanel"
          id={`${baseId}-panel-${target}`}
          aria-labelledby={`${baseId}-tab-${target}`}
          data-panel={target}
        >
          <p data-panel-label="" className="eyebrow mt-4 mb-2">
            {target === "unix" ? null : `${t("windows")} `}
            {t(`tabs.${target}`)}
          </p>
          <CommandBar
            command={INSTALL_COMMANDS[target]}
            prompt={INSTALL_PROMPTS[target]}
            className="border-t-0"
          />
        </div>
      ))}
      <p className="install-caption text-text-lo mt-3 text-sm leading-[1.5]">
        <span data-caption="next">{t("next")}</span>
        <span data-caption="computer">{t("onComputer")}</span>
      </p>
    </div>
  )
}
