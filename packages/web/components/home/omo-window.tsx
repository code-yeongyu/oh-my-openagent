"use client"

import type { JSX } from "react"
import { useCallback, useRef } from "react"

import {
  RUN_BOOT,
  RUN_PROMPT,
  RUN_TOTAL,
  RUN_WAVES,
  type RunNode,
} from "@/components/home/run-data"
import { sleep, useVisibleLoop } from "@/components/home/use-visible-loop"

export interface OmoWindowLabels {
  readonly label: string
  readonly title: string
  readonly meta: string
  readonly workflow: string
  readonly progress: string
  readonly wave: string
  readonly pending: string
  readonly running: string
  readonly completed: string
  readonly blocked: string
  readonly footChecked: string
  readonly footBlocked: string
  readonly footSource: string
}

type State = "pending" | "running" | "done" | "blocked"
const STATES: readonly State[] = ["pending", "running", "done", "blocked"]
const settled = (node: RunNode): State =>
  node.kind === "blocked" ? "blocked" : node.kind === "last" ? "running" : "done"

/**
 * The hero's terminal: OmO boots, takes the mass ulw prompt and runs the demo workflow wave by wave. Nodes in a wave
 * start 140 ms apart and finish in reverse order, as parallel agents do. State changes are opacity cross-fades; the
 * server renders the finished run, which is also the reduced-motion frame. Counters are written to the DOM directly
 * so the loop never re-renders React.
 */
export function OmoWindow({ labels }: { readonly labels: OmoWindowLabels }): JSX.Element {
  const root = useRef<HTMLElement>(null)

  const nodes = (): HTMLElement[] => [
    ...(root.current?.querySelectorAll<HTMLElement>("[data-node]") ?? []),
  ]
  const count = useCallback((): void => {
    const el = root.current
    if (!el) return
    let total = 0
    for (const wave of el.querySelectorAll<HTMLElement>("[data-wave]")) {
      const done = wave.querySelectorAll('[data-state="done"]').length
      const counter = wave.querySelector("[data-done]")
      if (counter) counter.textContent = String(done)
      total += done
    }
    const progress = el.querySelector("[data-progress]")
    if (progress) progress.textContent = String(total)
  }, [])
  const finish = (node: HTMLElement): void => {
    node.dataset.state = node.dataset.kind === "blocked" ? "blocked" : "done"
  }

  const settle = useCallback((): void => {
    const el = root.current
    if (!el) return
    el.dataset.step = "3"
    for (const node of nodes())
      node.dataset.state =
        node.dataset.kind === "last"
          ? "running"
          : node.dataset.kind === "blocked"
            ? "blocked"
            : "done"
    count()
  }, [count])

  const scene = useCallback(
    async (signal: AbortSignal): Promise<void> => {
      const el = root.current
      if (!el) return
      el.dataset.step = "0"
      for (const node of nodes()) node.dataset.state = "pending"
      count()
      for (const [step, wait] of [
        [1, 500],
        [2, 700],
        [3, 900],
      ] as const) {
        await sleep(wait, signal)
        el.dataset.step = String(step)
      }
      await sleep(600, signal)
      for (const wave of el.querySelectorAll<HTMLElement>("[data-wave]")) {
        const members = [...wave.querySelectorAll<HTMLElement>("[data-node]")]
        for (const node of members) {
          node.dataset.state = "running"
          await sleep(140, signal)
        }
        if (members.every((node) => node.dataset.kind === "last")) continue
        await sleep(1100, signal)
        for (const node of members.toReversed()) {
          finish(node)
          count()
          await sleep(220, signal)
        }
        await sleep(260, signal)
      }
      await sleep(3200, signal)
    },
    [count],
  )

  useVisibleLoop(root, scene, settle)

  const [before, after] = labels.progress.split("{done}")
  const stateLabel: Readonly<Record<State, string>> = {
    pending: labels.pending,
    running: labels.running,
    done: labels.completed,
    blocked: labels.blocked,
  }
  const doneCount = RUN_WAVES.flat().filter((node) => settled(node) === "done").length

  return (
    <figure ref={root} className="frame omowin" data-step="3" aria-label={labels.label}>
      <div className="frame__bar">
        <span className="frame__dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="frame__title">{labels.title}</span>
        <span className="frame__meta">{labels.meta}</span>
      </div>
      <div className="omowin__body">
        <p className="oline">
          <span className="p">~/research $</span> omo
        </p>
        <p className="oline o-dim" data-o="boot">
          {RUN_BOOT}
        </p>
        <p className="oline o-prompt" data-o="prompt">
          <span className="p">›</span> {RUN_PROMPT}
        </p>
        <div className="oflow" data-o="flow">
          <p className="oflow__head">
            <span>{labels.workflow}</span>
            <span className="oflow__progress">
              {before}
              <span data-progress>{doneCount}</span>
              {after?.replace("/10", `/${RUN_TOTAL}`)}
            </span>
          </p>
          <ol className="oflow__waves">
            {RUN_WAVES.map((wave, index) => (
              <li className="owave" data-wave key={wave[0]?.id ?? index}>
                <p className="owave__head">
                  {labels.wave.replace("{n}", String(index + 1))}{" "}
                  <span className="owave__count">
                    <span data-done>{wave.filter((node) => settled(node) === "done").length}</span>/
                    {wave.length}
                  </span>
                </p>
                <ul>
                  {wave.map((node) => (
                    <li
                      className="onode"
                      data-node
                      data-kind={node.kind}
                      data-state={settled(node)}
                      key={node.id}
                    >
                      <span className="onode__dot" aria-hidden="true">
                        {STATES.map((state) => (
                          <i key={state} className={`s-${state}`} />
                        ))}
                      </span>
                      <span className="onode__name">{node.id}</span>
                      <span className="onode__state">
                        {STATES.map((state) => (
                          <i key={state} className={`s-${state}`}>
                            {stateLabel[state]}
                          </i>
                        ))}
                      </span>
                      <span className="onode__meta">{node.meta}</span>
                      {node.result ? <span className="onode__result">{node.result}</span> : null}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </div>
      </div>
      <figcaption className="omowin__foot">
        <span>
          <i className="dot-ok" />
          {labels.footChecked}
        </span>
        <span>
          <i className="dot-wait" />
          {labels.footBlocked}
        </span>
        <span className="omowin__src">{labels.footSource}</span>
      </figcaption>
    </figure>
  )
}
