/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import { clearSessionAgent, setSessionAgent } from "../../features/claude-code-session-state"
import { createPrometheusMdOnlyHook } from "./hook"
import { isAllowedFile } from "./path-policy"
import { invokeBefore } from "./fixtures/invoke-before"

describe("Prometheus filesystem destinations (B2, #11367)", () => {
  let root: string
  let sessionID: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "prometheus-symlink-"))
    sessionID = `ses_${randomUUID()}`
    mkdirSync(join(root, ".omo"))
    mkdirSync(join(root, "src"))
    writeFileSync(join(root, "src/app.ts"), "original")
    writeFileSync(join(root, ".omo/allowed.md"), "plan")
    setSessionAgent(sessionID, "prometheus")
  })

  afterEach(() => {
    clearSessionAgent(sessionID)
    rmSync(root, { recursive: true, force: true })
  })

  test("canonicalizes an aliased workspace root", async () => {
    symlinkSync(".", join(root, "workspace-alias"), "dir")
    const hook = createPrometheusMdOnlyHook({
      directory: join(root, "workspace-alias"),
      client: {},
    } as never)
    await expect(invokeBefore(hook,
      { tool: "write", sessionID, callID: "workspace-alias" },
      { args: { filePath: ".omo/allowed.md" } },
    )).resolves.toBeUndefined()
  })

  test("denies an unresolvable workspace root and invalid path", () => {
    expect(isAllowedFile(".omo/new.md", join(root, "missing"))).toBe(false)
    expect(isAllowedFile(".omo/invalid\0.md", root)).toBe(false)
  })

  const cases = [
    { name: "plain new Markdown", target: ".omo/new.md", allowed: true },
    { name: "new nested parents", target: ".omo/new/deep/plan.md", allowed: true },
    { name: "non-Markdown", target: ".omo/app.ts", allowed: false },
    { name: "nested project planning directory", target: "src/.omo/plan.md", allowed: true },
    {
      name: "file symlink outside",
      target: ".omo/plan.md",
      link: ".omo/plan.md",
      destination: "../src/app.ts",
      allowed: false,
    },
    {
      name: "relative symlink with parent traversal",
      target: ".omo/plan.md",
      link: ".omo/plan.md",
      destination: "../.omo/../src/app.ts",
      allowed: false,
    },
    {
      name: "dangling file symlink",
      target: ".omo/plan.md",
      link: ".omo/plan.md",
      destination: "../src/missing.md",
      allowed: false,
    },
    {
      name: "allowed internal file symlink",
      target: ".omo/plan.md",
      link: ".omo/plan.md",
      destination: "allowed.md",
      allowed: true,
    },
    {
      name: "internal symlink to non-Markdown",
      target: ".omo/plan.md",
      link: ".omo/plan.md",
      destination: "app.ts",
      allowed: false,
    },
    {
      name: "symlinked planning directory",
      target: ".omo/plan.md",
      link: ".omo",
      destination: "src",
      allowed: true,
    },
    {
      name: "symlinked ancestor",
      target: ".omo/redirect/new/plan.md",
      link: ".omo/redirect",
      destination: "../src",
      allowed: false,
    },
    {
      name: "raw absolute symlink then parent traversal",
      target: ".omo/redirect/../plan.md",
      link: ".omo/redirect",
      destination: "../src/deep",
      absolute: true,
      allowed: false,
    },
    {
      name: "raw absolute traversal with missing parents",
      target: ".omo/redirect/../new/deep/plan.md",
      link: ".omo/redirect",
      destination: "../src/deep",
      absolute: true,
      allowed: false,
    },
    {
      name: "dangling ancestor",
      target: ".omo/redirect/new/plan.md",
      link: ".omo/redirect",
      destination: "../missing",
      allowed: false,
    },
    {
      name: "symlink loop",
      target: ".omo/loop/plan.md",
      link: ".omo/loop",
      destination: "loop",
      allowed: false,
    },
    { name: "non-directory ancestor", target: ".omo/allowed.md/plan.md", allowed: false },
    { name: "missing planning directory", target: ".omo/plan.md", removeOmo: true, allowed: true },
  ]
  const calls: { tool: string; args: (target: string) => Record<string, unknown> }[] = [
    ...["Write", "Edit", "write", "edit", "MultiEdit", "multiedit"].map((tool) => ({
      tool,
      args: (target: string) => ({ filePath: target }),
    })),
    { tool: "write", args: (target) => ({ file_path: target }) },
    { tool: "edit", args: (target) => ({ path: target }) },
    { tool: "edit", args: (target) => ({ file: target }) },
    { tool: "edit", args: (target) => ({ filePath: ".omo/allowed.md", rename: target }) },
    ...["Add File", "Update File", "Delete File", "Move to"].flatMap((header) =>
      ["patchText", "input", "patch"].map((field) => ({
        tool: "apply_patch",
        args: (target: string) => ({
          [field]: [
            "*** Begin Patch",
            ...(header === "Move to" ? ["*** Update File: .omo/allowed.md"] : []),
            `*** ${header}: ${target}`,
            "*** End Patch",
          ].join("\n"),
        }),
      })),
    ),
  ]

  for (const scenario of cases) {
    for (const [index, call] of calls.entries()) {
      test(`${scenario.name}: ${call.tool} target ${index}`, async () => {
        if (scenario.link === ".omo" || ("removeOmo" in scenario && scenario.removeOmo)) {
          rmSync(join(root, ".omo"), { recursive: true })
        }
        if (scenario.destination === "app.ts") {
          writeFileSync(join(root, ".omo/app.ts"), "code")
        }
        if (scenario.destination === "../src/deep") {
          mkdirSync(join(root, "src/deep"))
        }
        if (scenario.link && scenario.destination) {
          symlinkSync(
            scenario.destination,
            join(root, scenario.link),
            scenario.link === ".omo" || scenario.link.endsWith("redirect") || scenario.link.endsWith("loop")
              ? "dir" : "file",
          )
        }
        const hook = createPrometheusMdOnlyHook({ directory: root, client: {} } as never)
        const result = invokeBefore(hook,
          { tool: call.tool, sessionID, callID: `call-${index}` },
          { args: call.args("absolute" in scenario && scenario.absolute ? `${root}/${scenario.target}` : scenario.target) },
        )
        if (scenario.allowed) {
          await expect(result).resolves.toBeUndefined()
        } else {
          await expect(result).rejects.toThrow("File operations restricted")
        }
      })
    }
  }
})
