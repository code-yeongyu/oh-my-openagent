import { afterEach, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  copyEditorProfile, createEditorProfile, deleteEditorProfile, isEditorModified, listEditorProfiles,
  openEditorSession, readEditorValue, saveEditorSession, setEditorValue,
} from "./backend"

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture(content = "{}") {
  const root = mkdtempSync(join(tmpdir(), "omo-editor-profiles-"))
  roots.push(root)
  const path = join(root, "omo.jsonc")
  writeFileSync(path, content)
  chmodSync(path, 0o600)
  return { root, path, session: openEditorSession(path, "project") }
}

test("profile lifecycle stages selected-file declarations, keeps copy metadata independent and preserves safe persistence", () => {
  const original = '// keep sibling note\n{"profiles":{"work":{"[opencode]":{"agents":{"oracle":{"models":[{"model":"provider/large","variant":"high"},"provider/small"],"permission":{"edit":"ask"}}}}}},"future":{"keep":true}}\n'
  const { session, path, root } = fixture(original)
  const names = listEditorProfiles(session) as string[]
  names.push("not-a-declaration")
  expect(listEditorProfiles(session)).toEqual(["work"])
  createEditorProfile(session, "budget")
  expect(readEditorValue(session, ["profiles", "budget"])).toEqual({})
  copyEditorProfile(session, "work", "balanced")
  const field = ["profiles", "balanced", "[opencode]", "agents", "oracle", "permission"]
  setEditorValue(session, field, { edit: "deny" })
  expect(readEditorValue(session, ["profiles", "work", "[opencode]", "agents", "oracle", "permission"])).toEqual({ edit: "ask" })
  deleteEditorProfile(session, "budget")
  expect(listEditorProfiles(session)).toEqual(["work", "balanced"])
  expect(readFileSync(path, "utf8")).toBe(original)
  expect(readdirSync(root)).toEqual(["omo.jsonc"])
  const result = saveEditorSession(session)
  if (result.backupPath === undefined) throw new Error("Expected a backup after saving edits.")
  expect(readFileSync(result.backupPath, "utf8")).toBe(original)
  expect(readFileSync(path, "utf8")).toContain("// keep sibling note")
  expect(readEditorValue(openEditorSession(path, "project"), ["future"])).toEqual({ keep: true })
  expect(statSync(path).mode & 0o777).toBe(0o600)
  expect(statSync(result.backupPath).mode & 0o777).toBe(0o600)
  expect(readEditorValue(session, ["profiles", "balanced", "[opencode]", "agents", "oracle", "models"])).toEqual([{ model: "provider/large", variant: "high" }, "provider/small"])
  expect(isEditorModified(session)).toBe(false)
})

test("invalid names, collisions and missing sources do not mutate any staged state", () => {
  const { session } = fixture('{"profiles":{"work":{}}}')
  const before = structuredClone(session)
  for (const name of ["", " ", " padded", "padded ", "__proto__", "constructor", "prototype", "x\u001b[2J", "x\u0085", "work"]) {
    expect(() => createEditorProfile(session, name)).toThrow()
    expect(() => copyEditorProfile(session, "work", name)).toThrow()
    expect(session).toEqual(before)
  }
  expect(() => copyEditorProfile(session, "missing", "copy")).toThrow("not declared")
  expect(() => deleteEditorProfile(session, "missing")).toThrow("not declared")
  expect(session).toEqual(before)
})

test("names are literal keys and do not traverse dotted paths", () => {
  const { session } = fixture()
  createEditorProfile(session, "budget.v2 / team")
  expect(listEditorProfiles(session)).toEqual(["budget.v2 / team"])
  expect(readEditorValue(session, ["profiles", "budget.v2 / team"])).toEqual({})
  deleteEditorProfile(session, "budget.v2 / team")
  expect(listEditorProfiles(session)).toEqual([])
})

test("copies validate the entire new declaration transactionally while allowing unrelated invalid siblings", () => {
  const { session } = fixture('{"profiles":{"bad":{"[opencode]":{"typo":true}},"good":{}}}')
  const before = structuredClone(session)
  expect(() => copyEditorProfile(session, "bad", "copy")).toThrow("Unrecognized")
  expect(session).toEqual(before)
  copyEditorProfile(session, "good", "copy")
  expect(listEditorProfiles(session)).toEqual(["bad", "good", "copy"])
  deleteEditorProfile(session, "bad")
  expect(listEditorProfiles(session)).toEqual(["good", "copy"])
})

test("malformed profiles are refused and external changes retain staged profile edits", () => {
  const { session, path, root } = fixture('{"profiles":[]}')
  expect(() => listEditorProfiles(session)).toThrow("must be an object")
  expect(() => createEditorProfile(session, "new")).toThrow("must be an object")
  const valid = fixture('{"profiles":{"work":{}}}')
  deleteEditorProfile(valid.session, "work")
  writeFileSync(valid.path, '{"profiles":{"external":{}}}')
  expect(() => saveEditorSession(valid.session)).toThrow("changed on disk")
  expect(readFileSync(valid.path, "utf8")).toBe('{"profiles":{"external":{}}}')
  expect(isEditorModified(valid.session)).toBe(true)
  expect(readdirSync(valid.root)).toEqual(["omo.jsonc"])
  expect(readFileSync(path, "utf8")).toBe('{"profiles":[]}')
  expect(readdirSync(root)).toHaveLength(1)
})

test("copy rejects literal reserved keys before JSONC parsing can silently drop them", () => {
  for (const value of ['{"polluted":true}', "null", "true", '"literal"']) {
    const { session, path } = fixture(`{"profiles":{"work":{"[opencode]":{"agents":{"oracle":{"__proto__":${value},"model":"provider/a"}}}}}}`)
    const before = structuredClone(session)
    const bytes = readFileSync(path, "utf8")
    expect(() => copyEditorProfile(session, "work", "copy")).toThrow("Reserved configuration key: __proto__")
    expect(session).toEqual(before)
    expect(readFileSync(path, "utf8")).toBe(bytes)
  }
})

test("copy uses the same last declaration semantics as the editor for duplicate JSONC properties", () => {
  const { session } = fixture('{"profiles":{"work":{"model_profile":"first"},"work":{"model_profile":"last"}}}')
  copyEditorProfile(session, "work", "copy")
  expect(readEditorValue(session, ["profiles", "copy"])).toEqual({ model_profile: "last" })
})

test("profile lifecycle backend imports and runs without a terminal or prompt dependencies", () => {
  const { path } = fixture()
  const backend = new URL("./backend.ts", import.meta.url).href
  const result = spawnSync(process.execPath, ["-e", `
    Bun.plugin({ name: "profiles-headless", setup(builder) {
      builder.onResolve({ filter: /^@clack\\/prompts$/ }, () => { throw new Error("terminal dependency") })
    } })
    const api = await import(${JSON.stringify(backend)})
    const session = api.openEditorSession(${JSON.stringify(path)}, "project")
    api.createEditorProfile(session, "budget")
    api.copyEditorProfile(session, "budget", "balanced")
    api.deleteEditorProfile(session, "budget")
    console.log(JSON.stringify({ terminal: Boolean(process.stdin.isTTY), names: api.listEditorProfiles(session), modified: api.isEditorModified(session) }))
  `], { encoding: "utf8", timeout: 30000, stdio: ["pipe", "pipe", "pipe"] })
  expect(result.status).toBe(0)
  expect(result.stderr).toBe("")
  expect(JSON.parse(result.stdout)).toEqual({ terminal: false, names: ["balanced"], modified: true })
  expect(readFileSync(path, "utf8")).toBe("{}")
})
