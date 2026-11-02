import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { toolkitContextFromEnv } from "./session-binding"

const env = { PI_SESSION_ID: "s1", PI_SESSION_CWD: "/w", PI_GOAL_STORE_FILE: "/g/s1.json" }
// The binder derives the fallback candidate with `path.join`, so the expectation is built from the same
// segments instead of a POSIX literal that Windows never produces.
const fallback = join("/w", ".omo", "goal", "s1.json")
const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function sessionFile(lines: string[]): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), "sdk-binding-"))
  roots.push(dir)
  const file = join(dir, "2026-09-16T00-00-00-000Z_s1.jsonl")
  writeFileSync(file, lines.join("\n"))
  return { dir, file }
}

test("#given documented env #when bound #then context and ordered candidates are explicit", () => {
  expect(toolkitContextFromEnv(env)).toEqual({ cwd: "/w", cwdSource: "PI_SESSION_CWD", sessionId: "s1", rawSessionId: "s1", surface: "omo-senpi", goalStorePaths: ["/g/s1.json", fallback], warnings: [] })
  expect(toolkitContextFromEnv({ ...env, PI_GOAL_STORE_FILE: fallback }).goalStorePaths).toEqual([fallback])
  expect(toolkitContextFromEnv({ ...env, PI_GOAL_STORE_FILE: undefined }).goalStorePaths).toEqual([fallback])
})

test("#given missing or invalid session ids #when bound #then domain codes fail closed", () => {
  for (const [input, code] of [
    [{ ...env, PI_SESSION_ID: undefined }, "ULW_LOOP_SESSION_ID_REQUIRED"],
    [{ ...env, PI_SESSION_ID: "  " }, "ULW_LOOP_SESSION_ID_REQUIRED"],
    [{ ...env, PI_SESSION_ID: ".." }, "ULW_LOOP_SESSION_ID_INVALID"],
  ] satisfies [Record<string, string | undefined>, string][]) {
    expect(() => toolkitContextFromEnv(input)).toThrow(expect.objectContaining({ name: "UlwLoopError", code }))
  }
})

test("#given PI_SESSION_CWD unset #when the session file header records a cwd #then that cwd binds with one remediation warning", () => {
  const { dir, file } = sessionFile([JSON.stringify({ type: "session", version: 3, id: "s1", cwd: "/session/root" }), JSON.stringify({ type: "message" })])
  const bound = toolkitContextFromEnv({ PI_SESSION_ID: "s1", PI_SESSION_FILE: file })
  expect(bound.cwd).toBe("/session/root")
  expect(bound.cwdSource).toBe("PI_SESSION_FILE")
  expect(bound.warnings).toHaveLength(1)
  expect(bound.warnings[0]).toContain('env("PI_SESSION_CWD", "/session/root")')
  expect(bound.goalStorePaths).toEqual([join(dir, "extensions", "goal", "s1.json"), join("/session/root", ".omo", "goal", "s1.json")])
})

test("#given PI_SESSION_CWD and a usable session file both unavailable #when bound #then process.cwd() binds with a warning naming the remediation", () => {
  const { file } = sessionFile(["{not json"])
  for (const input of [
    { PI_SESSION_ID: "s1" },
    { PI_SESSION_ID: "s1", PI_SESSION_FILE: join(tmpdir(), "sdk-binding-missing", "none.jsonl") },
    { PI_SESSION_ID: "s1", PI_SESSION_FILE: file },
  ]) {
    const bound = toolkitContextFromEnv(input)
    expect(bound.cwd).toBe(process.cwd())
    expect(bound.cwdSource).toBe("process.cwd")
    expect(bound.warnings).toHaveLength(1)
    expect(bound.warnings[0]).toContain('env("PI_SESSION_CWD"')
    expect(bound.warnings[0]).toContain(process.cwd())
  }
})

test("#given every cwd source fails #when bound #then the error names the remediation", () => {
  expect(() => toolkitContextFromEnv({ PI_SESSION_ID: "s1" }, () => { throw new Error("ENOENT: cwd deleted") })).toThrow(
    expect.objectContaining({ name: "UlwLoopError", code: "ULW_LOOP_CWD_REQUIRED", message: expect.stringContaining('env("PI_SESSION_CWD"') }),
  )
})

test("#given a relative goal-store override #when bound #then it is ignored with a warning and the derived candidates still apply", () => {
  const bound = toolkitContextFromEnv({ ...env, PI_GOAL_STORE_FILE: "relative.json" })
  expect(bound.goalStorePaths).toEqual([fallback])
  expect(bound.warnings).toHaveLength(1)
  const { dir, file } = sessionFile([JSON.stringify({ type: "session", cwd: "/w" })])
  expect(toolkitContextFromEnv({ ...env, PI_GOAL_STORE_FILE: "relative.json", PI_SESSION_FILE: file }).goalStorePaths).toEqual([join(dir, "extensions", "goal", "s1.json"), fallback])
})
