import { Value } from "typebox/value"
import type { Static, TObject } from "typebox"

import { threadToolFailure } from "../errors"
import type { ThreadDataError } from "./results"

export type ThreadParamParse<S extends TObject> =
  | { readonly kind: "ok"; readonly value: Static<S> }
  | ThreadDataError

// Validation seam: parse a thread tool payload against its schema and return the outcome as
// data. Invalid input yields the invalid_arguments failure object here instead of throwing,
// so tool runners can hand it straight to the model.
export function parseThreadParams<S extends TObject>(schema: S, input: unknown): ThreadParamParse<S> {
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

