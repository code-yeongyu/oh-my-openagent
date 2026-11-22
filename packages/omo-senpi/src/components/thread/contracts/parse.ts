import { Value } from "typebox/value"
import type { Static, TObject } from "typebox"

import { threadToolFailure } from "../errors"
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
    const known = Object.keys(schema.properties)
    // A key set to undefined passes nothing (a caller spreading its optional fields), so only a field with a value counts.
    const unknown = Object.entries(input).find(([field, value]) => value !== undefined && !known.includes(field))?.[0]
    if (unknown !== undefined) {
      const suggestion = MEANT[unknown]?.find((field) => known.includes(field))
      return {
        kind: "error",
        error: threadToolFailure(
          "invalid_arguments",
          `This tool takes no field "${unknown}"${suggestion === undefined ? "" : `; did you mean "${suggestion}"?`} Nothing was done.`,
          suggestion === undefined
            ? `Call the tool again without "${unknown}"; it takes: ${known.join(", ")}.`
            : `Call the tool again with "${suggestion}" in place of "${unknown}".`,
          { field: unknown, ...(suggestion === undefined ? {} : { suggestion }), accepted: known },
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
