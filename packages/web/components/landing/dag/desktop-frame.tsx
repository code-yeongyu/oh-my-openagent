"use client"

import type { JSX, ReactNode } from "react"

import { Chip } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

import { currentWaveLabel, feedAt, runSummary } from "./scenario"
import { USER_COMMAND } from "./scenario-data"
import { dagStatus } from "./status"
import type { DagRun } from "./types"

export interface DesktopFrameLabels {
  readonly windowTitle: string
  readonly threads: string
  readonly threadRows: readonly string[]
  readonly workflow: string
  readonly runStatus: Record<DagRun["status"], string>
  readonly assistantPlanning: string
  readonly assistantRunning: string
  readonly assistantDone: string
}

export interface DesktopFrameProps {
  readonly run: DagRun
  readonly clockMs: number
  readonly motionOK: boolean
  readonly labels: DesktopFrameLabels
  readonly children: ReactNode
}

const TYPE_MS_PER_CHAR = 30

function RunStatusChip({
  status,
  label,
}: {
  readonly status: DagRun["status"]
  readonly label: string
}): JSX.Element {
  return (
    <Chip variant={status === "running" ? "accent" : "default"} data-dag-run-status={status}>
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 rounded-full",
          status === "running"
            ? "bg-accent pulse-dot"
            : status === "completed"
              ? "bg-status-ok"
              : "bg-text-lo",
        )}
      />
      {label}
    </Chip>
  )
}

/**
 * The omo desktop app, drawn in ledger tokens: title bar, thread sidebar (≥ md), the chat
 * turn that typed `mass ulw …`, and the workflow panel open on the run — header, graph
 * viewport (children) and the activity feed floating over its bottom edge, as in the app.
 */
export function DesktopFrame({
  run,
  clockMs,
  motionOK,
  labels,
  children,
}: DesktopFrameProps): JSX.Element {
  const typedCount = motionOK
    ? Math.min(USER_COMMAND.length, Math.floor(clockMs / TYPE_MS_PER_CHAR))
    : USER_COMMAND.length
  const typing = motionOK && typedCount < USER_COMMAND.length
  const assistantLine =
    run.status === "completed"
      ? labels.assistantDone
      : run.status === "running"
        ? `${labels.assistantRunning} ${currentWaveLabel(run)}`
        : typing
          ? null
          : labels.assistantPlanning
  const feed = feedAt(clockMs)

  return (
    <div className="border-line bg-ink-1 grid min-w-0 grid-rows-[auto_1fr] overflow-hidden border">
      <div className="bg-ink-2 border-line flex h-9 min-w-0 items-center gap-2 border-b px-3">
        <span aria-hidden="true" className="flex gap-1.5">
          <span className="bg-text-faint size-2 rounded-full" />
          <span className="bg-text-faint size-2 rounded-full" />
          <span className="bg-text-faint size-2 rounded-full" />
        </span>
        <span className="text-text-lo text-meta tracking-meta ml-2 min-w-0 flex-1 truncate font-mono">
          {labels.windowTitle}
        </span>
        <Chip variant="accent">{labels.workflow}</Chip>
      </div>
      <div className="grid min-h-0 min-w-0 md:grid-cols-[11rem_1fr]">
        <aside className="border-line hidden min-h-0 flex-col border-r md:flex">
          <p className="eyebrow px-3 pt-3 pb-2">{labels.threads}</p>
          <ul className="space-y-px px-1.5">
            {labels.threadRows.map((row, index) => (
              <li
                key={row}
                className={cn(
                  "text-text-mid flex items-center gap-2 px-2 py-1.5 text-xs",
                  index === 0 && "bg-ink-2 text-text-hi",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    index === 0
                      ? dagStatus(run.status === "completed" ? "completed" : "running").dotClass
                      : "bg-status-ok",
                  )}
                />
                <span className="truncate">{row}</span>
              </li>
            ))}
          </ul>
        </aside>
        <div className="grid min-h-0 min-w-0 grid-rows-[auto_auto_1fr]">
          <div className="border-line min-w-0 border-b px-4 py-3">
            <div className="flex justify-end">
              <p
                data-dag-user-turn
                className="bg-ink-3 text-text-hi max-w-[85%] px-3 py-1.5 font-mono text-[13px] leading-[1.5]"
              >
                {USER_COMMAND.slice(0, typedCount)}
                {typing ? (
                  <span
                    aria-hidden="true"
                    className="bg-accent cursor-blink ml-px inline-block h-[1em] w-[0.55em] translate-y-[0.15em]"
                  />
                ) : null}
              </p>
            </div>
            <p className="text-text-lo mt-2 min-h-4 text-xs" aria-live="polite">
              {assistantLine === null ? "" : `orchestrator · ${assistantLine}`}
            </p>
          </div>
          <div className="border-line flex min-w-0 items-center gap-2 border-b px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="text-text-hi truncate text-sm font-medium">{run.name}</p>
              <p data-dag-run-summary className="text-text-lo truncate font-mono text-xs">
                {currentWaveLabel(run)} · {runSummary(run)}
              </p>
            </div>
            <RunStatusChip status={run.status} label={labels.runStatus[run.status]} />
          </div>
          <div className="relative h-[20rem] min-h-0 min-w-0 md:h-[23rem]">
            <div className="absolute inset-0">{children}</div>
            {feed.length === 0 ? null : (
              <ol
                data-dag-feed
                className="border-line dag-feed pointer-events-none absolute inset-x-0 bottom-0 space-y-0.5 border-t px-3 py-2 font-mono text-[11px] leading-[1.5]"
              >
                {feed.map((line) => (
                  <li key={line.key} className="flex min-w-0 items-center gap-2">
                    <span
                      aria-hidden="true"
                      className={cn(
                        "size-1.5 shrink-0 rounded-full",
                        dagStatus(line.state).dotClass,
                      )}
                    />
                    <span className="text-text-lo min-w-0 truncate">{line.text}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
