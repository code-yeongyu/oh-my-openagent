"use client"

import { Slot } from "@radix-ui/react-slot"
import { useEffect, useId, useState, type JSX, type ReactElement } from "react"

import { cn } from "@/lib/utils"

type TooltipSide = "left" | "top"

// Padding, not margin: the gap between trigger and label belongs to the tooltip, so the pointer can
// cross it without leaving the wrapper (WCAG 1.4.13 hoverable).
const SIDE_CLASS: Record<TooltipSide, string> = {
  left: "top-1/2 right-full pr-2 -translate-y-1/2",
  top: "bottom-full left-1/2 pb-2 -translate-x-1/2",
}

export interface TooltipProps {
  readonly label: string
  readonly side?: TooltipSide
  /** One focusable element; it gains `aria-describedby` pointing at the tooltip. */
  readonly children: ReactElement
}

/**
 * shadcn Tooltip anatomy (trigger + `role="tooltip"` content) without a portal: the label
 * shows on hover and on keyboard focus, stays while the pointer moves onto it, and Escape
 * dismisses it until the pointer or focus leaves (WCAG 1.4.13).
 */
export function Tooltip({ label, side = "left", children }: TooltipProps): JSX.Element {
  const id = useId()
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const open = (hovered || focused) && !dismissed

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setDismissed(true)
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [open])

  const settle = (next: { readonly hovered?: boolean; readonly focused?: boolean }): void => {
    const nextHovered = next.hovered ?? hovered
    const nextFocused = next.focused ?? focused
    if (!nextHovered && !nextFocused) setDismissed(false)
    setHovered(nextHovered)
    setFocused(nextFocused)
  }

  return (
    <span
      className="relative inline-flex"
      onPointerEnter={() => settle({ hovered: true })}
      onPointerLeave={() => settle({ hovered: false })}
    >
      <Slot
        aria-describedby={id}
        onFocus={() => settle({ focused: true })}
        onBlur={() => settle({ focused: false })}
      >
        {children}
      </Slot>
      <span
        id={id}
        role="tooltip"
        data-state={open ? "open" : "closed"}
        hidden={!open}
        className={cn("pointer-events-auto absolute z-20", SIDE_CLASS[side])}
      >
        <span className="border-line bg-ink-3 text-text-hi block border px-2 py-1 font-mono text-xs whitespace-nowrap">
          {label}
        </span>
      </span>
    </span>
  )
}
