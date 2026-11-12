/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { testTempDir } from "../../../test-support/temp-dir"
import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import type { ComponentContext } from "../../extension/types"
import { createModelProfileComponent } from "./index"
import {
  getProjectModelProfile,
  PROJECT_MODEL_PROFILE_GET,
  PROJECT_MODEL_PROFILE_SET,
  setProjectModelProfile,
} from "./project-model-profile-rpc"

const COMMENTED = `// project omo config
{
  // keep me
  "side_panel": { "enabled": true }
}
`

function folder(content?: string): string {
  const cwd = realpathSync(testTempDir("omo-project-model-profile-"))
  if (content !== undefined) {
    mkdirSync(join(cwd, ".omo"))
    writeFileSync(join(cwd, ".omo", "omo.jsonc"), content)
  }
  return cwd
}

const trusted = (cwd: string) => ({ cwd, isProjectTrusted: () => true })
const configText = (cwd: string) => readFileSync(join(cwd, ".omo", "omo.jsonc"), "utf8")

describe("project model_profile RPC (#13188)", () => {
  test("#given a trusted folder #when a pin is set #then only model_profile is written and read back", () => {
    const cwd = folder(COMMENTED)

    const reply = setProjectModelProfile(trusted(cwd), { modelProfile: "anthropic/claude-opus-5-5" })

    expect(reply).toMatchObject({ kind: "ok", exists: true, modelProfile: "anthropic/claude-opus-5-5", parseError: null })
    const text = configText(cwd)
    expect(text).toContain("// keep me")
    expect(text).toContain('"side_panel"')
    expect(getProjectModelProfile(trusted(cwd))).toMatchObject({ kind: "ok", modelProfile: "anthropic/claude-opus-5-5" })
  })

  test("#given a folder with no omo config #when a builtin profile is set #then the file is created with it", () => {
    const cwd = folder()

    const reply = setProjectModelProfile(trusted(cwd), { modelProfile: "daily-heavy" })

    expect(reply).toMatchObject({ kind: "ok", exists: true, modelProfile: "daily-heavy" })
    expect(JSON.parse(configText(cwd).replace(/^\/\/.*$/gmu, ""))).toEqual({ model_profile: "daily-heavy" })
  })

  test("#given a set profile #when null is set #then the key is removed and the rest kept", () => {
    const cwd = folder(COMMENTED)
    setProjectModelProfile(trusted(cwd), { modelProfile: "daily-heavy" })

    const reply = setProjectModelProfile(trusted(cwd), { modelProfile: null })

    expect(reply).toMatchObject({ kind: "ok", modelProfile: null })
    expect(configText(cwd)).not.toContain("model_profile")
    expect(configText(cwd)).toContain("// keep me")
  })

  test("#given an untrusted folder #when a pin is set #then it is refused and the file is untouched", () => {
    const cwd = folder(COMMENTED)

    const reply = setProjectModelProfile({ cwd, isProjectTrusted: () => false }, { modelProfile: "daily-heavy" })

    expect(reply).toMatchObject({ kind: "refused", code: "project_not_trusted" })
    expect(configText(cwd)).toBe(COMMENTED)
  })

  test("#given a file that does not parse #when a pin is set #then it is refused, untouched, and the read names the error", () => {
    const broken = '{ "side_panel": '
    const cwd = folder(broken)

    expect(setProjectModelProfile(trusted(cwd), { modelProfile: "daily-heavy" })).toMatchObject({
      kind: "refused",
      code: "project_config_parse_error",
    })
    expect(configText(cwd)).toBe(broken)
    const read = getProjectModelProfile(trusted(cwd))
    expect(read.kind === "ok" ? read.parseError : null).not.toBeNull()
  })

  test("#given a symlinked omo.jsonc #when a pin is set #then it is refused and the link target is untouched", () => {
    const cwd = folder()
    const target = join(folder(), "elsewhere.jsonc")
    writeFileSync(target, COMMENTED)
    mkdirSync(join(cwd, ".omo"))
    symlinkSync(target, join(cwd, ".omo", "omo.jsonc"))

    const reply = setProjectModelProfile(trusted(cwd), { modelProfile: "daily-heavy" })

    expect(reply.kind).toBe("refused")
    expect(readFileSync(target, "utf8")).toBe(COMMENTED)
  })

  test("#given values that are not a profile #when set #then each is refused before any write", () => {
    const cwd = folder(COMMENTED)
    for (const modelProfile of ["not-a-profile", "provider/", "/model", " daily-heavy", "a/b\nc", 42, "x".repeat(201)]) {
      expect(setProjectModelProfile(trusted(cwd), { modelProfile })).toMatchObject({
        kind: "refused",
        code: "invalid_model_profile",
      })
    }
    expect(configText(cwd)).toBe(COMMENTED)
  })

  test("#given no bound session #when either verb runs #then it answers no_session", () => {
    expect(getProjectModelProfile(undefined)).toMatchObject({ kind: "refused", code: "no_session" })
    expect(setProjectModelProfile(undefined, { modelProfile: "daily-heavy" })).toMatchObject({
      kind: "refused",
      code: "no_session",
    })
  })

  test("#given the model-profile component #when a session starts #then both verbs act on that session's folder and trust", async () => {
    const cwd = folder(COMMENTED)
    const handlers = new Map<string, (data: unknown) => unknown>()
    const pi = Object.assign(new FakeExtensionAPI(), {
      rpc: { emit() {}, handle: (name: string, handler: (data: unknown) => unknown) => handlers.set(name, handler) },
    })
    const context: ComponentContext = {
      config: { getFlag: () => undefined },
      logger: { error() {}, info() {}, warn() {} },
    }
    createModelProfileComponent({
      loadConfig: () => ({ config: {}, diagnostics: [], layers: [], sources: [] }),
    }).register(pi, context)
    let trust = false

    await pi.dispatch("session_start", { reason: "startup" }, { cwd, isProjectTrusted: () => trust, mode: "rpc" })

    expect(handlers.get(PROJECT_MODEL_PROFILE_SET)?.({ modelProfile: "daily-heavy" })).toMatchObject({
      kind: "refused",
      code: "project_not_trusted",
    })
    trust = true
    expect(handlers.get(PROJECT_MODEL_PROFILE_SET)?.({ modelProfile: "daily-heavy" })).toMatchObject({ kind: "ok" })
    expect(handlers.get(PROJECT_MODEL_PROFILE_GET)?.(undefined)).toMatchObject({
      kind: "ok",
      modelProfile: "daily-heavy",
    })
  })
})
