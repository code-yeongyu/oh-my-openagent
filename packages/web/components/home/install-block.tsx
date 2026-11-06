"use client"

import type { JSX, KeyboardEvent } from "react"
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react"

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
  readonly windows: string
  readonly unix: string
  readonly powershell: string
  readonly cmd: string
  readonly next: string
  readonly onComputer: string
  readonly copy: string
  readonly copied: string
  readonly copyAria: string
  readonly copiedStatus: string
}

const NOSCRIPT_STYLE =
  "<style>[data-install-tabs] [role=tablist],[data-install-tabs] .copy,[data-install-tabs] [data-caption]{display:none}[data-install-tabs] [data-panel],[data-install-tabs] [data-panel-label]{display:block}</style>"

const subscribeNever = (): (() => void) => () => undefined
const readDetected = (): InstallTarget => detectInstallFromNavigator(navigator).target
const serverTarget = (): InstallTarget => "unix"

function step(current: InstallTarget, key: string): InstallTarget | null {
  const i = INSTALL_TARGETS.indexOf(current)
  const last = INSTALL_TARGETS.length - 1
  const next =
    key === "ArrowRight"
      ? (i + 1) % INSTALL_TARGETS.length
      : key === "ArrowLeft"
        ? (i + last) % INSTALL_TARGETS.length
        : key === "Home"
          ? 0
          : key === "End"
            ? last
            : null
  return next === null ? null : (INSTALL_TARGETS[next] ?? null)
}

/**
 * doriterm's code block with a tab per shell. Until the visitor picks a tab, CSS shows the target the <head> detect
 * script put on <html> (so the first paint is right before hydration); without JavaScript every command is listed.
 */
export function InstallBlock({ labels }: { readonly labels: InstallLabels }): JSX.Element {
  const baseId = useId()
  const detected = useSyncExternalStore(subscribeNever, readDetected, serverTarget)
  const [chosen, setChosen] = useState<InstallTarget | null>(null)
  const [copied, setCopied] = useState(false)
  const tabs = useRef<Partial<Record<InstallTarget, HTMLButtonElement | null>>>({})
  const target = chosen ?? detected
  const name = (id: InstallTarget): string =>
    id === "unix" ? labels.unix : `${labels.windows} ${labels[id]}`

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1600)
    return () => clearTimeout(timer)
  }, [copied])

  function onKey(event: KeyboardEvent<HTMLDivElement>): void {
    const next = step(target, event.key)
    if (next === null) return
    event.preventDefault()
    setChosen(next)
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
    <div className="code install" id="install" data-install-tabs="" data-show={chosen ?? undefined}>
      <noscript dangerouslySetInnerHTML={{ __html: NOSCRIPT_STYLE }} />
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
              id={`${baseId}-tab-${id}`}
              data-tab={id}
              aria-selected={target === id}
              aria-controls={`${baseId}-panel-${id}`}
              tabIndex={target === id ? 0 : -1}
              onClick={() => setChosen(id)}
            >
              {id === "unix" ? null : <span className="install__windows">{labels.windows} </span>}
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
      {INSTALL_TARGETS.map((id) => (
        <div
          key={id}
          role="tabpanel"
          id={`${baseId}-panel-${id}`}
          aria-labelledby={`${baseId}-tab-${id}`}
          data-panel={id}
        >
          <p className="install__panel-label" data-panel-label="">
            {name(id)}
          </p>
          <pre>
            <code>
              <span className="dim">{INSTALL_PROMPTS[id]} </span>
              <span>{INSTALL_COMMANDS[id]}</span>
            </code>
          </pre>
        </div>
      ))}
      <p className="install__caption">
        <span data-caption="next">{labels.next}</span>
        <span data-caption="computer">{labels.onComputer}</span>
      </p>
      <p className="visually-hidden" role="status">
        {copied ? labels.copiedStatus : ""}
      </p>
    </div>
  )
}
