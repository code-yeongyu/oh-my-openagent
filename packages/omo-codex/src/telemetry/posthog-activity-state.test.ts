import { afterEach, describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { CACHE_DIR_NAME } from "./product-identity"

const originalXdgDataHome = process.env.XDG_DATA_HOME
const tempPaths: string[] = []

function createDataHomePath(): string {
  const tempPath = mkdtempSync(join(tmpdir(), "omo-codex-posthog-state-"))
  tempPaths.push(tempPath)
  return tempPath
}

async function importPostHogActivityStateModule() {
  return import(`./posthog-activity-state?test=${Date.now()}-${Math.random()}`)
}

function getStateFilePath(dataHomePath: string): string {
  return join(dataHomePath, CACHE_DIR_NAME, "posthog-activity.json")
}

afterEach(() => {
  for (const tempPath of tempPaths.splice(0)) {
    rmSync(tempPath, { recursive: true, force: true })
  }

  if (originalXdgDataHome === undefined) {
    delete process.env.XDG_DATA_HOME
    return
  }

  process.env.XDG_DATA_HOME = originalXdgDataHome
})

describe("getPostHogActivityCaptureState", () => {
  it("creates state file and captures daily when no state file exists", async () => {
    // given
    const dataHomePath = createDataHomePath()
    process.env.XDG_DATA_HOME = dataHomePath
    const { getPostHogActivityCaptureState } = await importPostHogActivityStateModule()

    // when
    const result = getPostHogActivityCaptureState(new Date("2026-05-25T01:02:03.000Z"))

    // then
    expect(result).toEqual({
      dayUTC: "2026-05-25",
      captureDaily: true,
    })

    const stateFilePath = getStateFilePath(dataHomePath)
    const persistedState = JSON.parse(readFileSync(stateFilePath, "utf-8")) as {
      readonly lastActiveDayUTC?: string
    }
    expect(persistedState.lastActiveDayUTC).toBe("2026-05-25")
  })

  it("does not capture daily and does not rewrite file when state has today's UTC day", async () => {
    // given
    const dataHomePath = createDataHomePath()
    const stateFilePath = getStateFilePath(dataHomePath)
    mkdirSync(join(dataHomePath, CACHE_DIR_NAME), { recursive: true })
    const originalStateContent = '{"lastActiveDayUTC":"2026-05-25"}\n'
    writeFileSync(stateFilePath, originalStateContent)
    process.env.XDG_DATA_HOME = dataHomePath
    const { getPostHogActivityCaptureState } = await importPostHogActivityStateModule()

    // when
    const result = getPostHogActivityCaptureState(new Date("2026-05-25T10:20:30.000Z"))

    // then
    expect(result).toEqual({
      dayUTC: "2026-05-25",
      captureDaily: false,
    })

    const stateContentAfterCall = readFileSync(stateFilePath, "utf-8")
    expect(stateContentAfterCall).toBe(originalStateContent)
  })

  it("captures daily and updates state when state file has yesterday UTC day", async () => {
    // given
    const dataHomePath = createDataHomePath()
    const stateFilePath = getStateFilePath(dataHomePath)
    mkdirSync(join(dataHomePath, CACHE_DIR_NAME), { recursive: true })
    writeFileSync(stateFilePath, '{"lastActiveDayUTC":"2026-05-24"}\n')
    process.env.XDG_DATA_HOME = dataHomePath
    const { getPostHogActivityCaptureState } = await importPostHogActivityStateModule()

    // when
    const result = getPostHogActivityCaptureState(new Date("2026-05-25T00:00:01.000Z"))

    // then
    expect(result).toEqual({
      dayUTC: "2026-05-25",
      captureDaily: true,
    })

    const persistedState = JSON.parse(readFileSync(stateFilePath, "utf-8")) as {
      readonly lastActiveDayUTC?: string
    }
    expect(persistedState.lastActiveDayUTC).toBe("2026-05-25")
  })

  it("captures daily and does not throw when state file has corrupted JSON", async () => {
    // given
    const dataHomePath = createDataHomePath()
    const stateFilePath = getStateFilePath(dataHomePath)
    mkdirSync(join(dataHomePath, CACHE_DIR_NAME), { recursive: true })
    writeFileSync(stateFilePath, "{bad-json\n")
    process.env.XDG_DATA_HOME = dataHomePath
    const { getPostHogActivityCaptureState } = await importPostHogActivityStateModule()

    // when
    const result = getPostHogActivityCaptureState(new Date("2026-05-25T10:20:30.000Z"))

    // then
    expect(result).toEqual({
      dayUTC: "2026-05-25",
      captureDaily: true,
    })
  })

  it("captures daily when state file has array payload", async () => {
    // given
    const dataHomePath = createDataHomePath()
    const stateFilePath = getStateFilePath(dataHomePath)
    mkdirSync(join(dataHomePath, CACHE_DIR_NAME), { recursive: true })
    writeFileSync(stateFilePath, "[]\n")
    process.env.XDG_DATA_HOME = dataHomePath
    const { getPostHogActivityCaptureState } = await importPostHogActivityStateModule()

    // when
    const result = getPostHogActivityCaptureState(new Date("2026-05-25T10:20:30.000Z"))

    // then
    expect(result).toEqual({
      dayUTC: "2026-05-25",
      captureDaily: true,
    })
  })

  it("captures daily when state file has numeric payload", async () => {
    // given
    const dataHomePath = createDataHomePath()
    const stateFilePath = getStateFilePath(dataHomePath)
    mkdirSync(join(dataHomePath, CACHE_DIR_NAME), { recursive: true })
    writeFileSync(stateFilePath, "42\n")
    process.env.XDG_DATA_HOME = dataHomePath
    const { getPostHogActivityCaptureState } = await importPostHogActivityStateModule()

    // when
    const result = getPostHogActivityCaptureState(new Date("2026-05-25T10:20:30.000Z"))

    // then
    expect(result).toEqual({
      dayUTC: "2026-05-25",
      captureDaily: true,
    })
  })
})
