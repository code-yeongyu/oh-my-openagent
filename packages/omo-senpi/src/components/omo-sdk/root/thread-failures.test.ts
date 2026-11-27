import { describe, expect, test } from "bun:test"
import { chmodSync } from "node:fs"

import { THREAD_ERROR_CODES, threadToolFailure } from "../../thread/errors"
import { withContractHost } from "../../../../../senpi-task/src/runners/rpc-host/testing/contract-host"
import { OMO_CODE_REGISTRY } from "../contract"
import { threadFailure, threadToolFailureOf } from "./thread-failures"
import { threadsNamespace } from "./threads"

// Design 4.4: a thread failure converted to the root's shape and back is the failure it was, code, message, next_action
// and details, for every code the thread contract declares.
describe("the thread failure conversion", () => {
  for (const code of THREAD_ERROR_CODES)
    test(`${code}: round-trips unchanged, and reaches the root as a registered code`, () => {
      const original = threadToolFailure(code, `message for ${code}`, `next for ${code}`, { probe: 1 })
      const onRoot = threadFailure(original)
      expect(Object.hasOwn(OMO_CODE_REGISTRY, onRoot.error.code)).toBe(true)
      expect(threadToolFailureOf(onRoot)).toEqual(original)
    })

  test("#given failures whose details legitimately carry their own code field #when they round-trip #then nothing is rewritten", () => {
    const registered = threadToolFailure("not_found", "gone", "list again", { code: "ENOENT" })
    const internal = threadToolFailure("internal_error", "broke", "retry", { code: "not_found" })
    expect(threadToolFailureOf(threadFailure(registered))).toEqual(registered)
    expect(threadToolFailureOf(threadFailure(internal))).toEqual(internal)
  })

  test("#given a thread failure with no details #when it round-trips #then no details field appears", () => {
    const original = threadToolFailure("not_found", "gone", "list again")
    expect(threadToolFailureOf(threadFailure(original))).toEqual(original)
  })
})

// Review of #14983 at 699c480398 (LOW 2; LEAD ruling: fix in this car): daemon.warm answered a failed warm with the
// transport exception's own text, which names the key root and its mode. Every other path in the namespace answers fixed
// text; a refused warm is the typed host_unavailable with a fixed message and the registry's next step.
describe.skipIf(process.platform === "win32")("a warm the daemon's host refuses", () => {
  test("#given a host whose key root is group-writable #when daemon.warm runs #then it answers host_unavailable without the exception's text", async () => {
    await withContractHost({ auth: true, prepareRecord: (_path, root) => chmodSync(root, 0o775) }, async (host) => {
      const namespace = threadsNamespace({
        agentDir: host.root,
        cwd: host.root,
        uid: 501,
        user: "probe",
        env: { HOME: host.root, OMO_RPC_SOCKET: host.socket },
        principal: { kind: "script", uid: 501 },
      })
      const answer = (await (namespace.members["daemon.warm"] as (input: unknown) => Promise<unknown>)({})) as {
        kind: string
        error?: { code?: string; message?: string; next_action?: string }
      }
      await namespace.dispose?.()
      expect(answer.kind).toBe("error")
      expect(answer.error?.code).toBe("host_unavailable")
      expect(answer.error?.next_action).toBe(OMO_CODE_REGISTRY.host_unavailable.next_action)
      expect(answer.error?.message ?? "").not.toContain(host.root)
    })
  })
})
