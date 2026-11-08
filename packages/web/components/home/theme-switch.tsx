"use client"

import type { JSX } from "react"
import { useState, useSyncExternalStore } from "react"

import { Icon, type IconName } from "@/components/home/icons"
import { syncThemeColor, THEME_STORAGE_KEY } from "@/components/home/theme-init"

type Choice = "system" | "light" | "dark"

const CHOICES: ReadonlyArray<{ readonly id: Choice; readonly icon: IconName }> = [
  { id: "system", icon: "monitor" },
  { id: "light", icon: "sun" },
  { id: "dark", icon: "moon" },
]

function readChoice(): Choice {
  const pinned = document.documentElement.dataset.theme
  return pinned === "light" || pinned === "dark" ? pinned : "system"
}

const subscribeNever = (): (() => void) => () => undefined
const serverChoice = (): Choice => "system"

/** Pins (or unpins) data-theme on <html> and keeps the choice; blocked storage keeps it for this page only. */
function applyTheme(next: Choice): void {
  const root = document.documentElement
  if (next === "system") delete root.dataset.theme
  else root.dataset.theme = next
  syncThemeColor(next === "system" ? null : next)
  try {
    if (next === "system") localStorage.removeItem(THEME_STORAGE_KEY)
    else localStorage.setItem(THEME_STORAGE_KEY, next)
  } catch {
    // storage blocked: the choice lasts for this page only
  }
}

/** System / Light / Dark. A pinned choice sets data-theme on <html> and is kept in localStorage. */
export function ThemeSwitch({
  label,
  labels,
}: {
  readonly label: string
  readonly labels: Readonly<Record<Choice, string>>
}): JSX.Element {
  const initial = useSyncExternalStore(subscribeNever, readChoice, serverChoice)
  const [chosen, setChosen] = useState<Choice | null>(null)
  const choice = chosen ?? initial

  function apply(next: Choice): void {
    setChosen(next)
    applyTheme(next)
  }

  return (
    <div className="theme-switch" role="group" aria-label={label}>
      {CHOICES.map(({ id, icon }) => (
        <button
          key={id}
          type="button"
          aria-pressed={choice === id}
          onClick={() => apply(id)}
          title={labels[id]}
        >
          <Icon name={icon} />
          <span className="visually-hidden">{labels[id]}</span>
        </button>
      ))}
    </div>
  )
}
