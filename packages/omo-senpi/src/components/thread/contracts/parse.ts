import { Value } from "typebox/value"
import type { Static, TObject } from "typebox"

import { threadToolFailure } from "../errors"
import { THREAD_PARAM_ALIASES, THREAD_PARAM_NOTES } from "./aliases"
import { threadToolParamSchemas } from "./params"
import type { ThreadDataError } from "./results"

export type ThreadParamParse<S extends TObject> = { readonly kind: "ok"; readonly value: Static<S> } | ThreadDataError

/**
 * The field a caller most likely meant by a name no thread tool takes at the top level, tried in order against the
 * fields the called tool does take: a brief passed as `message` to thread_create is its `prompt`, a message passed as
 * `prompt` or `text` to thread_send is its `message` (the owner's lost-prompt case: an unknown field was dropped silently).
 */
const MEANT: Readonly<Record<string, readonly string[]>> = {
  message: ["prompt"],
  prompt: ["message"],
  text: ["message", "prompt"],
  body: ["message", "prompt"],
  content: ["message", "prompt"],
  brief: ["prompt", "message"],
  wait: ["wait_ms"],
  timeout: ["wait_ms"],
  timeout_ms: ["wait_ms"],
  task: ["prompt", "message"],
  instructions: ["prompt", "message"],
  target: ["thread"],
  thread_id: ["thread"],
  session: ["thread"],
  session_id: ["thread"],
  id: ["thread"],
  title: ["name"],
  mode: ["delivery"],
  level: ["reasoning"],
  thinking: ["reasoning", "level"],
  thinking_level: ["reasoning", "level"],
  directory: ["cwd"],
  folder: ["cwd"],
  key: ["idempotency_key"],
}

// Validation seam: parse a thread tool payload against its schema and return the outcome as
// data. Invalid input yields the invalid_arguments failure object here instead of throwing,
// so tool runners can hand it straight to the model. A top-level field the tool does not take is
// refused first, named, with the field the caller most likely meant: a dropped field is a lost
// instruction (thread_create's `message` was a brief that never ran).
export function parseThreadParams<S extends TObject>(schema: S, input: unknown): ThreadParamParse<S> {
  if (typeof input === "object" && input !== null && !Array.isArray(input)) {
    const tool = toolNamed(schema)
    const aliased = withAliases(tool, input as Record<string, unknown>)
    if (aliased.kind === "error") return aliased
    input = aliased.value
    const known = Object.keys(schema.properties)
    // A key set to undefined passes nothing (a caller spreading its optional fields), so only a field with a value counts.
    const unknown = Object.entries(aliased.value).find(([field, value]) => value !== undefined && !known.includes(field))?.[0]
    if (unknown !== undefined) {
      const suggestion = MEANT[unknown]?.find((field) => known.includes(field))
      const { [unknown]: given, ...rest } = aliased.value
      const corrected = correctedCall(tool, suggestion === undefined ? rest : { ...rest, [suggestion]: given })
      const note = tool === undefined ? undefined : THREAD_PARAM_NOTES[tool]?.[unknown]
      return {
        kind: "error",
        error: threadToolFailure(
          "invalid_arguments",
          `This tool takes no field "${unknown}"${suggestion === undefined ? "" : `; did you mean "${suggestion}"?`} Nothing was done.`,
          (suggestion === undefined
            ? `Call the tool again without "${unknown}": ${corrected}. It takes: ${known.join(", ")}.`
            : `Call the tool again with "${suggestion}" in place of "${unknown}": ${corrected}.`) +
            (note === undefined ? "" : ` ${note}`),
          {
            field: unknown,
            ...(suggestion === undefined ? {} : { suggestion }),
            accepted: known,
            corrected_call: corrected,
            ...(tool === undefined || THREAD_PARAM_ALIASES[tool] === undefined
              ? {}
              : { aliases: THREAD_PARAM_ALIASES[tool] }),
          },
        ),
      }
    }
  }
  if (Value.Check(schema, input)) {
    return { kind: "ok", value: input as Static<S> }
  }
  const [first] = Value.Errors(schema, input)
  return {
    kind: "error",
    error: threadToolFailure(
      "invalid_arguments",
      `Parameter validation failed at ${first?.instancePath ?? "/"}: ${first?.message ?? "invalid value"}`,
      "Fix the flagged field and call the tool again with a valid payload.",
    ),
  }
}

const TOOL_OF_SCHEMA = new Map<TObject, string>(
  Object.entries(threadToolParamSchemas).map(([tool, schema]) => [schema as TObject, tool]),
)

function toolNamed(schema: TObject): string | undefined {
  return TOOL_OF_SCHEMA.get(schema)
}

type Aliased = { readonly kind: "ok"; readonly value: Record<string, unknown> } | ThreadDataError

function withAliases(tool: string | undefined, input: Record<string, unknown>): Aliased {
  const aliases = tool === undefined ? undefined : THREAD_PARAM_ALIASES[tool]
  if (aliases === undefined) return { kind: "ok", value: input }
  const value: Record<string, unknown> = { ...input }
  for (const [alias, field] of Object.entries(aliases)) {
    const given = value[alias]
    if (given === undefined) continue
    delete value[alias]
    if (value[field] !== undefined && JSON.stringify(value[field]) !== JSON.stringify(given)) {
      return {
        kind: "error",
        error: threadToolFailure(
          "invalid_arguments",
          `"${alias}" is another name for "${field}", and the two were given different values. Nothing was done.`,
          `Pass the value once, as "${field}".`,
          { field: alias, canonical: field },
        ),
      }
    }
    value[field] = given
  }
  return { kind: "ok", value }
}

const SHOWN_STRING_CHARS = 80

/** The call to make instead, as the agent writes it in an eval cell, with long strings cut so the refusal stays short. */
function correctedCall(tool: string | undefined, args: Record<string, unknown>): string {
  const shown = Object.fromEntries(
    Object.entries(args)
      .filter(([, value]) => value !== undefined)
      .map(([field, value]) => [
        field,
        typeof value === "string" && value.length > SHOWN_STRING_CHARS ? `${value.slice(0, SHOWN_STRING_CHARS)}...` : value,
      ]),
  )
  return `tool.${tool ?? "<tool>"}(${JSON.stringify(shown)})`
}
