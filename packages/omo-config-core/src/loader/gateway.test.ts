import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { readUserGatewaySection } from "./gateway"
import { loadOmoConfig } from "./loader"

const GATEWAY = { scopes: [{ id: "qa" }] }
const roots: string[] = []

function fixture(): { home: string; project: string; env: { HOME: string } } {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "omo-gateway-loader-")))
  roots.push(home)
  const project = join(home, "repo")
  mkdirSync(join(home, ".omo"), { recursive: true })
  mkdirSync(join(project, ".omo"), { recursive: true })
  return { home, project, env: { HOME: home } }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("gateway is read from the user config only", () => {
  test("#given gateway in the user omo.jsonc #when loaded #then the merged config carries it", () => {
    // given
    const { home, project, env } = fixture()
    writeFileSync(join(home, ".omo", "omo.jsonc"), `// user config\n${JSON.stringify({ gateway: GATEWAY })}`)

    // when
    const result = loadOmoConfig({ cwd: project, env })

    // then
    expect(result.config.gateway).toEqual(GATEWAY)
    expect(result.diagnostics.filter((diagnostic) => diagnostic.kind === "ignored-keys")).toEqual([])
  })

  test("#given gateway in a project layer #when loaded #then it is dropped with an ignored-keys diagnostic and the rest applies", () => {
    // given
    const { project, env } = fixture()
    const projectPath = join(project, ".omo", "omo.jsonc")
    writeFileSync(projectPath, JSON.stringify({
      gateway: { scopes: [{ surfaces: [{ platform: "irc" }] }] },
      "[native]": { gateway: GATEWAY },
      disabled_skills: ["kept"],
    }))

    // when
    const result = loadOmoConfig({ cwd: project, env })

    // then
    expect(result.config.gateway).toBeUndefined()
    expect(result.config.disabled_skills).toEqual(["kept"])
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      kind: "ignored-keys",
      path: projectPath,
      issuePaths: ["gateway", "[native].gateway"],
    }))
  })

  test("#given gateway in a user profile or a non-native block #when loaded with that profile #then it is dropped and reported", () => {
    // given
    const { home, project, env } = fixture()
    const userPath = join(home, ".omo", "omo.json")
    writeFileSync(userPath, JSON.stringify({
      "[codex]": { gateway: GATEWAY },
      profiles: { work: { gateway: GATEWAY, "[native]": { gateway: GATEWAY } } },
    }))

    // when
    const result = loadOmoConfig({ cwd: project, env, profile: "work", harness: "native" })

    // then
    expect(result.config.gateway).toBeUndefined()
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      kind: "ignored-keys",
      path: userPath,
      issuePaths: ["[codex].gateway", "profiles.work.gateway", "profiles.work.[native].gateway"],
    }))
  })

  test("#given the user section at the top level, in [native] and in legacy [senpi] #when read raw #then the native view folds them", () => {
    // given
    const { home, env } = fixture()
    writeFileSync(join(home, ".omo", "omo.jsonc"), `{
      // comments and trailing commas are JSONC
      "gateway": { "scopes": [{ "id": "base" }] },
      "[senpi]": { "gateway": { "stt": { "provider": "p", "credentials_env": "E" } } },
      "[native]": { "gateway": { "scopes": [{ "id": "native" }] } },
    }`)

    // when
    const section = readUserGatewaySection({ env })

    // then
    expect(section).toEqual({
      path: join(home, ".omo", "omo.jsonc"),
      present: true,
      value: { scopes: [{ id: "native" }], stt: { provider: "p", credentials_env: "E" } },
    })
  })

  test("#given only omo.json, no file, or an unparseable file #when read raw #then presence follows the loader's lookup", () => {
    // given
    const { home, env } = fixture()
    const jsonPath = join(home, ".omo", "omo.json")

    // when / then
    expect(readUserGatewaySection({ env })).toEqual({ path: join(home, ".omo", "omo.jsonc"), present: false })
    writeFileSync(jsonPath, JSON.stringify({ gateway: GATEWAY }))
    expect(readUserGatewaySection({ env })).toEqual({ path: jsonPath, present: true, value: GATEWAY })
    writeFileSync(jsonPath, "{ not json")
    expect(readUserGatewaySection({ env })).toEqual({ path: jsonPath, present: false })
  })
})
