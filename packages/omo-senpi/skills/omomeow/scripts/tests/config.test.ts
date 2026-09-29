import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { loadOmoMeowSettings, stripJsonc } from "../lib/config.mjs"

let home: string

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "omomeow-config-"))
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

function writeLayer(dir: string, name: string, content: string) {
  mkdirSync(join(dir, ".omo"), { recursive: true })
  writeFileSync(join(dir, ".omo", name), content)
}

describe("stripJsonc", () => {
  test("#given comments, trailing commas, and comment-like text in strings #when stripped #then JSON.parse keeps the strings intact", () => {
    const text = `{
      // line comment
      "url": "https://example.com/a//b", /* block */
      "list": [1, 2,],
    }`

    expect(JSON.parse(stripJsonc(text))).toEqual({ url: "https://example.com/a//b", list: [1, 2] })
  })
})

describe("loadOmoMeowSettings", () => {
  test("#given no config files #when loaded #then defaults apply", () => {
    const result = loadOmoMeowSettings({ cwd: home, env: { HOME: home } })

    expect(result.settings).toEqual({ language: "en", nudge: { enabled: true, interval_minutes: 30 } })
    expect(result.sources).toEqual([])
  })

  test("#given user and project layers #when loaded from inside the project #then the project wins key by key", () => {
    writeLayer(home, "omo.jsonc", `{ "omomeow": { "language": "ko", "nudge": { "interval_minutes": 45, "enabled": true } } }`)
    const project = join(home, "work", "repo")
    mkdirSync(join(project, "src"), { recursive: true })
    writeLayer(project, "omo.json", `{ "omomeow": { "nudge": { "interval_minutes": 10 } } }`)

    const result = loadOmoMeowSettings({ cwd: join(project, "src"), env: { HOME: home } })

    expect(result.settings).toEqual({ language: "ko", nudge: { enabled: true, interval_minutes: 10 } })
    expect(result.sources).toHaveLength(2)
  })

  test("#given invalid values #when loaded #then each falls back to its default with a diagnostic", () => {
    writeLayer(home, "omo.json", `{ "omomeow": { "language": "fr", "nudge": { "enabled": "yes", "interval_minutes": 0 } } }`)

    const result = loadOmoMeowSettings({ cwd: home, env: { HOME: home } })

    expect(result.settings).toEqual({ language: "en", nudge: { enabled: true, interval_minutes: 30 } })
    expect(result.diagnostics).toHaveLength(3)
  })

  test("#given an unparseable layer #when loaded #then it is skipped with a diagnostic", () => {
    writeLayer(home, "omo.json", `{ "omomeow": `)

    const result = loadOmoMeowSettings({ cwd: home, env: { HOME: home } })

    expect(result.settings.nudge.enabled).toBe(true)
    expect(result.diagnostics).toHaveLength(1)
  })
})
