export type TaskId = `st_${string}`

const TASK_ID_PATTERN = /^st_[0-9a-f]{8}$/
const UUIDV7_TIMESTAMP_HIGH_BITS_DIVISOR = 0x10000
const TASK_ID_SPACE_SIZE = 0x1_0000_0000
const MAX_TASK_ID_VALUE = 0xffff_ffff

let lastTaskIdValue: number | undefined

export function createTaskId(nowMs = Date.now()): TaskId {
  const nextValue = nextMonotonicValue(uuidV7TimestampHighBits(nowMs), lastTaskIdValue)
  lastTaskIdValue = nextValue
  return formatTaskId(nextValue)
}

export function createTaskIdFactory(clock: () => number = Date.now): () => TaskId {
  let lastValue: number | undefined
  return () => {
    const nextValue = nextMonotonicValue(uuidV7TimestampHighBits(clock()), lastValue)
    lastValue = nextValue
    return formatTaskId(nextValue)
  }
}

export function bumpTaskId(id: TaskId): TaskId {
  const value = Number.parseInt(id.slice(3), 16)
  if (value >= MAX_TASK_ID_VALUE) throw new TaskIdSpaceExhaustedError()
  return formatTaskId(value + 1)
}

export function syncTaskIdFloor(id: TaskId): void {
  const value = Number.parseInt(id.slice(3), 16)
  lastTaskIdValue = Math.max(lastTaskIdValue ?? -1, value)
}

export function parseTaskId(value: string): TaskId {
  if (!isTaskId(value)) throw new Error("Invalid task id; expected st_[0-9a-f]{8}")
  return value
}

function isTaskId(value: string): value is TaskId {
  return TASK_ID_PATTERN.test(value)
}

function uuidV7TimestampHighBits(nowMs: number): number {
  const integerMs = Number.isFinite(nowMs) ? Math.max(0, Math.floor(nowMs)) : 0
  // Eight hex chars cannot hold full uuidv7 time plus randomness; keep the sortable timestamp prefix.
  return Math.floor(integerMs / UUIDV7_TIMESTAMP_HIGH_BITS_DIVISOR) % TASK_ID_SPACE_SIZE
}

function nextMonotonicValue(candidate: number, previous: number | undefined): number {
  if (previous === undefined || candidate > previous) return candidate
  if (previous >= MAX_TASK_ID_VALUE) throw new TaskIdSpaceExhaustedError()
  return previous + 1
}

function formatTaskId(value: number): TaskId {
  return parseTaskId(`st_${value.toString(16).padStart(8, "0")}`)
}

export class TaskIdSpaceExhaustedError extends Error {
  constructor() {
    super("Task id space exhausted for this process; restart before creating more task ids")
    this.name = "TaskIdSpaceExhaustedError"
  }
}
