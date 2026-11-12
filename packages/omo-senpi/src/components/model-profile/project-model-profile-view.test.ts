/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { mkdirSync, realpathSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { testTempDir } from "../../../test-support/temp-dir"
import { viewProjectModelProfile } from "./project-model-profile-view"

function home(): string {
  return realpathSync(testTempDir("omo-model-profile-view-home-"))
}

function writeConfig(dir: string, text: string): void {
  mkdirSync(join(dir, ".omo"), { recursive: true })
  writeFileSync(join(dir, ".omo", "omo.jsonc"), text)
}

describe("project model_profile view (#13188)", () => {
  test("#given user and folder configs #when viewed #then each layer carries only the model-profile keys", () => {
    const homeDir = home()
    const folder = join(homeDir, "work", "app")
    mkdirSync(folder, { recursive: true })
    writeConfig(homeDir, JSON.stringify({
      model_profile: "daily-heavy",
      model_profiles: { mine: { models: ["a/b"] } },
      model_pad: { labels: { daily: "Day" } },
      mcp: { secret: { env: { TOKEN: "sk-should-not-leave" } } },
      profiles: { opus: { model_profile: "a/c", mcp: { x: { env: { K: "v" } } } } },
      "[senpi]": { model_profile: "geeky-normal", api_key: "nope" },
    }))
    writeConfig(folder, JSON.stringify({ model_profile: "a/d:high", side_panel: { enabled: true } }))

    const reply = viewProjectModelProfile({ cwd: folder }, { env: { HOME: homeDir, OMO_PROFILE: "opus" } })

    expect(reply).toStrictEqual({
      kind: "ok",
      layers: {
        user: {
          model_profile: "daily-heavy",
          model_profiles: { mine: { models: ["a/b"] } },
          model_pad: { labels: { daily: "Day" } },
          profiles: { opus: { model_profile: "a/c" } },
          "[senpi]": { model_profile: "geeky-normal" },
        },
        project: { model_profile: "a/d:high" },
        activeProfile: "opus",
      },
    })
    expect(JSON.stringify(reply)).not.toContain("sk-should-not-leave")
  })

  test("#given a folder with no omo config and no profile #when viewed #then only the user layer is sent", () => {
    const homeDir = home()
    const folder = join(homeDir, "work", "bare")
    mkdirSync(folder, { recursive: true })
    writeConfig(homeDir, JSON.stringify({ model_profile: "daily-normal" }))

    expect(viewProjectModelProfile({ cwd: folder }, { env: { HOME: homeDir } })).toStrictEqual({
      kind: "ok",
      layers: { user: { model_profile: "daily-normal" } },
    })
  })

  test("#given the folder is the home folder #when viewed #then the shared file is one user layer, never also a project layer", () => {
    const homeDir = home()
    writeConfig(homeDir, JSON.stringify({ model_profile: "a/b" }))

    expect(viewProjectModelProfile({ cwd: homeDir }, { env: { HOME: homeDir } })).toStrictEqual({
      kind: "ok",
      layers: { user: { model_profile: "a/b" } },
    })
  })

  test("#given no bound session #when viewed #then it answers no_session", () => {
    expect(viewProjectModelProfile(undefined)).toMatchObject({ kind: "refused", code: "no_session" })
  })
})
