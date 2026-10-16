"use client"

import type { JSX } from "react"
import { useCallback, useState } from "react"

import { MorphStage } from "./morph-stage"
import type { StageLabels } from "./stage-scenes"

export interface CraftedItem {
  readonly name: string
  readonly desc: string
}

export interface CraftedShowcaseProps {
  readonly items: readonly CraftedItem[]
  readonly labels: StageLabels
}

export function CraftedShowcase({ items, labels }: CraftedShowcaseProps): JSX.Element {
  const [active, setActive] = useState(0)
  const [userSelections, setUserSelections] = useState(0)

  const select = useCallback((index: number) => {
    setActive(index)
    setUserSelections((count) => count + 1)
  }, [])

  return (
    <div className="grid gap-6 lg:grid-cols-7 lg:gap-6">
      <MorphStage
        active={active}
        onAdvance={setActive}
        userSelections={userSelections}
        labels={labels}
        className="lg:sticky lg:top-28 lg:col-span-4 lg:self-start"
      />
      <ol className="divide-line divide-y lg:col-span-3" data-testid="crafted-list">
        {items.map((item, index) => (
          <li key={item.name}>
            <button
              type="button"
              aria-current={index === active ? "true" : undefined}
              aria-controls="crafted-stage"
              data-crafted-index={index}
              onClick={() => select(index)}
              onPointerEnter={(event) => {
                if (event.pointerType === "mouse") select(index)
              }}
              onFocus={() => select(index)}
              className="crafted-item focus-visible:outline-accent-32 w-full py-4 text-left focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              <span aria-hidden="true" className="crafted-item-wash" />
              <span className="relative flex items-center gap-3">
                <span aria-hidden="true" className="crafted-item-dot shrink-0" />
                <span className="text-text-hi text-base font-medium">{item.name}</span>
              </span>
              <span className="text-text-mid prose-cjk relative mt-1.5 block pl-[18px] text-sm leading-[1.6]">
                {item.desc}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  )
}
