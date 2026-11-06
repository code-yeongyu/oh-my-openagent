import type { JSX } from "react"

/** Lucide-geometry icons drawn inline (24 grid, 1.75 stroke), so the home page loads no icon package. */
const PATHS = {
  monitor: "M3 4h18v12H3zM8 20h8M12 16v4",
  sun: "M12 3v2M12 19v2M5 5l1.4 1.4M17.6 17.6 19 19M3 12h2M19 12h2M5 19l1.4-1.4M17.6 6.4 19 5M8 12a4 4 0 1 0 8 0 4 4 0 1 0-8 0",
  moon: "M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z",
  arrow: "M5 12h14M13 6l6 6-6 6",
  github:
    "M9 19c-4.3 1.4-4.3-2.5-6-3m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12.3 12.3 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21",
  copy: "M8 8h12v12H8zM4 16V4h12",
  check: "M5 12l5 5L20 7",
  terminal: "M4 17l6-5-6-5M12 19h8",
  window: "M3 4h18v16H3zM3 9h18",
  chat: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
} as const

export type IconName = keyof typeof PATHS

export function Icon({
  name,
  className,
}: {
  readonly name: IconName
  readonly className?: string
}): JSX.Element {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  )
}
