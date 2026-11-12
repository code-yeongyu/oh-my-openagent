/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { chmodSync, mkdirSync, readdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs"
import { userInfo } from "node:os"

import { DEFAULT_WRITE_FILE_SYSTEM } from "@oh-my-opencode/omo-config-core"
import { join } from "node:path"

import { testTempDir } from "../../../test-support/temp-dir"
import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import type { ComponentContext } from "../../extension/types"
import { createModelProfileComponent } from "./index"
import * as projectModelProfileRpc from "./project-model-profile-rpc"
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
    for (const modelProfile of ["not-a-profile", "provider/", "/model", " daily-heavy", "a/b\nc", "a/b\u2028c", "a/\u202eb", "a/\u200bb", "a/b\ufe0f", "a/\u034fb", "a/\u3164b", "a/\u0301b", "a/\ud800b", 42, "x".repeat(201)]) {
      expect(setProjectModelProfile(trusted(cwd), { modelProfile })).toMatchObject({
        kind: "refused",
        code: "invalid_model_profile",
      })
    }
    expect(configText(cwd)).toBe(COMMENTED)
  })

  test("#given repeated sets #when each succeeds #then no backup copies are left in .omo", () => {
    const cwd = folder(COMMENTED)
    for (const modelProfile of ["daily-heavy", "a/b", null, "daily-normal", "c/d"])
      expect(setProjectModelProfile(trusted(cwd), { modelProfile }).kind).toBe("ok")
    expect(readdirSync(join(cwd, ".omo")).sort()).toEqual(["omo.jsonc"])
  })

  test("#given the session folder is HOME #when either verb runs #then it is refused and the user layer is untouched", () => {
    const home = folder(COMMENTED)
    const previous = process.env.HOME
    process.env.HOME = home
    try {
      expect(setProjectModelProfile(trusted(home), { modelProfile: "a/b" })).toMatchObject({ kind: "refused", code: "home_folder" })
      expect(getProjectModelProfile(trusted(home))).toMatchObject({ kind: "refused", code: "home_folder" })
      expect(configText(home)).toBe(COMMENTED)
    } finally {
      if (previous === undefined) delete process.env.HOME
      else process.env.HOME = previous
    }
  })

  test("#given HOME through an alias #when a pin is set #then it is refused as the home folder", () => {
    const home = folder(COMMENTED)
    const link = join(folder(), "home-link")
    symlinkSync(home, link)
    const previous = process.env.HOME
    process.env.HOME = home
    try {
      for (const cwd of [link, `${home}/`, join(home, "sub", "..")])
        expect(setProjectModelProfile(trusted(cwd), { modelProfile: "a/b" })).toMatchObject({ kind: "refused", code: "home_folder" })
      expect(configText(home)).toBe(COMMENTED)
    } finally {
      if (previous === undefined) delete process.env.HOME
      else process.env.HOME = previous
    }
  })

  test("#given the account home while HOME points elsewhere #when a pin is set #then it is refused as the home folder", () => {
    const previous = process.env.HOME
    process.env.HOME = folder()
    try {
      expect(setProjectModelProfile(trusted(userInfo().homedir), { modelProfile: "a/b" })).toMatchObject({
        kind: "refused",
        code: "home_folder",
      })
    } finally {
      if (previous === undefined) delete process.env.HOME
      else process.env.HOME = previous
    }
  })

  test("#given a write that fails after the backup #when set #then no backup is left and the file is intact", () => {
    const cwd = folder(COMMENTED)
    chmodSync(join(cwd, ".omo"), 0o500)
    try {
      expect(setProjectModelProfile(trusted(cwd), { modelProfile: "a/b" }).kind).toBe("refused")
    } finally {
      chmodSync(join(cwd, ".omo"), 0o700)
    }
    expect(readdirSync(join(cwd, ".omo")).sort()).toEqual(["omo.jsonc"])
    expect(configText(cwd)).toBe(COMMENTED)
  })

  test("#given the rename fails after the backup was written #when set #then no backup is left and the file is intact", () => {
    const cwd = folder(COMMENTED)
    const failingRename = { ...DEFAULT_WRITE_FILE_SYSTEM, renameSync: () => { throw new Error("rename refused") } }

    const reply = setProjectModelProfile(trusted(cwd), { modelProfile: "a/b" }, { fileSystem: failingRename })

    expect(reply).toMatchObject({ kind: "refused", code: "project_config_write_failed" })
    expect(readdirSync(join(cwd, ".omo")).filter((name) => !name.endsWith(".tmp")).sort()).toEqual(["omo.jsonc"])
    expect(configText(cwd)).toBe(COMMENTED)
  })

  test("#given removing the backup fails after the write landed #when set #then the write is reported as landed", () => {
    const cwd = folder(COMMENTED)

    const reply = setProjectModelProfile(trusted(cwd), { modelProfile: "a/b" }, {
      removeFile: () => {
        throw new Error("cleaner raced us")
      },
    })

    expect(reply).toMatchObject({ kind: "ok", modelProfile: "a/b", backupNotRemoved: "cleaner raced us" })
    expect(configText(cwd)).toContain('"model_profile": "a/b"')
  })

  test("#given another account's home folder #when a pin is set #then it is refused and nothing is written", () => {
    const other = join(folder(), "someone-else")
    mkdirSync(join(other, ".omo"), { recursive: true })
    writeFileSync(join(other, ".omo", "omo.jsonc"), COMMENTED)

    const reply = setProjectModelProfile(trusted(other), { modelProfile: "a/b" }, { accountHomes: () => [other] })

    expect(reply).toMatchObject({ kind: "refused", code: "home_folder" })
    expect(readFileSync(join(other, ".omo", "omo.jsonc"), "utf8")).toBe(COMMENTED)
  })

  test("#given a backup copy made earlier by someone else #when a pin is set #then that copy stays", () => {
    const cwd = folder(COMMENTED)
    writeFileSync(join(cwd, ".omo", "omo.jsonc.bak.2020-01-01T00-00-00-000Z"), "theirs")

    expect(setProjectModelProfile(trusted(cwd), { modelProfile: "a/b" }).kind).toBe("ok")

    expect(readdirSync(join(cwd, ".omo")).sort()).toEqual(["omo.jsonc", "omo.jsonc.bak.2020-01-01T00-00-00-000Z"])
    expect(readFileSync(join(cwd, ".omo", "omo.jsonc.bak.2020-01-01T00-00-00-000Z"), "utf8")).toBe("theirs")
  })

  test("#given another writer's backup made during this write #when a pin is set #then that copy stays", () => {
    const cwd = folder(COMMENTED)
    const theirs = join(cwd, ".omo", "omo.jsonc.bak.concurrent-writer")
    const concurrentWriter = {
      ...DEFAULT_WRITE_FILE_SYSTEM,
      renameSync: (from: string, to: string) => {
        writeFileSync(theirs, "theirs")
        DEFAULT_WRITE_FILE_SYSTEM.renameSync(from, to)
      },
    }

    expect(setProjectModelProfile(trusted(cwd), { modelProfile: "a/b" }, { fileSystem: concurrentWriter }).kind).toBe("ok")

    expect(readdirSync(join(cwd, ".omo")).sort()).toEqual(["omo.jsonc", "omo.jsonc.bak.concurrent-writer"])
    expect(readFileSync(theirs, "utf8")).toBe("theirs")
  })

  test("#given a folder beside an account home in a shared parent #when a pin is set #then it is written", () => {
    const shared = folder()
    const home = join(shared, "home")
    const work = join(shared, "workspace")
    mkdirSync(home)
    mkdirSync(work)

    const reply = setProjectModelProfile(trusted(work), { modelProfile: "a/b" }, { accountHomes: () => [home] })

    expect(reply).toMatchObject({ kind: "ok", modelProfile: "a/b" })
  })

  test("#given an account home outside any shared accounts folder #when a pin is set there or through an alias #then it is refused", () => {
    const serviceHome = join(folder(), "var", "lib", "svc")
    mkdirSync(join(serviceHome, ".omo"), { recursive: true })
    writeFileSync(join(serviceHome, ".omo", "omo.jsonc"), COMMENTED)
    const alias = join(folder(), "svc-link")
    symlinkSync(serviceHome, alias)

    for (const cwd of [serviceHome, alias])
      expect(setProjectModelProfile(trusted(cwd), { modelProfile: "a/b" }, { accountHomes: () => [serviceHome] })).toMatchObject({
        kind: "refused",
        code: "home_folder",
      })
    expect(readFileSync(join(serviceHome, ".omo", "omo.jsonc"), "utf8")).toBe(COMMENTED)
  })

  test("#given the system user database #when account homes are read from it #then every listed home is returned", () => {
    const { homesFromPasswd, homesFromDscl } = projectModelProfileRpc
    expect(
      homesFromPasswd(
        "# comment\nroot:x:0:0:root:/root:/bin/bash\nsvc:x:998:998::/var/lib/svc:/usr/sbin/nologin\nnobody:x:65534:65534:nobody:/nonexistent:/usr/sbin/nologin\nbroken-line\n\n",
      ),
    ).toStrictEqual(["/root", "/var/lib/svc", "/nonexistent"])
    expect(homesFromDscl("_www                    /Library/WebServer\nroot                    /var/root\nq                       /Users/q name\n")).toStrictEqual([
      "/Library/WebServer",
      "/var/root",
      "/Users/q name",
    ])
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
