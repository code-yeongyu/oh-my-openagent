import { describe, expect, test } from "bun:test"
import { recoverResponse } from "./sync-rpc-recover"

describe("memory sync recover answer (#14122)", () => {
  test("#given a recovered device #when answered #then it says recovered", () => {
    expect(recoverResponse({ ok: true, state: "recovered", epoch: 3, credentialId: "c" })).toEqual({ kind: "recovered" })
  })

  test("#given a device that joined read-only #when answered #then it says recovered read-only", () => {
    expect(recoverResponse({ ok: true, state: "joined-read-only", credentialId: "c" })).toEqual({
      kind: "recovered_read_only",
    })
  })

  test.each(["cancelled", "no-recovery-key", "history-incomplete", "unavailable"] as const)(
    "#given the refusal %s #when answered #then the client sees the same reason",
    (reason) => {
      expect(recoverResponse({ ok: false, reason })).toEqual({ kind: "recover_refused", reason })
    },
  )

  test("#given any other refusal #when answered #then it is a plain refusal that names no internal reason", () => {
    expect(recoverResponse({ ok: false, reason: "key-mismatch" })).toEqual({ kind: "recover_refused", reason: "refused" })
  })
})
