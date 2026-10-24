import { KNOWN_MODELS, KNOWN_PROVIDERS } from "./model-vocabulary"
import { ENDED_BY, MODEL_SLOTS, MODEL_SLOT_NUMBER_KEYS, SUMMARY_NUMBER_KEYS } from "./session-summary-window"
import { TELEMETRY_SESSION_ROLES } from "./session-role"

const BOOLEAN_PROPERTY = Object.freeze({ type: "boolean" } as const)
const NUMBER_PROPERTY = Object.freeze({ type: "number" } as const)
const STRING_PROPERTY = Object.freeze({ type: "string" } as const)

type SummaryPropertySchema = Readonly<{ type: "string" | "number" | "boolean"; values?: readonly string[] }>

function enumProperty(values: readonly string[]): SummaryPropertySchema {
  return Object.freeze({ type: "string", values: Object.freeze([...values]) })
}

const MODEL_VALUES = enumProperty([...new Set(Object.values(KNOWN_MODELS).flat()), "custom", "none"])
const PROVIDER_VALUES = enumProperty([...KNOWN_PROVIDERS, "custom", "none"])

function buildSchema(): Readonly<Record<string, SummaryPropertySchema>> {
  const schema: Record<string, SummaryPropertySchema> = {
    "$session_id": STRING_PROPERTY,
    ended_by: enumProperty(ENDED_BY),
    is_final: BOOLEAN_PROPERTY,
    raw_turns_sampled: BOOLEAN_PROPERTY,
    session_role: enumProperty(TELEMETRY_SESSION_ROLES),
    summary_epoch: STRING_PROPERTY,
  }
  for (const key of SUMMARY_NUMBER_KEYS) schema[key] = NUMBER_PROPERTY
  for (let slot = 1; slot <= MODEL_SLOTS; slot += 1) {
    schema[`m${slot}_provider`] = PROVIDER_VALUES
    schema[`m${slot}_model`] = MODEL_VALUES
    for (const key of MODEL_SLOT_NUMBER_KEYS) schema[`m${slot}_${key}`] = NUMBER_PROPERTY
  }
  return Object.freeze(Object.fromEntries(Object.entries(schema).sort(([left], [right]) => left.localeCompare(right))))
}

/**
 * `session_summary`: the assistant turns of one window, summed. Windows never overlap; a process numbers its
 * windows of a session with `summary_seq` inside a random `summary_epoch` that a reload in the same process
 * keeps and any hand-over to another process (resume, crash recovery) replaces, and (session, `summary_epoch`, `summary_seq`) is unique, so summing every row of a session
 * reproduces its per-turn totals; the percentiles describe only their own window. The event's uuid is the
 * window id, so a re-sent window is deduplicated rather than counted twice. Cost is summed in integer
 * `cost_1e4` units and `cost_usd` is derived from it. Raw `turn_completed` rows ship only for sessions
 * sampled at `sample_rate`, so their counts must be weighted by `1 / sample_rate`. Per-model totals keep
 * the top three models; the rest are folded into `other_*`.
 */
export const SESSION_SUMMARY_SCHEMA = buildSchema()
