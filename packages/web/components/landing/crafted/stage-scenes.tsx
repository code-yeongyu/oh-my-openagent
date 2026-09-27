import type { JSX, ReactNode } from "react"
import { Check, RotateCw } from "lucide-react"

import type { StageStateId } from "./stage-states"

export interface StageLabels {
  readonly roundTrip: string
  readonly oneStep: string
  readonly repaired: string
  readonly splits: string
  readonly parallel: string
  readonly waiting: string
  readonly woke: string
  readonly goalProgress: string
  readonly resumes: string
  readonly saved: string
  readonly reloaded: string
  readonly stageLabel: string
}

type Tone = "hi" | "mid" | "lo" | "accent"

const TONE: Record<Tone, string> = {
  hi: "text-text-hi",
  mid: "text-text-mid",
  lo: "text-text-lo",
  accent: "text-accent",
}

function Line({ children, tone = "mid" }: { children: ReactNode; tone?: Tone }): JSX.Element {
  return (
    <p
      className={`${TONE[tone]} flex items-center gap-1.5 font-mono text-xs leading-[1.75] whitespace-pre sm:text-sm`}
    >
      {children}
    </p>
  )
}

function LiveLine({
  live,
  idle,
  done,
}: {
  live: boolean
  idle: string
  done: string
}): JSX.Element {
  return (
    <p
      className={`${live ? "text-accent" : "text-text-lo"} mt-2 font-mono text-xs transition-colors duration-[var(--dur-micro)] sm:text-sm`}
    >
      {live ? done : idle}
    </p>
  )
}

function scene(id: StageStateId, live: boolean, labels: StageLabels): JSX.Element {
  switch (id) {
    case "code-mode":
      return (
        <div>
          <Line tone="lo">{`// ${labels.roundTrip}`}</Line>
          <Line tone="hi">{"await parallel(["}</Line>
          <Line>{'  () => read("src/app.ts"),'}</Line>
          <Line>{'  () => grep("TODO"),'}</Line>
          <Line>{'  () => lsp.refs("Session"),'}</Line>
          <Line tone="hi">{"])"}</Line>
        </div>
      )
    case "absorption":
      return (
        <div className="flex flex-col items-center text-center">
          <Line tone="lo">read × 12</Line>
          <Line tone="lo">grep × 6</Line>
          <Line tone="lo">find × 3</Line>
          <span className="bg-line-strong my-2 h-px w-8" />
          <Line tone="hi">{labels.oneStep}</Line>
          <Line tone="accent">21 → 1</Line>
        </div>
      )
    case "correction":
      return (
        <div>
          <Line tone="lo">{'edit({ path: "src/app.ts",'}</Line>
          <Line tone="lo">
            <span className="text-text-faint line-through">oldTxt</span>→
            <span className="text-accent">oldText</span>
          </Line>
          <Line tone="hi">{labels.repaired}</Line>
        </div>
      )
    case "team":
      return (
        <div className="grid grid-cols-[auto_1fr] gap-x-3">
          {["lead", "explore", "librarian", "deep", "visual"].map((member, index) => (
            <p key={member} className="contents font-mono text-xs leading-[1.75] sm:text-sm">
              <span className={index === 0 ? "text-accent" : "text-text-hi"}>{member}</span>
              <span className="text-text-lo whitespace-nowrap">
                {index === 0 ? labels.splits : labels.parallel}
              </span>
            </p>
          ))}
        </div>
      )
    case "monitor":
      return (
        <div className="text-center">
          <Line tone="lo">watch: bun run build</Line>
          <LiveLine live={live} idle={labels.waiting} done={`BUILD_OK → ${labels.woke}`} />
        </div>
      )
    case "goal":
      return (
        <div>
          <Line tone="lo">{labels.goalProgress}</Line>
          {["tests", "375px", "lighthouse 100"].map((item) => (
            <Line key={item} tone="hi">
              <Check className="text-status-ok size-3" aria-hidden="true" />
              {item}
            </Line>
          ))}
          <Line tone="accent">
            <RotateCw className="size-3" aria-hidden="true" />
            {labels.resumes}
          </Line>
        </div>
      )
    case "reload":
      return (
        <div className="text-center">
          <Line tone="lo">~/.omo/omo.jsonc</Line>
          <LiveLine live={live} idle={labels.saved} done={labels.reloaded} />
        </div>
      )
  }
}

export function StageScene({
  id,
  live,
  labels,
}: {
  id: StageStateId
  live: boolean
  labels: StageLabels
}): JSX.Element {
  return scene(id, live, labels)
}
