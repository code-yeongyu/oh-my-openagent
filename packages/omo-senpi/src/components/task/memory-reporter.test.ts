import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { loadOmoConfig } from "@oh-my-opencode/omo-config-core"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { composeTaskEngine } from "./engine"
import { registerTaskMemoryReporter } from "./memory-reporter"

const tempRoots: string[] = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

type Reporter = () => Readonly<Record<string, number>>

// oh-my-openagent#9442: the task-child layer joins senpi's on-demand memory report. The report itself
// is installed only with SENPI_MEMORY_REPORT=1, so registering costs nothing until a report is taken.
describe("registerTaskMemoryReporter", () => {
  test("#given a host with the memory report API #when a report is taken #then it reads resident children and cached records", () => {
    // given
    const registered = new Map<string, Reporter>()
    const pi = { registerMemoryReporter: (name: string, reporter: Reporter) => void registered.set(name, reporter) }
    let resident = ["st_1", "st_2"]
    registerTaskMemoryReporter(pi, {
      residentTaskIds: () => resident,
      residentFigures: () => ({ cachedRecords: 5, cachedRecordBytes: 4096, openEventLogs: 1 }),
    })
    resident = ["st_1", "st_2", "st_3"]

    // when
    const figures = registered.get("omoTask")?.()

    // then
    expect(figures).toEqual({ residentChildren: 3, cachedRecords: 5, cachedRecordBytes: 4096, openEventLogs: 1 })
  })

  test("#given a host without the memory report API #when registering #then nothing is registered and nothing throws", () => {
    // given
    const pi = {}

    // when
    const register = () =>
      registerTaskMemoryReporter(pi, {
        residentTaskIds: () => [],
        residentFigures: () => ({ cachedRecords: 0, cachedRecordBytes: 0, openEventLogs: 0 }),
      })

    // then
    expect(register).not.toThrow()
  })
})

class ReportingExtensionAPI extends FakeExtensionAPI {
  readonly memoryReporters = new Map<string, Reporter>()
  registerMemoryReporter(name: string, reporter: Reporter): void {
    this.memoryReporters.set(name, reporter)
  }
}

describe("composeTaskEngine memory reporter", () => {
  test("#given a composed engine #when a report is taken after a task event #then the omoTask section reads the live store", () => {
    // given
    const cwd = mkdtempSync(join(tmpdir(), "omo-senpi-task-memory-reporter-"))
    tempRoots.push(cwd)
    const pi = new ReportingExtensionAPI()
    const engine = composeTaskEngine({ pi, omoConfig: loadOmoConfig({ cwd }).config, cwd, sharedParentTools: () => [] })
    tempRoots.push(engine.stateDir)
    engine.appendTaskEvent("st_0000e001", { type: "probe", payload: {} })

    // when
    const figures = pi.memoryReporters.get("omoTask")?.()

    // then
    expect(figures).toEqual({ residentChildren: 0, cachedRecords: 0, cachedRecordBytes: 0, openEventLogs: 1 })
  })
})
