import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { findPiConfigEdits, formatPiConfigLines, piConfigReport } from "../bin/lib/doctor-pi-config.js"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

type Home = { homeDir: string; agentDir: string; piAgentDir: string; copiedAt: number }

function writeAt(path: string, content: string, mtimeMs: number): void {
  writeFileSync(path, content)
  utimesSync(path, mtimeMs / 1000, mtimeMs / 1000)
}

function copiedHome(options: { recordCopyTime: boolean }): Home {
  const homeDir = mkdtempSync(join(tmpdir(), "omo-doctor-pi-config-"))
  roots.push(homeDir)
  const agentDir = join(homeDir, ".omo", "agent")
  const piAgentDir = join(homeDir, ".pi", "agent")
  mkdirSync(agentDir, { recursive: true })
  mkdirSync(piAgentDir, { recursive: true })
  const copiedAt = Date.parse("2026-09-01T00:00:00Z")
  for (const [file, content] of [["models.json", '{"providers":{}}\n'], ["settings.json", '{"theme":"dark"}\n']]) {
    writeAt(join(piAgentDir, file), content, copiedAt - 60_000)
    writeAt(join(agentDir, file), content, copiedAt - 60_000)
  }
  const state = options.recordCopyTime
    ? { schemaVersion: 1, completed: ["migrateLegacySenpiDirs"], legacyPiAgentDir: { copiedAt, noticedMtimes: {} } }
    : { schemaVersion: 1, completed: ["migrateLegacySenpiDirs", "restoreDrainedPiDirs"] }
  writeFileSync(join(agentDir, "migrations-state.json"), `${JSON.stringify(state)}\n`)
  return { homeDir, agentDir, piAgentDir, copiedAt }
}

describe("omo doctor config dir and ~/.pi/agent edits (#9173)", () => {
  test("#given an untouched copy #when reported #then only the active config dir is printed", () => {
    const home = copiedHome({ recordCopyTime: true })

    expect(piConfigReport({ agentDir: home.agentDir, homeDir: home.homeDir })).toEqual([`INFO config dir: ${home.agentDir}`])
  })

  test("#given models.json edited in ~/.pi/agent after the copy #when reported #then it is flagged with both exact paths", () => {
    const home = copiedHome({ recordCopyTime: true })
    writeAt(join(home.piAgentDir, "models.json"), '{"providers":{"mine":{}}}\n', home.copiedAt + 60_000)

    expect(piConfigReport({ agentDir: home.agentDir, homeDir: home.homeDir })).toEqual([
      `INFO config dir: ${home.agentDir}`,
      `WARN You edited ${join(home.piAgentDir, "models.json")} after omo moved to ${home.agentDir}; omo reads ${join(home.agentDir, "models.json")}. Copy your change there (or run: omo config import-pi models.json).`,
    ])
  })

  test("#given the same edit already carried into ~/.omo/agent #when checked #then nothing is flagged", () => {
    const home = copiedHome({ recordCopyTime: true })
    const content = '{"providers":{"mine":{}}}\n'
    writeAt(join(home.piAgentDir, "models.json"), content, home.copiedAt + 60_000)
    writeAt(join(home.agentDir, "models.json"), content, home.copiedAt + 90_000)

    expect(findPiConfigEdits({ agentDir: home.agentDir, homeDir: home.homeDir })).toEqual([])
  })

  test("#given an install copied before the copy time was recorded #when a pi file is newer than its copy #then it is flagged", () => {
    const home = copiedHome({ recordCopyTime: false })
    const agentMtime = statSync(join(home.agentDir, "settings.json")).mtimeMs
    writeAt(join(home.piAgentDir, "settings.json"), '{"theme":"light"}\n', agentMtime + 60_000)

    expect(findPiConfigEdits({ agentDir: home.agentDir, homeDir: home.homeDir }).map((edit) => edit.file)).toEqual(["settings.json"])
  })

  test("#given no ~/.pi/agent #when reported #then only the config dir line is printed", () => {
    const homeDir = mkdtempSync(join(tmpdir(), "omo-doctor-pi-config-none-"))
    roots.push(homeDir)
    const agentDir = join(homeDir, ".omo", "agent")

    expect(piConfigReport({ agentDir, homeDir })).toEqual([`INFO config dir: ${agentDir}`])
  })

  test("#given a flagged edit #when the report runs #then ~/.pi/agent is left byte-identical", () => {
    const home = copiedHome({ recordCopyTime: true })
    const piModels = join(home.piAgentDir, "models.json")
    writeAt(piModels, '{"providers":{"mine":{}}}\n', home.copiedAt + 60_000)
    const before = { content: readFileSync(piModels, "utf8"), mtimeMs: statSync(piModels).mtimeMs }

    formatPiConfigLines(home.agentDir, findPiConfigEdits({ agentDir: home.agentDir, homeDir: home.homeDir }))

    expect({ content: readFileSync(piModels, "utf8"), mtimeMs: statSync(piModels).mtimeMs }).toEqual(before)
  })
})
