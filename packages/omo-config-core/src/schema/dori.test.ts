import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { loadOmoConfig } from "../loader"
import { OmoConfigLayerSchema, OmoConfigSchema } from "./config"

/**
 * omo keeps only a permissive `dori` key: the section belongs to a separately installed package
 * that validates it, so omo accepts any object there, passes it through untouched, and rejects only
 * a non-object.
 */

const SECTION = { scopes: [{ id: "qa", surfaces: [{ platform: "slack", account_id: "T000TEST", options: { token_kind: "app" } }] }], stt: { provider: "p" } }
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function userConfig(content: string): { cwd: string; env: { HOME: string } } {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "omo-config-dori-")))
  roots.push(home)
  mkdirSync(join(home, ".omo"), { recursive: true })
  mkdirSync(join(home, "repo"), { recursive: true })
  writeFileSync(join(home, ".omo", "omo.jsonc"), content)
  return { cwd: join(home, "repo"), env: { HOME: home } }
}

describe("the dori key", () => {
  test("#given any dori object #when the root, layer and [native] schemas parse it #then it is accepted as is", () => {
    // given
    const document = { dori: SECTION, "[native]": { dori: SECTION } }

    // when
    const root = OmoConfigSchema.safeParse(document)
    const layer = OmoConfigLayerSchema.safeParse(document)

    // then
    expect(root.success).toBe(true)
    expect(layer.success).toBe(true)
    expect(root.data?.dori).toEqual(SECTION)
  })

  test("#given a non-object dori #when parsed #then it is rejected at dori", () => {
    // given / when
    const result = OmoConfigLayerSchema.safeParse({ dori: ["not", "an", "object"] })

    // then
    expect(result.success).toBe(false)
    expect(result.error?.issues.map((issue) => issue.path.join("."))).toEqual(["dori"])
  })

  test("#given a user omo.jsonc with a dori section #when loaded #then it loads without diagnostics and the section passes through", () => {
    // given
    const at = userConfig(`// user config\n${JSON.stringify({ dori: SECTION, disabled_skills: ["kept"] })}`)

    // when
    const result = loadOmoConfig({ cwd: at.cwd, env: at.env })

    // then
    expect(result.diagnostics).toEqual([])
    expect(result.config.dori).toEqual(SECTION)
    expect(result.config.disabled_skills).toEqual(["kept"])
  })
})
