/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { mkdirSync, realpathSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { testTempDir } from "../../../test-support/temp-dir"
import { modelProfileLayer, viewProjectModelProfile } from "./project-model-profile-view"

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

  test("#given provider_options secrets in model_profiles entries the schema accepts #when viewed #then only the resolver's fields leave the machine", () => {
    const homeDir = home()
    const folder = join(homeDir, "work", "secret")
    mkdirSync(folder, { recursive: true })
    const secretEntry = (model: string) => ({
      model,
      reasoning: "high",
      provider_options: {
        apiKey: "sk-should-not-leave",
        headers: { Authorization: "Bearer sk-should-not-leave" },
        baseURL: "https://user:sk-should-not-leave@gateway.example/v1",
      },
    })
    writeConfig(homeDir, JSON.stringify({
      model_profiles: { mine: { display_name: "Mine", family: "daily", models: ["a/b", secretEntry("a/c")] } },
      model_pad: { labels: { daily: "Day" } },
      profiles: { opus: { "[native]": { model_profiles: { deep: { tier: "heavy", models: [secretEntry("a/d")] } } } } },
    }))
    writeConfig(folder, JSON.stringify({ "[senpi]": { model_profiles: { local: { models: [secretEntry("a/e")] } } } }))

    const reply = viewProjectModelProfile({ cwd: folder }, { env: { HOME: homeDir, OMO_PROFILE: "opus" } })

    expect(reply).toStrictEqual({
      kind: "ok",
      layers: {
        user: {
          model_profiles: { mine: { display_name: "Mine", family: "daily", models: ["a/b", { model: "a/c", reasoning: "high" }] } },
          model_pad: { labels: { daily: "Day" } },
          profiles: { opus: { "[senpi]": { model_profiles: { deep: { tier: "heavy", models: [{ model: "a/d", reasoning: "high" }] } } } } },
        },
        project: { "[senpi]": { model_profiles: { local: { models: [{ model: "a/e", reasoning: "high" }] } } } },
        activeProfile: "opus",
      },
    })
    expect(JSON.stringify(reply)).not.toContain("sk-should-not-leave")
  })

  test("#given models entries written with the deprecated reasoningEffort or variant #when viewed #then each arrives with reasoning set the way the schema folds it", () => {
    const homeDir = home()
    const folder = join(homeDir, "work", "legacy")
    mkdirSync(folder, { recursive: true })
    writeConfig(homeDir, JSON.stringify({
      model_profiles: {
        mine: {
          models: [
            { model: "a/f", reasoningEffort: "high", providerOptions: { apiKey: "sk-should-not-leave" } },
            { model: "a/g", variant: "low" },
            { model: "a/h", reasoning: "medium", variant: "low" },
          ],
        },
      },
    }))

    const reply = viewProjectModelProfile({ cwd: folder }, { env: { HOME: homeDir } })

    expect(reply).toStrictEqual({
      kind: "ok",
      layers: {
        user: {
          model_profiles: {
            mine: {
              models: [
                { model: "a/f", reasoning: "high" },
                { model: "a/g", reasoning: "low" },
                { model: "a/h", reasoning: "medium" },
              ],
            },
          },
        },
      },
    })
    expect(JSON.stringify(reply)).not.toContain("sk-should-not-leave")
  })

  // The loader already strips keys the strict model_pad schema rejects, so a file cannot carry one this far;
  // the projection is pinned on its own so it never falls back to copying whatever a layer holds.
  test("#given model_pad and its labels carry keys a resolver never reads #when a layer is projected #then only labels and the four axis words survive", () => {
    const layer = modelProfileLayer({
      model_pad: { labels: { daily: "Day", obsessive: "sk-should-not-leave" }, slots: { token: "sk-should-not-leave" } },
      "[native]": { model_pad: { labels: { heavy: "Big", extra: "sk-should-not-leave" }, extra: "sk-should-not-leave" } },
    })

    expect(layer).toStrictEqual({
      model_pad: { labels: { daily: "Day" } },
      "[senpi]": { model_pad: { labels: { heavy: "Big" } } },
    })
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
