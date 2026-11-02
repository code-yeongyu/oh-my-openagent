import { expect, test } from "bun:test"
import type { Credentials } from "./protocol"
import { createSession } from "./session"
import { clock, fakeApi, grant, memorySecrets, privateKeys, temporaryHome } from "./test-support"

const expired: Credentials = { ...grant, ...privateKeys, accessTokenExpiresAt: "2000-01-01T00:00:00Z" }

test.each(["missing", "invalid", "unprovable"] as const)("an uncertain %s journal sends nothing and requires sign-in", async shape => {
  let sends = 0
  const api = fakeApi(() => {
    sends++
    return Response.json(grant)
  })
  const store = memorySecrets().store(api)
  const attempt = shape === "missing" ? {} : {
    refreshAttempt: { idempotencyKey: shape === "invalid" ? "draft-key" : "j".repeat(43), attempts: 1, nextAttemptAt: "2000-01-01T00:00:00Z" },
  }
  await store.write({ ...expired, refreshState: "uncertain", ...attempt })
  const time = clock()
  const session = createSession({ api, store, home: await temporaryHome(), now: time.now })

  await expect(session.accessToken()).rejects.toMatchObject({ code: "refresh_recovery_expired", deviceRevoked: false })
  expect(sends).toBe(0)
})

// The invalid_request response itself is covered by session-uncertain-recovery.test.ts.
test("legacy exhaustion preserves the unanswered journal without sending", async () => {
  const time = clock()
  let sends = 0
  const api = fakeApi(() => { sends++; return Response.json(grant) })
  const store = memorySecrets().store(api)
  const original = { ...expired, refreshState: "uncertain" as const, refreshAttempt: {
    idempotencyKey: "j".repeat(43), attempts: 1, nextAttemptAt: "2000-01-01T00:00:00Z",
  } }
  await store.write(original)
  const session = createSession({ api, store, home: await temporaryHome(), now: time.now })

  await expect(session.accessToken()).rejects.toThrow()
  expect(sends).toBe(0)
  expect(await store.read()).toMatchObject({ refreshState: "uncertain", refreshAttempt: { idempotencyKey: original.refreshAttempt.idempotencyKey } })
})
