import { afterEach, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  isEditorModified, openEditorSession, readEditorValue, saveEditorSession, setEditorValue, validateEditorValue,
} from "./backend"

const fixtures: string[] = []
afterEach(() => { for (const path of fixtures.splice(0)) rmSync(path, { force: true, recursive: true }) })

test("headless backend validates without mutation, snapshots edits and safely saves or refuses a conflict", () => {
  const root = mkdtempSync(join(tmpdir(), "omo-editor-backend-"))
  fixtures.push(root)
  const path = join(root, "omo.jsonc")
  const original = '// keep this note\n{"[opencode]":{"agents":{"oracle":{"permission":{"edit":"ask"}}}},"future":{"keep":true}}\n'
  writeFileSync(path, original)
  chmodSync(path, 0o600)
  const session = openEditorSession(path, "project")
  const field = ["[opencode]", "agents", "oracle", "permission"]
  const snapshot = readEditorValue(session, field) as Record<string, unknown>
  snapshot["edit"] = "deny"
  expect(readEditorValue(session, field)).toEqual({ edit: "ask" })
  expect(isEditorModified(session)).toBe(false)
  const before = structuredClone(session)
  const invalid = validateEditorValue(session, field, { edit: "unrecognized" })
  expect(invalid.valid).toBe(false)
  expect(invalid.issues[0]).toMatchObject({ code: "invalid-value", path: field })
  expect(invalid.issues[0]?.message).toContain("permission.edit")
  const value = { edit: "allow" }
  expect(validateEditorValue(session, field, value)).toEqual({ valid: true, issues: [] })
  expect(session).toEqual(before)
  expect(isEditorModified(session)).toBe(false)
  expect(readFileSync(path, "utf8")).toBe(original)
  expect(readdirSync(root)).toEqual(["omo.jsonc"])

  setEditorValue(session, field, value)
  value.edit = "deny"
  expect(readEditorValue(session, field)).toEqual({ edit: "allow" })
  const saved = saveEditorSession(session)
  expect(readFileSync(saved.backupPath!, "utf8")).toBe(original)
  expect(readFileSync(path, "utf8")).toContain("// keep this note")
  expect(readFileSync(path, "utf8")).toContain('"future":{"keep":true}')
  expect(readEditorValue(openEditorSession(path, "project"), field)).toEqual({ edit: "allow" })
  expect(statSync(path).mode & 0o777).toBe(0o600)
  expect(statSync(saved.backupPath!).mode & 0o777).toBe(0o600)

  setEditorValue(session, field, { edit: "deny" })
  const external = readFileSync(path, "utf8") + "// another writer\n"
  writeFileSync(path, external)
  expect(() => saveEditorSession(session)).toThrow("changed on disk")
  expect(readFileSync(path, "utf8")).toBe(external)
  expect(isEditorModified(session)).toBe(true)
  expect(readdirSync(root)).toHaveLength(2)
})

test("backend imports in a nonterminal subprocess without loading terminal prompts", () => {
  const backend = new URL("./backend.ts", import.meta.url).href
  const result = spawnSync(process.execPath, ["-e", `
    Bun.plugin({ name: "headless-contract", setup(builder) {
      builder.onResolve({ filter: /^@clack\\/prompts$/ }, () => { throw new Error("terminal prompts loaded by backend") })
    } })
    const api = await import(${JSON.stringify(backend)})
    console.log(JSON.stringify({ terminal: Boolean(process.stdin.isTTY), validate: typeof api.validateEditorValue, save: typeof api.saveEditorSession }))
  `], { encoding: "utf8", timeout: 30000, stdio: ["pipe", "pipe", "pipe"] })
  expect(result.status).toBe(0)
  expect(result.stderr).toBe("")
  expect(JSON.parse(result.stdout)).toEqual({ terminal: false, validate: "function", save: "function" })
})
