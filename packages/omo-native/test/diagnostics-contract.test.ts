import { expect, test } from "bun:test"
import type { DiagnosticsCalls } from "../bin/lib/diagnostics-contract"
import * as diagnostics from "../bin/lib/diagnostics.js"

// Public API contract (#14959): the module the SDK's diagnostics loader imports exports exactly the
// namespace's calls, and each one type-checks against its contract signature.
test("#given the diagnostics core #then it exports exactly the four namespace calls, each assignable to its contract", () => {
  const calls: DiagnosticsCalls = diagnostics
  expect(Object.keys(calls).sort()).toEqual(["fixReflectionLock", "models", "reapStaleEngines", "run"])
})
