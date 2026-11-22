import type { ThreadInterruptBackground, ThreadInterruptBackgroundJob } from "../contracts"

export type InterruptRequest = { readonly turnId?: string; readonly background: "stop" }

export type InterruptOutcome = {
  readonly interrupted: boolean
  readonly turn_id?: string
  readonly background: ThreadInterruptBackground
}

type Reply = Readonly<Record<string, unknown>>

const isObject = (value: unknown): value is Reply =>
  typeof value === "object" && value !== null && !Array.isArray(value)

function jobOf(entry: unknown): ThreadInterruptBackgroundJob | undefined {
  if (!isObject(entry)) return undefined
  const { kind, id, description } = entry
  if (typeof kind !== "string" || typeof id !== "string") return undefined
  return { kind, id, ...(typeof description === "string" ? { description } : {}) }
}

const entriesOf = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : [])

function backgroundOf(value: unknown): ThreadInterruptBackground {
  if (!isObject(value)) return { status: "not_supported" }
  return {
    status: "stopped",
    stopped: entriesOf(value["stopped"]).flatMap((entry) => jobOf(entry) ?? []),
    failed: entriesOf(value["failed"]).flatMap((entry) => {
      const job = jobOf(entry)
      if (job === undefined || !isObject(entry)) return []
      const reason = entry["reason"]
      return [{ ...job, reason: typeof reason === "string" ? reason : "unknown" }]
    }),
  }
}

/**
 * The one interrupt body of every leg: this device's endpoint and another device's engine get the same record and
 * their answers are read by the same rule. An engine that predates the background stop answers no `background`, which
 * reads as `not_supported`: its turn stopped, and whatever that turn left running in the background was not touched.
 */
export async function interruptOver(
  send: (request: InterruptRequest) => Promise<Reply>,
  turnId: string | undefined,
): Promise<InterruptOutcome> {
  const reply = await send({ ...(turnId === undefined ? {} : { turnId }), background: "stop" })
  const reported = reply["turnId"]
  return {
    interrupted: reply["interrupted"] === true,
    ...(typeof reported === "string" ? { turn_id: reported } : {}),
    background: backgroundOf(reply["background"]),
  }
}
