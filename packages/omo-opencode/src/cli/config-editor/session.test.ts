import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { DEFAULT_WRITE_FILE_SYSTEM } from "@oh-my-opencode/omo-config-core"
import { discoverEditorTargets, isEditorModified, openEditorSession, readEditorValue, saveEditorSession, setEditorValue, withEditorTransaction } from "./session"

const fixtures: string[] = []

function fixture(content?: string): { root: string; path: string } {
  const root = mkdtempSync(join(tmpdir(), "omo-editor-"))
  fixtures.push(root)
  const path = join(root, "project", ".omo", "omo.jsonc")
  mkdirSync(dirname(path), { recursive: true })
  if (content !== undefined) writeFileSync(path, content)
  return { root, path }
}

afterEach(() => {
  for (const root of fixtures.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("config editor sessions", () => {
  test("preserves comments, unrelated fields and fallback objects when saving a shared model chain", () => {
    const original = `{
  // keep this explanation
  "future_setting": { "enabled": true },
  "agents": {
    "oracle": {
      // provider-specific fallback details
      "models": ["openai/old", { "model": "anthropic/backup", "reasoning": "high" }],
      "temperature": 0.4,
    },
  },
}
`
    const { path } = fixture(original)
    const session = openEditorSession(path, "project")
    setEditorValue(session, ["agents", "oracle", "models"], ["openai/new", { model: "anthropic/backup", reasoning: "high" }])
    const saved = saveEditorSession(session)
    const content = readFileSync(path, "utf-8")
    expect(content).toContain("// keep this explanation")
    expect(content).toContain("// provider-specific fallback details")
    expect(content).toContain('"future_setting": { "enabled": true }')
    expect(content).toContain('"temperature": 0.4')
    if (saved.backupPath === undefined) throw new Error("Expected a backup after saving edits.")
    expect(readFileSync(saved.backupPath, "utf-8")).toBe(original)
    expect(readEditorValue(session, ["agents", "oracle", "models"])).toEqual(["openai/new", { model: "anthropic/backup", reasoning: "high" }])
    expect(isEditorModified(session)).toBe(false)
  })

  test("editing an OpenCode category and default agent uses the unified harness block", () => {
    const { path } = fixture('{"[opencode]":{"agents":{"oracle":{"temperature":0.2}}},"[codex]":{"model_profile":"precise"}}')
    const session = openEditorSession(path, "project")
    setEditorValue(session, ["[opencode]", "agents", "oracle", "category"], "deep")
    setEditorValue(session, ["[opencode]", "default_run_agent"], "sisyphus")
    saveEditorSession(session)
    expect(readEditorValue(session, ["[opencode]", "agents", "oracle", "category"])).toBe("deep")
    expect(readEditorValue(session, ["[codex]", "model_profile"])).toBe("precise")
    expect(readEditorValue(session, ["[opencode]", "default_run_agent"])).toBe("sisyphus")
  })

  test("does not warn or reject sparse agent overrides without explicit model assignments", () => {
    const { path } = fixture('{"agents":{"oracle":{"temperature":0.2}},"[opencode]":{"agents":{"explore":{"category":"quick"}}}}')
    const session = openEditorSession(path, "project")
    setEditorValue(session, ["agents", "oracle", "temperature"], 0.5)
    expect(() => saveEditorSession(session)).not.toThrow()
  })

  test("no-op and reverted edits leave bytes untouched and create no backups", () => {
    const original = '{\n  "agents": { "oracle": { "model": "openai/a" } }\n}\n'
    const { path } = fixture(original)
    const session = openEditorSession(path, "project")
    setEditorValue(session, ["agents", "oracle", "model"], "openai/a")
    expect(isEditorModified(session)).toBe(false)
    setEditorValue(session, ["agents", "oracle", "model"], "openai/b")
    setEditorValue(session, ["agents", "oracle", "model"], "openai/a")
    expect(saveEditorSession(session)).toEqual({ path })
    expect(readFileSync(path, "utf-8")).toBe(original)
    expect(readdirSync(dirname(path))).toEqual(["omo.jsonc"])
  })

  test("removing and restoring an earlier member is a semantic no-op despite key order", () => {
    const original = '{"agents":{"oracle":{"model":"openai/a","temperature":0.5}}}'
    const { path } = fixture(original)
    const session = openEditorSession(path, "project")
    setEditorValue(session, ["agents", "oracle", "model"], undefined)
    setEditorValue(session, ["agents", "oracle", "model"], "openai/a")
    expect(isEditorModified(session)).toBe(false)
    saveEditorSession(session)
    expect(readFileSync(path, "utf-8")).toBe(original)
    expect(readdirSync(dirname(path))).toEqual(["omo.jsonc"])
  })

  test("clear removes only the selected override and preserves other fallback entries", () => {
    const { path } = fixture('{"[opencode]":{"agents":{"oracle":{"category":"deep","models":["openai/a","openai/b","openai/c"]}}}}')
    const session = openEditorSession(path, "project")
    setEditorValue(session, ["[opencode]", "agents", "oracle", "category"], undefined)
    setEditorValue(session, ["[opencode]", "agents", "oracle", "models"], ["openai/b", "openai/c"])
    saveEditorSession(session)
    expect(readEditorValue(session, ["[opencode]", "agents", "oracle", "category"])).toBeUndefined()
    expect(readEditorValue(session, ["[opencode]", "agents", "oracle", "models"])).toEqual(["openai/b", "openai/c"])
  })

  test("clearing a sole trailing-comma model, models or default-agent member stays valid and preserves comments", () => {
    const cases = [
      { parent: ["agents", "oracle"], field: "model", value: '"openai/a"' },
      { parent: ["agents", "oracle"], field: "models", value: '["openai/a", "anthropic/b"]' },
      { parent: ["[opencode]"], field: "default_run_agent", value: '"sisyphus"' },
    ]
    for (const { parent, field, value } of cases) {
      const member = `{\n      // keep parent documentation\n      "${field}": ${value},\n    }`
      const original = parent.reduceRight((child, key) => `{ "${key}": ${child} }`, member)
      const { path } = fixture(original)
      const session = openEditorSession(path, "project")
      setEditorValue(session, [...parent, field], undefined)
      expect(readEditorValue(session, [...parent, field])).toBeUndefined()
      saveEditorSession(session)
      const reopened = openEditorSession(path, "project")
      expect(readEditorValue(reopened, parent)).toEqual({})
      expect(readFileSync(path, "utf-8")).toContain("// keep parent documentation")
    }
  })

  test("compact trailing-comma model and default-agent overrides can be cleared, saved and reopened", () => {
    const { path } = fixture('{ "agents": {"oracle": {"model":"p/a",}}, "[opencode]":{"default_run_agent":"oracle",},}')
    const session = openEditorSession(path, "project")
    setEditorValue(session, ["agents", "oracle", "model"], undefined)
    setEditorValue(session, ["[opencode]", "default_run_agent"], undefined)
    saveEditorSession(session)
    const reopened = openEditorSession(path, "project")
    expect(readEditorValue(reopened, ["agents", "oracle"])).toEqual({})
    expect(readEditorValue(reopened, ["[opencode]"])).toEqual({})
  })

  test("malformed JSONC and non-object roots cannot be opened", () => {
    for (const content of ['{"agents":', "null", "[]", "42"]) {
      const { path } = fixture(content)
      expect(() => openEditorSession(path, "project")).toThrow()
      expect(readFileSync(path, "utf-8")).toBe(content)
    }
  })

  test("invalid edits are rejected without changing in-memory data", () => {
    const { path } = fixture('{"agents":{"oracle":{"temperature":0.3}}}')
    const session = openEditorSession(path, "project")
    expect(() => setEditorValue(session, ["agents", "oracle", "temperature"], 8)).toThrow("temperature")
    expect(readEditorValue(session, ["agents", "oracle", "temperature"])).toBe(0.3)
    expect(isEditorModified(session)).toBe(false)
  })

  test("failed multi-field transactions roll back every staged change while retaining earlier edits", () => {
    const { path } = fixture('{"agents":{"oracle":{"model":"openai/a","temperature":0.3}}}')
    const session = openEditorSession(path, "project")
    setEditorValue(session, ["agents", "oracle", "temperature"], 0.5)
    const beforeContent = session.content
    const beforeEdits = structuredClone(session.edits)
    expect(() => withEditorTransaction(session, (staged) => {
      setEditorValue(staged, ["agents", "oracle", "models"], ["openai/b", "anthropic/c"])
      setEditorValue(staged, ["agents", "oracle", "model"], undefined)
      setEditorValue(staged, ["agents", "oracle", "temperature"], 8)
    })).toThrow("temperature")
    expect(session.content).toBe(beforeContent)
    expect(session.edits).toEqual(beforeEdits)
    expect(readEditorValue(session, ["agents", "oracle", "model"])).toBe("openai/a")
    expect(readEditorValue(session, ["agents", "oracle", "models"])).toBeUndefined()
    expect(readEditorValue(session, ["agents", "oracle", "temperature"])).toBe(0.5)
    expect(readFileSync(path, "utf-8")).toContain('"temperature":0.3')
  })

  test("successful multi-field transactions stage together and write only after save", () => {
    const { path } = fixture('{"agents":{"oracle":{"model":"openai/a"}}}')
    const session = openEditorSession(path, "project")
    withEditorTransaction(session, (staged) => {
      setEditorValue(staged, ["agents", "oracle", "models"], ["openai/b", "anthropic/c"])
      setEditorValue(staged, ["agents", "oracle", "model"], undefined)
    })
    expect(readEditorValue(session, ["agents", "oracle", "models"])).toEqual(["openai/b", "anthropic/c"])
    expect(readEditorValue(session, ["agents", "oracle", "model"])).toBeUndefined()
    expect(readFileSync(path, "utf-8")).toContain('"model":"openai/a"')
    saveEditorSession(session)
    expect(readFileSync(path, "utf-8")).toContain('"models"')
    expect(isEditorModified(session)).toBe(false)
  })

  test("new unrecognized shared keys are refused while unrelated existing unknown fields remain editable around", () => {
    const { path } = fixture('{"future_setting":true,"agents":{"oracle":{"future_agent_setting":true,"model":"openai/a"}}}')
    const session = openEditorSession(path, "project")
    expect(() => setEditorValue(session, ["agents", "oracle", "category"], "deep")).toThrow("Unrecognized")
    expect(() => setEditorValue(session, ["default_run_agent"], "sisyphus")).toThrow("Unrecognized")
    setEditorValue(session, ["agents", "oracle", "model"], "openai/b")
    saveEditorSession(session)
    expect(readEditorValue(session, ["future_setting"])).toBe(true)
    expect(readEditorValue(session, ["agents", "oracle", "future_agent_setting"])).toBe(true)
  })

  test("profile OpenCode blocks validate against the adapter schema", () => {
    const { path } = fixture('{"profiles":{"work":{"[opencode]":{"agents":{"oracle":{"temperature":0.3}}}}}}')
    const session = openEditorSession(path, "project")
    expect(() => setEditorValue(session, ["profiles", "work", "[opencode]", "agents", "oracle", "temperature"], 8)).toThrow("temperature")
    expect(isEditorModified(session)).toBe(false)
    setEditorValue(session, ["profiles", "work", "[opencode]", "agents", "oracle", "category"], "deep")
    saveEditorSession(session)
    expect(readEditorValue(session, ["profiles", "work", "[opencode]", "agents", "oracle", "category"])).toBe("deep")
  })

  test("new unknown OpenCode fields are refused at root, nested agent and profile paths", () => {
    const original = '{"[opencode]":{"future_key":true,"agents":{"oracle":{"future_agent_key":true,"temperature":0.3}}},"profiles":{"work":{"[opencode]":{"future_profile_key":true}}}}'
    const { path } = fixture(original)
    const session = openEditorSession(path, "project")
    for (const field of [
      ["[opencode]", "nonsense"],
      ["[opencode]", "agents", "oracle", "nonsense"],
      ["profiles", "work", "[opencode]", "nonsense"],
    ]) {
      expect(() => setEditorValue(session, field, true)).toThrow("Unrecognized")
    }
    expect(isEditorModified(session)).toBe(false)
    setEditorValue(session, ["[opencode]", "agents", "oracle", "temperature"], 0.5)
    saveEditorSession(session)
    expect(readEditorValue(session, ["[opencode]", "future_key"])).toBe(true)
    expect(readEditorValue(session, ["[opencode]", "agents", "oracle", "future_agent_key"])).toBe(true)
    expect(readEditorValue(session, ["profiles", "work", "[opencode]", "future_profile_key"])).toBe(true)
  })

  test("generic parent-object replacements cannot introduce unknown OpenCode descendants", () => {
    const { path } = fixture("{}")
    const session = openEditorSession(path, "project")
    expect(() => setEditorValue(session, ["[opencode]"], { agents: { oracle: { nonsense: true } } })).toThrow("Unrecognized")
    expect(() => setEditorValue(session, ["profiles", "work"], { "[opencode]": { nonsense: true } })).toThrow("Unrecognized")
    expect(isEditorModified(session)).toBe(false)
  })

  test("prototype-related keys cannot be edited or introduced through nested values", () => {
    const { path } = fixture("{}")
    const session = openEditorSession(path, "project")
    for (const key of ["__proto__", "prototype", "constructor"]) {
      expect(() => setEditorValue(session, ["agents", key, "model"], "openai/a")).toThrow()
      expect(() => setEditorValue(session, ["agents"], JSON.parse(`{"${key}":{"model":"openai/a"}}`))).toThrow()
    }
    expect(isEditorModified(session)).toBe(false)
  })

  test("external edits prevent saving and remain untouched", () => {
    const { path } = fixture("{}")
    const session = openEditorSession(path, "project")
    setEditorValue(session, ["agents", "oracle", "model"], "openai/a")
    writeFileSync(path, '{"external":true}')
    expect(() => saveEditorSession(session)).toThrow("changed on disk")
    expect(readFileSync(path, "utf-8")).toBe('{"external":true}')
    expect(readdirSync(dirname(path))).toEqual(["omo.jsonc"])
    expect(isEditorModified(session)).toBe(true)
  })

  test("a conflict immediately before rename prevents replacement and cleans up the temporary file", () => {
    const { path } = fixture("{}")
    const session = openEditorSession(path, "project")
    setEditorValue(session, ["agents", "oracle", "model"], "openai/a")
    expect(() => saveEditorSession(session, { fileSystem: {
      ...DEFAULT_WRITE_FILE_SYSTEM,
      writeFileExclusiveSync(target, content) {
        DEFAULT_WRITE_FILE_SYSTEM.writeFileExclusiveSync(target, content)
        if (target.endsWith(".tmp")) writeFileSync(path, '{"external":true}')
      },
    } })).toThrow("changed on disk")
    expect(readFileSync(path, "utf-8")).toBe('{"external":true}')
    expect(readdirSync(dirname(path)).some((entry) => entry.endsWith(".tmp"))).toBe(false)
  })

  test("backup errors abort the save while retaining original and staged edits", () => {
    const { path } = fixture("{}")
    const session = openEditorSession(path, "project")
    setEditorValue(session, ["agents", "oracle", "model"], "openai/a")
    expect(() => saveEditorSession(session, { fileSystem: {
      ...DEFAULT_WRITE_FILE_SYSTEM,
      writeFileExclusiveSync() { throw new Error("EACCES backup denied") },
    } })).toThrow("backup")
    expect(readFileSync(path, "utf-8")).toBe("{}")
    expect(isEditorModified(session)).toBe(true)
  })

  test("the saved file and backup preserve restrictive permissions", () => {
    const { path } = fixture("{}")
    chmodSync(path, 0o600)
    const session = openEditorSession(path, "project")
    setEditorValue(session, ["agents", "oracle", "model"], "openai/a")
    const result = saveEditorSession(session)
    expect(lstatSync(path).mode & 0o777).toBe(0o600)
    if (result.backupPath === undefined) throw new Error("Expected a backup after saving edits.")
    expect(lstatSync(result.backupPath).mode & 0o777).toBe(0o600)
  })

  test("new files are created only on save with private permissions", () => {
    const { path } = fixture()
    const session = openEditorSession(path, "project")
    expect(existsSync(path)).toBe(false)
    saveEditorSession(session)
    expect(existsSync(path)).toBe(false)
    setEditorValue(session, ["agents", "oracle", "model"], "openai/a")
    expect(saveEditorSession(session).backupPath).toBeUndefined()
    expect(lstatSync(path).mode & 0o777).toBe(0o600)
  })

  test("symbolic-link targets and project directories are refused", () => {
    const { root, path } = fixture("{}")
    const linkedFile = join(root, "linked.jsonc")
    symlinkSync(path, linkedFile)
    expect(() => openEditorSession(linkedFile, "project")).toThrow("symbolic link")
    const linkedDirectory = join(root, "linked")
    symlinkSync(dirname(path), linkedDirectory)
    expect(() => openEditorSession(join(linkedDirectory, "omo.jsonc"), "project")).toThrow("symbolic link")
  })

  test("target discovery keeps ancestor and user sources and adds a local creation target", () => {
    const { root, path } = fixture("{}")
    const project = join(root, "project", "nested")
    mkdirSync(project)
    const targets = discoverEditorTargets(project, { HOME: root })
    expect(targets).toContainEqual({ path, scope: "project", exists: true })
    expect(targets).toContainEqual({ path: join(root, ".omo", "omo.jsonc"), scope: "user", exists: false })
    expect(targets).toContainEqual({ path: join(project, ".omo", "omo.jsonc"), scope: "project", exists: false })
  })
})
