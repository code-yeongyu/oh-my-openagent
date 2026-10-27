import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import { createOpencodeClient } from "@opencode-ai/sdk"
import { clearSessionAgent, setSessionAgent } from "../../features/claude-code-session-state"
import { createPrometheusMdOnlyHook } from "./hook"
import { parsePatch } from "./fixtures/opencode-patch-parser"

const sessionID = "ses_prometheus_patch_lines"
const source = ".omo/plans/source.md"
const allowed = ".omo/plans/allowed.md"
const outside = "src/outside.ts"
const patch = (...lines: string[]) => ["*** Begin Patch", ...lines, "*** End Patch"].join("\n")
const pluginInput: PluginInput = {
  client: createOpencodeClient({
    fetch: async () => { throw new Error("Unexpected SDK request in patch-lines test") },
  }),
  project: { id: "patch-lines", worktree: "/tmp/test", time: { created: 0 } },
  directory: "/tmp/test",
  worktree: "/tmp/test",
  experimental_workspace: { register: () => {} },
  serverUrl: new URL("http://localhost"),
  $: Bun.$,
}
const hook = createPrometheusMdOnlyHook(pluginInput)
const input = { tool: "apply_patch", sessionID, callID: "patch-lines" }

const operations = [
  { name: "Add", lines: (path: string) => [`*** Add File:${path}`, "+after"] },
  { name: "Update", lines: (path: string) => [`*** Update File:${path}`, "@@", "-before", "+after"] },
  { name: "Delete", lines: (path: string) => [`*** Delete File:${path}`] },
  {
    name: "Move to",
    lines: (path: string) => [`*** Update File:${source}`, `*** Move to:${path}`, "@@", "-before", "+after"],
  },
]
const terminators = [
  { name: "CR plus space", value: "\r " },
  { name: "U+2028", value: "\u2028" },
  { name: "U+2029", value: "\u2029" },
]

beforeEach(() => setSessionAgent(sessionID, "prometheus"))
afterEach(() => clearSessionAgent(sessionID))

describe("apply_patch executor / guard differential (omo#11367 B1)", () => {
  for (const context of ["***", "***important***", "*** Add File:src/example.ts"]) {
    for (const move of [false, true]) {
      test(`Update context ${JSON.stringify(context)}, move=${move}, remains allowed`, async () => {
        const patchText = patch(
          "*** Update File:.omo/plans/a.md",
          ...(move ? [`*** Move to:${allowed}`] : []),
          "@@",
          ` ${context}`,
          "-before",
          "+after",
        )
        const { hunks } = parsePatch(patchText)
        expect(hunks).toHaveLength(1)
        expect(hunks[0]).toMatchObject({
          type: "update",
          path: ".omo/plans/a.md",
          move_path: move ? allowed : undefined,
          chunks: [{ old_lines: [context, "before"], new_lines: [context, "after"] }],
        })

        await expect(hook["tool.execute.before"](input, { args: { patchText } })).resolves.toBeUndefined()
      })
    }
  }

  for (const operation of operations) {
    test(`Update context does not hide a following outside ${operation.name} header`, async () => {
      const patchText = patch(
        `*** Update File:${allowed}`, "@@", " ***", "-before", "+after",
        ...operation.lines(outside),
      )
      const { hunks } = parsePatch(patchText)
      expect(hunks).toHaveLength(2)
      expect(hunks[1]).toMatchObject(
        operation.name === "Move to"
          ? { type: "update", path: source, move_path: outside }
          : { type: operation.name.toLowerCase(), path: outside },
      )

      await expect(hook["tool.execute.before"](input, { args: { patchText } })).rejects.toThrow(
        "File operations restricted to .omo/*.md plan files only",
      )
    })
  }

  for (const header of ["*** Rename File:src/outside.ts", "*** Add File:"]) {
    test(`Update context still rejects malformed directive ${JSON.stringify(header)}`, async () => {
      const patchText = patch(`*** Update File:${allowed}`, "@@", " ***", "-before", "+after", header)

      await expect(hook["tool.execute.before"](input, { args: { patchText } })).rejects.toThrow(
        "File operations restricted to .omo/*.md plan files only",
      )
    })
  }

  for (const operation of operations) {
    for (const terminator of terminators) {
      for (const mixed of [false, true]) {
        test(`${operation.name} outside with ${terminator.name}, mixed=${mixed}, is blocked`, async () => {
          // The independent executor parser must see the outside hunk before guard rejection counts.
          const patchText = patch(
            ...(mixed ? [`*** Add File:${allowed}`, "+# Plan"] : []),
            ...operation.lines(outside + terminator.value),
          )
          const hunks = parsePatch(patchText).hunks
          expect(hunks).toHaveLength(mixed ? 2 : 1)
          const target = hunks.at(-1)
          if (target === undefined) throw new Error("Expected a parsed target hunk")
          if (operation.name === "Move to") {
            expect(target).toMatchObject({ type: "update", path: source, move_path: outside })
          } else {
            expect(target).toMatchObject({ type: operation.name.toLowerCase(), path: outside })
          }

          await expect(hook["tool.execute.before"](input, { args: { patchText } })).rejects.toThrow(
            "File operations restricted to .omo/*.md plan files only",
          )
        })
      }

      test(`${operation.name} allowed with ${terminator.name} remains allowed`, async () => {
        const patchText = patch(...operation.lines(allowed + terminator.value))
        const { hunks } = parsePatch(patchText)
        expect(hunks).toHaveLength(1)
        expect(hunks[0]).toMatchObject(
          operation.name === "Move to"
            ? { type: "update", path: source, move_path: allowed }
            : { type: operation.name.toLowerCase(), path: allowed },
        )

        await expect(hook["tool.execute.before"](input, { args: { patchText } })).resolves.toBeUndefined()
      })
    }
  }

  for (const header of [
    "*** Add File:",
    "*** Update File:\u2028",
    "*** Delete File:\r ",
    "*** Move to:\u2029",
    "*** Rename File:src/outside.ts",
  ]) {
    test(`unclassifiable or empty header ${JSON.stringify(header)} fails closed in a mixed patch`, async () => {
      const patchText = patch(`*** Add File:${allowed}`, "+# Plan", header)

      await expect(hook["tool.execute.before"](input, { args: { patchText } })).rejects.toThrow(
        "File operations restricted to .omo/*.md plan files only",
      )
    })
  }
})
