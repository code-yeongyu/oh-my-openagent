export const MAX_CONCURRENT_JUDGES = 2

const JUDGE_SLOTS_KEY = Symbol.for("omo.memorian.judgeSlots")

type JudgeSlots = { held: number }

function sharedJudgeSlots(): JudgeSlots {
  const existing = Reflect.get(globalThis, JUDGE_SLOTS_KEY)
  if (isJudgeSlots(existing)) return existing
  const created: JudgeSlots = { held: 0 }
  Reflect.set(globalThis, JUDGE_SLOTS_KEY, created)
  return created
}

function isJudgeSlots(value: unknown): value is JudgeSlots {
  if (typeof value !== "object" || value === null) return false
  if (!("held" in value)) return false
  const held = Reflect.get(value, "held")
  return typeof held === "number" && held >= 0
}

export function tryAcquireJudgeSlot(cap = MAX_CONCURRENT_JUDGES): (() => void) | undefined {
  const slots = sharedJudgeSlots()
  if (cap <= 0 || slots.held >= cap) return undefined
  slots.held += 1
  let released = false
  return () => {
    if (released) return
    released = true
    slots.held = Math.max(0, slots.held - 1)
  }
}

export function judgeSlotsHeld(): number {
  return sharedJudgeSlots().held
}
