/// <reference types="bun-types" />

import { afterAll, describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { loadSenpiOmoConfig } from "../config-resolution"
import { createSessionArming, createUltraworkComponent } from "./index"
import { createTestContext, dispatchInput, expectHiddenInjection, expectNoInjection } from "./ultrawork.test-support"

const root = mkdtempSync(join(tmpdir(), "omo-ulw-keyword-detector-"))
afterAll(() => rmSync(root, { recursive: true, force: true }))

function project(name: string, config: string | undefined): string {
  const dir = join(root, name)
  mkdirSync(join(dir, ".omo"), { recursive: true })
  if (config !== undefined) writeFileSync(join(dir, ".omo", "omo.jsonc"), config)
  return dir
}

async function registerIn(cwd: string): Promise<FakeExtensionAPI> {
  const pi = new FakeExtensionAPI()
  pi.cwd = cwd
  const home = join(root, "home")
  const loadSettings = (dir: string) => loadSenpiOmoConfig({ cwd: dir, env: { HOME: home } }).config.keyword_detector
  await createUltraworkComponent(createSessionArming(), loadSettings).register(pi, createTestContext(pi))
  return pi
}

// #14389: the launch flag was the only native off switch. The keyword_detector keys OpenCode reads from
// omo.jsonc now gate native arming too, so one project file turns the keyword off for every launch.
describe("omo-senpi ultrawork honors keyword_detector from omo config", () => {
  it("#given a project config listing ultrawork in disabled_keywords #when the keyword is typed #then nothing arms", async () => {
    const pi = await registerIn(project("denied", '{ "keyword_detector": { "disabled_keywords": ["ultrawork"] } }'))
    expectNoInjection(pi, await dispatchInput(pi, "ulw fix the flaky test"))
  })

  it("#given enabled_expansions that leaves ultrawork out #when the keyword is typed #then nothing arms", async () => {
    const pi = await registerIn(
      project("allowlist", '{ "[native]": { "keyword_detector": { "enabled_expansions": ["team"] } } }'),
    )
    expectNoInjection(pi, await dispatchInput(pi, "ultrawork: ship it"))
  })

  it("#given keyword_detector that keeps ultrawork on #when the keyword is typed #then it still arms", async () => {
    for (const config of [
      undefined,
      '{ "keyword_detector": { "disabled_keywords": ["team"] } }',
      '{ "keyword_detector": { "enabled_expansions": ["ultrawork"] } }',
    ]) {
      const pi = await registerIn(project(`kept-${String(config?.length ?? 0)}`, config))
      expectHiddenInjection(pi, await dispatchInput(pi, "ulw fix the flaky test"))
    }
  })

  it("#given keyword_detector in a native config #when loaded #then no unknown-key diagnostic says it is ignored", () => {
    const loaded = loadSenpiOmoConfig({
      cwd: project("diagnostic", '{ "keyword_detector": { "disabled_keywords": ["ultrawork"] } }'),
      env: { HOME: join(root, "home") },
    })
    expect(loaded.diagnostics.filter((diagnostic) => diagnostic.kind === "unknown-keys")).toEqual([])
    expect(loaded.config.keyword_detector).toEqual({ disabled_keywords: ["ultrawork"] })
  })
})
