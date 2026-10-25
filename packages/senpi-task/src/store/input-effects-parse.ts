import type { IdentifiedInput } from "../runners/input-effects"
import { isRecord, readOptionalString, readString } from "./scalar-read"

export function parseUncertainInputs(value: unknown): readonly IdentifiedInput[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new Error("uncertain_inputs is not an array")
  return value.map(item => {
    if (!isRecord(item)) throw new Error("uncertain input is not an object")
    const type = readString(item, "type")
    if (type !== "prompt" && type !== "steer" && type !== "follow_up") throw new Error("invalid uncertain input type")
    const behavior = readOptionalString(item, "streamingBehavior")
    if (behavior !== undefined && behavior !== "steer" && behavior !== "followUp") throw new Error("invalid uncertain input behavior")
    return { type, message: readString(item, "message"), clientMessageId: readString(item, "clientMessageId"),
      ...(behavior === undefined ? {} : { streamingBehavior: behavior }) }
  })
}
