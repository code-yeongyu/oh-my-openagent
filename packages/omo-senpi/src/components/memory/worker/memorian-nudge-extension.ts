// The memorian gate child gets exactly one way to speak: a `nudge` tool loaded through senpi's
// explicit `-e` extension flag. The extension is shipped as an embedded SOURCE string rather than a
// module reference because the child runs from a per-run directory outside this package's module
// graph; the parent materializes this text next to the run payload at spawn time.
//
// The source is deliberately dependency-free: no senpi imports, no typebox import. Tool parameters
// are a plain JSON Schema literal, which senpi's argument validator compiles and coerces exactly
// like a TypeBox schema (pi-ai validateToolArguments handles the non-TypeBox branch). That keeps the
// materialized file loadable from any directory without node_modules resolution.

/** Env var the parent points at the NDJSON sink the tool appends to. */
export const MEMORIAN_NUDGE_PATH_ENV = "MEMORIAN_NUDGE_PATH"

/** Filename the parent materializes the source under, inside the run directory. */
export const MEMORIAN_NUDGE_EXTENSION_FILENAME = "nudge-extension.ts"

/** The single tool the gate child may call. */
export const MEMORIAN_NUDGE_TOOL_NAME = "nudge"

export const MEMORIAN_NUDGE_EXTENSION_SOURCE = `// Generated at spawn time by the omo memorian gate. Do not edit: this file is rewritten per run.
import { appendFileSync } from "node:fs"

const NUDGE_PATH_ENV = "${MEMORIAN_NUDGE_PATH_ENV}"

const nudgeTool = {
  name: "${MEMORIAN_NUDGE_TOOL_NAME}",
  label: "Nudge",
  description: "Surface one stored memory to the primary agent as a read-only hint. Call it only when the memory would change what the agent does next.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Memory path copied exactly from the candidates input." },
      hint: { type: "string", description: "One factual sentence, at most 200 characters, on a single line." },
    },
    required: ["path", "hint"],
    additionalProperties: false,
  },
  async execute(_toolCallId, params) {
    const target = process.env[NUDGE_PATH_ENV]
    if (target === undefined || target === "") {
      throw new Error(NUDGE_PATH_ENV + " is not set; the memorian gate child was launched without a nudge sink.")
    }
    appendFileSync(target, JSON.stringify({ path: params.path, hint: params.hint }) + "\\n", { encoding: "utf8", mode: 0o600 })
    return { content: [{ type: "text", text: "Nudge recorded for " + params.path + "." }] }
  },
}

export default function memorianNudgeExtension(pi) {
  pi.registerTool(nudgeTool)
}
`
