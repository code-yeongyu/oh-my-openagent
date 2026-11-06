"use client"

import type { JSX, KeyboardEvent } from "react"
import { useEffect, useRef, useState, useSyncExternalStore } from "react"

import { Icon } from "@/components/home/icons"
import {
  detectInstallFromNavigator,
  INSTALL_COMMANDS,
  INSTALL_PROMPTS,
  INSTALL_TARGETS,
  type InstallTarget,
} from "@/lib/install-targets"

export interface InstallLabels {
  readonly label: string
  readonly unix: string
  readonly powershell: string
  readonly cmd: string
  readonly copy: string
  readonly copied: string
  readonly copyAria: string
  readonly copiedStatus: string
}

const subscribeNever = (): (() => void) => () => undefined
const readDetected = (): InstallTarget => detectInstallFromNavigator(navigator).target
const serverTarget = (): InstallTarget => "unix"

/** doriterm's code block: a tab per shell in the bar, the command in the terminal face, Copy -> Copied (1.6 s). */
export function InstallBlock({ labels }: { readonly labels: InstallLabels }): JSX.Element {
  const detected = useSyncExternalStore(subscribeNever, readDetected, serverTarget)
  const [chosen, setTarget] = useState<InstallTarget | null>(null)
  const target = chosen ?? detected
  const [copied, setCopied] = useState(false)
  const tabs = useRef<Partial<Record<InstallTarget, HTMLButtonElement | null>>>({})
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1600)
    return () => clearTimeout(timer)
  }, [copied])

  function onKey(event: KeyboardEvent<HTMLDivElement>): void {
    const i = INSTALL_TARGETS.indexOf(target)
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0
    if (!step) return
    event.preventDefault()
    const next =
      INSTALL_TARGETS[(i + step + INSTALL_TARGETS.length) % INSTALL_TARGETS.length] ?? "unix"
    setTarget(next)
    tabs.current[next]?.focus()
  }

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(INSTALL_COMMANDS[target])
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="code install" id="install">
      <div className="code__head">
        <div role="tablist" aria-label={labels.label} className="install__tabs" onKeyDown={onKey}>
          {INSTALL_TARGETS.map((id) => (
            <button
              key={id}
              ref={(node) => {
                tabs.current[id] = node
              }}
              type="button"
              role="tab"
              aria-selected={target === id}
              tabIndex={target === id ? 0 : -1}
              onClick={() => setTarget(id)}
            >
              {labels[id]}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="copy"
          onClick={() => void copy()}
          aria-label={labels.copyAria}
        >
          <Icon name={copied ? "check" : "copy"} />
          <span className="copy__label">
            <span aria-hidden={copied}>{labels.copy}</span>
            <span aria-hidden={!copied}>{labels.copied}</span>
          </span>
        </button>
      </div>
      <pre role="tabpanel">
        <code>
          <span className="dim">{INSTALL_PROMPTS[target]} </span>
          {INSTALL_COMMANDS[target]}
        </code>
      </pre>
      <p className="visually-hidden" role="status">
        {copied ? labels.copiedStatus : ""}
      </p>
    </div>
  )
}
