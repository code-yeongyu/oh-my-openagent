import { afterEach, describe, expect, it } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import type { ComponentContext, ComponentLogger } from "../../extension/types"
import { loadSenpiOmoConfig } from "../config-resolution"
import { createTaskComponent } from "./index"

const tempRoots: string[] = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "omo-senpi-session-cwd-"))
  tempRoots.push(dir)
  return dir
}

function createLogger(): ComponentLogger {
  return { info: () => {}, warn: () => {}, error: () => {} }
}

function ctxFor(pi: FakeExtensionAPI, logger: ComponentLogger): ComponentContext {
  return { logger, config: { getFlag: (name) => pi.getFlag(name) }, getCapturedTools: () => [] }
}

// senpi builds one ExtensionAPI per session and loads the extension with THAT session's cwd. A
// multi-session host runs every session inside one process, so process.cwd() is the process launch
// directory - anchoring task state there makes every session share one store and puts child
// artifacts where the host's per-project readers never look.
describe("task component session cwd anchoring", () => {
  it("#given a host exposing the session cwd #when the component registers #then task state anchors at the session cwd, not the launch dir", async () => {
    // given a session whose cwd differs from the process launch dir
    const sessionCwd = tempProject()
    const pi = new FakeExtensionAPI()
    pi.cwd = sessionCwd
    const anchored: (string | undefined)[] = []

    // when
    await createTaskComponent({
      loadConfig: (options = {}) => {
        anchored.push(options.cwd)
        return loadSenpiOmoConfig(options)
      },
    }).register(pi, ctxFor(pi, createLogger()))

    // then
    expect(anchored[0]).toBe(sessionCwd)
    expect(anchored[0]).not.toBe(process.cwd())
  })

  it("#given a host that does not expose a session cwd #when the component registers #then it falls back to the process cwd", async () => {
    // given an older senpi host whose ExtensionAPI has no cwd
    const pi = new FakeExtensionAPI()
    const anchored: (string | undefined)[] = []

    // when
    await createTaskComponent({
      loadConfig: (options = {}) => {
        anchored.push(options.cwd)
        return loadSenpiOmoConfig(options)
      },
    }).register(pi, ctxFor(pi, createLogger()))

    // then
    expect(anchored[0]).toBe(process.cwd())
  })
})
