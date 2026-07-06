import { randomBytes } from "node:crypto"

const MAX_HEX = 0xffffffff

export function createTaskId(nowMs = Date.now()): string {
  const timestampPart = Math.floor(nowMs % MAX_HEX)
    .toString(16)
    .padStart(6, "0")
    .slice(-6)
  const randomPart = randomBytes(1).toString("hex")
  return `st_${timestampPart}${randomPart}`
}
