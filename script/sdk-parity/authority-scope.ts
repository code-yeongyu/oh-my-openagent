import { readFileSync } from "node:fs"
import { join } from "node:path"

import {
  GATED,
  inputAccepts,
  OMO_CODE_REGISTRY,
  PORT_OPERATIONS,
  ROOT_CALLS,
  SOURCE_CODES,
} from "../../packages/omo-senpi/src/components/omo-sdk/contract"
import { AUTHORITY_CALLS } from "../../packages/omo-senpi/src/components/omo-sdk/contract/calls/authority"
import { UNRESOLVED_PATH } from "./baseline"
import { callInputOf } from "./call-input"
import type { CallInput, Contract } from "./contract-check"
import { TYPED_AHEAD_INPUTS } from "./typed-ahead"
import { allRows, loadDomainFiles, REPO_ROOT } from "./registry"
import { loadScenarioTable } from "./scenario-table"

// The rows and fields slice P1a-s (#14949) typed, and P1a's contract restricted to them, so P1a's own checks run over
// this slice's part of the tree whatever state the rest of P1a's scenario table is in.
export const json = (schema: unknown): CallInput & Record<string, unknown> => {
  const parsed = JSON.parse(JSON.stringify(schema)) as Partial<CallInput> & Record<string, unknown>
  return { ...parsed, properties: parsed.properties ?? {}, required: parsed.required ?? [] }
}
export const calls: Readonly<Record<string, CallInput & Record<string, unknown>>> = Object.fromEntries(
  Object.entries(ROOT_CALLS).map(([key, call]) => [key, { ...json(call.input), ...callInputOf(call.input) }]),
)
export const rows = allRows(loadDomainFiles())
export const files = loadScenarioTable()
export const securityDesign = readFileSync(join(REPO_ROOT, "docs/reference/omo-sdk-authority-and-custody.md"), "utf8")

/** P1a's rows that carry a field this slice typed, with those fields. */
const SHARED: Readonly<Record<string, readonly string[]>> = {
  "threads.send": ["author"],
  "threads.sendAndFollow": ["author"],
  "threads.create": ["launch_spec", "prompt"],
  "threads.extensions.register": ["sessionCallable"],
  "daemon.ensure": ["launch_spec", "mcp_presenter_enforcement"],
  "daemon.handoff": ["launch_spec"],
  "install.plugin": ["codex_autonomous"],
  "engine.models.list": ["setup"],
  "engine.promptSizes": ["setup"],
}
const SLICE = new Set([...Object.keys(AUTHORITY_CALLS), ...Object.keys(SHARED)])
export const sliceRows = rows.filter((row) => SLICE.has(row.id))

const pick = (key: string, input: CallInput): CallInput => {
  const fields = SHARED[key]
  if (fields === undefined) return input
  return {
    properties: Object.fromEntries(Object.entries(input.properties).filter(([name]) => fields.includes(name))),
    required: input.required.filter((name) => fields.includes(name)),
  }
}

const fullCalls = Object.fromEntries([...SLICE].map((key) => [key, calls[key] ?? { properties: {}, required: [] }]))

/** P1a's contract over this slice's rows: whole inputs for the input check, this slice's fields for the coverage check. */
export const sliceContract: Contract = {
  calls: Object.fromEntries([...SLICE].map((key) => [key, pick(key, calls[key] ?? { properties: {}, required: [] })])),
  gated: GATED,
  ports: PORT_OPERATIONS,
  sections: [],
  rootOptions: [],
  registry: OMO_CODE_REGISTRY,
  heldCodes: {},
  sourceCodes: SOURCE_CODES,
  accepts: (call, input) => inputAccepts(call, input),
  ahead: TYPED_AHEAD_INPUTS,
}
export const sliceInputContract: Contract = { ...sliceContract, calls: fullCalls }

export const sliceFiles = files.map((file) => ({
  ...file,
  inert: Object.fromEntries(
    Object.entries(file.inert).filter(([key]) => {
      const cut = key.lastIndexOf(".")
      return sliceContract.calls[key.slice(0, cut)]?.properties[key.slice(cut + 1)] !== undefined
    }),
  ),
  scenarios: file.scenarios.filter((scenario) => SLICE.has(scenario.row)),
}))

const hasPath = (node: Record<string, unknown> | undefined, path: readonly string[]): boolean => {
  const [head, ...rest] = path
  if (head === undefined) return node !== undefined
  const props = node?.properties as Record<string, Record<string, unknown>> | undefined
  const variants = (node?.anyOf as Record<string, unknown>[] | undefined) ?? []
  return hasPath(props?.[head], rest) || variants.some((variant) => hasPath(variant, path))
}

export const AUTHORITY_ROOT_OPTIONS = ["principal", "endpoint", "api", "accounts"] as const

/** Whether a held entry (`root.<option>`, `<row>` or `<row>#<field path>`) is typed on the root now. */
export const isTyped = (entry: string): boolean => {
  if (entry.startsWith("root.")) return (AUTHORITY_ROOT_OPTIONS as readonly string[]).includes(entry.slice(5))
  const [row = "", field] = entry.split("#")
  return field === undefined ? calls[row] !== undefined : hasPath(calls[row], field.split("."))
}

export const contractCalls: Readonly<Record<string, CallInput>> = Object.fromEntries(
  Object.entries(ROOT_CALLS).map(([key, call]) => [key, callInputOf(call.input)]),
)
export const UNRESOLVED_IDS: ReadonlySet<string> = new Set(
  (JSON.parse(readFileSync(join(REPO_ROOT, UNRESOLVED_PATH), "utf8")) as { entries: { id: string }[] }).entries.map(
    (entry) => entry.id,
  ),
)
