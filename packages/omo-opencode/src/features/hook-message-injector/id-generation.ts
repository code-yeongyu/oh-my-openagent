import { randomBytes } from "node:crypto"

const processPrefix = randomBytes(4).toString("hex")
let messageCounter = 0
let partCounter = 0

export function generateMessageId(): string {
  return `msg_${processPrefix}_${String(++messageCounter).padStart(6, "0")}`
}

export function generatePartId(): string {
  return `prt_${processPrefix}_${String(++partCounter).padStart(6, "0")}`
}
