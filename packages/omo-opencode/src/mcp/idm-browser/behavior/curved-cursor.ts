import type { Page, ElementHandle } from "playwright-core"
import { createCursor, type GhostCursor, type ClickOptions, type MoveOptions } from "ghost-cursor-playwright-port"

export type HumanCursor = GhostCursor

export type CurvedCursorDefaults = {
  hesitateMsRange?: [number, number]
  waitForClickMsRange?: [number, number]
  paddingPercentage?: number
  overshootThreshold?: number
  moveDelayMsRange?: [number, number]
  performIdleMoves?: boolean
}

export function createCurvedCursor(page: Page, defaults: CurvedCursorDefaults = {}): HumanCursor {
  const {
    hesitateMsRange = [60, 220],
    waitForClickMsRange = [40, 110],
    paddingPercentage = 25,
    overshootThreshold = 500,
    moveDelayMsRange = [80, 240],
    performIdleMoves = false,
  } = defaults

  const click: ClickOptions = {
    hesitate: pickInRange(hesitateMsRange),
    waitForClick: pickInRange(waitForClickMsRange),
    paddingPercentage,
    overshootThreshold,
    moveDelay: pickInRange(moveDelayMsRange),
    randomizeMoveDelay: true,
  }
  const move: MoveOptions = {
    paddingPercentage,
    overshootThreshold,
    moveDelay: pickInRange(moveDelayMsRange),
    randomizeMoveDelay: true,
  }

  return createCursor(
    page as unknown as Parameters<typeof createCursor>[0],
    { x: 0, y: 0 },
    performIdleMoves,
    { click, move },
  )
}

export async function curvedClick(
  cursor: HumanCursor,
  target: string | ElementHandle,
  options?: ClickOptions,
): Promise<void> {
  await cursor.click(target, options)
}

export async function curvedMove(
  cursor: HumanCursor,
  target: string | ElementHandle,
  options?: MoveOptions,
): Promise<void> {
  await cursor.move(target, options)
}

function pickInRange([min, max]: [number, number]): number {
  if (max <= min) return min
  return Math.floor(min + Math.random() * (max - min))
}
