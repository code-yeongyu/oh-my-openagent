export type TaskId = `st_${string}`

const TASK_ID_PATTERN = /^st_[0-9a-f]{8}$/
const TIME_MODULUS = 0x1000000
const MAX_SEQUENCE = 0xff

let lastTimePart = -1
let lastSequence = -1

export function createTaskId(nowMs = Date.now()): TaskId {
  let timePart = normalizedTimePart(nowMs)
  if (timePart < lastTimePart) timePart = lastTimePart

  if (timePart === lastTimePart) {
    if (lastSequence === MAX_SEQUENCE) {
      timePart = (lastTimePart + 1) % TIME_MODULUS
      lastSequence = 0
    } else {
      lastSequence += 1
    }
  } else {
    lastSequence = 0
  }

  lastTimePart = timePart
  const id = `st_${timePart.toString(16).padStart(6, "0")}${lastSequence.toString(16).padStart(2, "0")}`
  return parseTaskId(id)
}

export function parseTaskId(value: string): TaskId {
  if (!isTaskId(value)) throw new Error("Invalid task id; expected st_[0-9a-f]{8}")
  return value
}

function isTaskId(value: string): value is TaskId {
  return TASK_ID_PATTERN.test(value)
}

function normalizedTimePart(nowMs: number): number {
  const integerMs = Math.floor(nowMs)
  return ((integerMs % TIME_MODULUS) + TIME_MODULUS) % TIME_MODULUS
}
