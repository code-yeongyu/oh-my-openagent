// #15352: when the lazy onboarding runtime cannot load, or the scan itself rejects, the scan RPC still ends with `done`
// and the understand RPC answers `unavailable`. Their reasons come from a fixed vocabulary, because the import or scan
// error names local paths and can quote what the scan read.
import { describe, expect, test } from "bun:test"

import { isPlainRecord } from "@oh-my-opencode/utils/record-type-guard"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { remainingTestTime } from "../../../../../test-support/test-deadline"
import {
  createOnboardingScanComponent,
  createOnboardingScanStore,
  ONBOARDING_APPLY_RPC_METHOD,
  ONBOARDING_SCAN_RPC_EVENT,
  ONBOARDING_SCAN_RPC_METHOD,
  ONBOARDING_UNDERSTAND_RPC_METHOD,
} from "./scan-component"
import {
  loadOnboardingScanRuntime,
  ONBOARDING_SCAN_RUNTIME_FILE,
  type OnboardingScanRuntime,
} from "./scan-runtime-loader"

const SECRET = "SK-SENTINEL-RUNTIME-UNAVAILABLE"
type Handler = (request: unknown) => unknown | Promise<unknown>

/** A load failure as the runtime import reports it: an absolute path under the user's home, not the sidecar's name. */
async function missingRuntime(): Promise<OnboardingScanRuntime> {
  throw new Error(`Cannot find package 'x' imported from '/home/${SECRET}/plugin/extensions/omo.js'`)
}

async function rejectingScan(): Promise<OnboardingScanRuntime> {
  return {
    ...(await loadOnboardingScanRuntime()),
    runOnboardingScan: async () => {
      const path = `/home/${SECRET}/.claude/projects`
      throw Object.assign(new Error(`EACCES: permission denied, scandir '${path}'`), { code: "EACCES", path })
    },
  }
}

/** A runtime that served the scan, then cannot load again when the apply asks for it (#15381). */
function runtimeGoneAfterScan(): () => Promise<OnboardingScanRuntime> {
  let loads = 0
  return async () => {
    loads += 1
    if (loads === 1) return await loadOnboardingScanRuntime()
    return await missingRuntime()
  }
}

function scanComponentOnRpcHost(loadRuntime: () => Promise<OnboardingScanRuntime>) {
  const handlers = new Map<string, Handler>()
  const events: unknown[] = []
  const listeners = new Set<(event: unknown) => void>()
  const rpc = {
    handle: (name: string, handler: Handler) => void handlers.set(name, handler),
    emit: (name: string, data: unknown) => {
      if (name !== ONBOARDING_SCAN_RPC_EVENT) return
      events.push(data)
      for (const listener of listeners) listener(data)
    },
  }
  createOnboardingScanComponent({
    loadRuntime,
    runtime: () => ({ home: "/nonexistent-home", env: {}, agentDir: "/nonexistent-home/.omo/agent" }),
    scanStore: createOnboardingScanStore(),
  }).register(Object.assign(new FakeExtensionAPI(), { rpc }), {
    logger: { info() {}, warn() {}, error() {} },
    config: { getFlag: () => false },
  })
  // The done listener is in place before the scan request goes out, and the wait is bounded.
  async function scan(): Promise<unknown> {
    const done = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("waited out the test budget for the scan's done event, never fired")),
        remainingTestTime(),
      )
      listeners.add((event) => {
        if (!isPlainRecord(event) || event["kind"] !== "done") return
        clearTimeout(timer)
        resolve(event)
      })
    })
    await handlers.get(ONBOARDING_SCAN_RPC_METHOD)?.({})
    return await done
  }
  return { handlers, events, scan }
}

describe("onboarding runtime unavailable reasons (#15352)", () => {
  test.each([
    [
      "the onboarding runtime cannot load",
      missingRuntime,
      expect.stringContaining(`extensions/${ONBOARDING_SCAN_RUNTIME_FILE}`),
    ],
    ["the scan rejects", rejectingScan, "EACCES"],
  ])(
    "#given %s #when a scan runs #then its done event names the failure without the error's text",
    async (_name, loadRuntime, reason) => {
      // given
      const host = scanComponentOnRpcHost(loadRuntime)

      // when
      const done = await host.scan()

      // then
      expect(done).toMatchObject({ kind: "done", source: "all", reason })
      expect(JSON.stringify(host.events)).not.toContain(SECRET)
    },
  )

  test("#given the onboarding runtime cannot load #when understanding is requested #then it answers unavailable naming the runtime, never the load error", async () => {
    // given
    const host = scanComponentOnRpcHost(missingRuntime)

    // when
    const reply = await host.handlers.get(ONBOARDING_UNDERSTAND_RPC_METHOD)?.({ scanId: "scan", consent: true })

    // then
    expect(reply).toEqual({
      kind: "unavailable",
      reason: expect.stringContaining(`extensions/${ONBOARDING_SCAN_RUNTIME_FILE}`),
    })
    expect(JSON.stringify(reply)).not.toContain(SECRET)
  })

  test("#given a runtime that cannot load again after the scan #when apply runs #then it answers unavailable naming the runtime, never the load error", async () => {
    // given
    const host = scanComponentOnRpcHost(runtimeGoneAfterScan())
    const done = await host.scan()
    const scanId = isPlainRecord(done) ? done["scanId"] : undefined

    // when
    const reply = await host.handlers.get(ONBOARDING_APPLY_RPC_METHOD)?.({ scanId, stages: [] })

    // then
    expect(reply).toEqual({
      kind: "unavailable",
      reason: expect.stringContaining(`extensions/${ONBOARDING_SCAN_RUNTIME_FILE}`),
    })
    expect(JSON.stringify(reply)).not.toContain(SECRET)
  })
})
