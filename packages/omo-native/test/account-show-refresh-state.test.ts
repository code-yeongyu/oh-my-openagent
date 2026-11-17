import { expect, test } from "bun:test"
import type { CredentialStore } from "../../omo-opencode/src/cli/service-auth/keystore"
import type { Credentials } from "../../omo-opencode/src/cli/service-auth/protocol"
import type { RecoveryClockReading } from "../../omo-opencode/src/cli/service-auth/recovery-clock"
import { newRefreshAttempt, REFRESH_SEND_BUDGET_MS } from "../../omo-opencode/src/cli/service-auth/refresh-attempt"
import { grant, privateKeys } from "../../omo-opencode/src/cli/service-auth/test-support"
import { ACCOUNT_EXIT, showAccount } from "../account-show"

const origin = "https://synthetic.example"
const owner = {
  accountId: "account-A",
  deviceId: grant.device.id,
  familyId: "family-A",
  generation: 7,
  ownerHandle: "handle-A",
}
const reading: RecoveryClockReading = {
  wallTimeMs: 1_900_000_000_000,
  continuousTimeMs: 100_000,
  bootId: "boot-A",
}
const base: Credentials = { ...grant, ...privateKeys, owner, refreshToken: "synthetic-refresh-token" }

const storeOf = (current: Credentials): CredentialStore => ({
  read: async () => current,
  readAuthoritative: async () => current,
  write: async () => {
    throw new Error("show does not write")
  },
  clear: async () => {
    throw new Error("show does not clear")
  },
})

async function shown(current: Credentials, clock: () => Promise<RecoveryClockReading | null>) {
  const lines: string[] = []
  const code = await showAccount(
    {
      api: origin,
      store: storeOf(current),
      pinDir: () => "",
      recoveryClock: clock,
      output: (line) => lines.push(line),
      error: () => {},
    },
    [],
  )
  return {
    code,
    body: JSON.parse(lines[0] ?? "null") as {
      refreshState?: string
      signedIn?: boolean
      device?: { id: string; name: string }
    },
  }
}

test("#given a signed-in credential with no refresh fence #when shown #then refreshState stays ok", async () => {
  const result = await shown(base, async () => reading)
  expect(result.code).toBe(ACCOUNT_EXIT.ok)
  expect(result.body).toMatchObject({ signedIn: true, refreshState: "ok", device: grant.device })
})

test("#given uncertain with no refresh attempt #when shown #then refreshState is expired", async () => {
  const result = await shown({ ...base, refreshState: "uncertain" }, async () => reading)
  expect(result).toEqual({
    code: ACCOUNT_EXIT.ok,
    body: { signedIn: true, device: grant.device, refreshState: "expired" },
  })
})

test("#given an exhausted attempt #when shown #then refreshState is expired", async () => {
  const attempt = { ...newRefreshAttempt(origin, owner, base.refreshToken, reading), state: "exhausted" as const }
  const result = await shown({ ...base, refreshState: "uncertain", refreshAttempt: attempt }, async () => reading)
  expect(result.body.refreshState).toBe("expired")
})

test("#given an attempt whose deadline has passed #when shown #then refreshState is expired", async () => {
  const attempt = newRefreshAttempt(origin, owner, base.refreshToken, reading)
  const later = async () => ({
    ...reading,
    wallTimeMs: reading.wallTimeMs + REFRESH_SEND_BUDGET_MS,
    continuousTimeMs: reading.continuousTimeMs + REFRESH_SEND_BUDGET_MS,
  })
  const result = await shown({ ...base, refreshState: "uncertain", refreshAttempt: attempt }, later)
  expect(result.body.refreshState).toBe("expired")
})

test("#given an attempt from a previous boot #when shown #then refreshState is expired", async () => {
  const attempt = newRefreshAttempt(origin, owner, base.refreshToken, reading)
  const rebooted = async () => ({ ...reading, bootId: "boot-B" })
  const result = await shown({ ...base, refreshState: "uncertain", refreshAttempt: attempt }, rebooted)
  expect(result.body.refreshState).toBe("expired")
})

test("#given an eligible in-progress attempt #when shown #then refreshState stays uncertain", async () => {
  const attempt = { ...newRefreshAttempt(origin, owner, base.refreshToken, reading), state: "sent_unknown" as const }
  const result = await shown({ ...base, refreshState: "uncertain", refreshAttempt: attempt }, async () => reading)
  expect(result.code).toBe(ACCOUNT_EXIT.ok)
  expect(result.body).toEqual({ signedIn: true, device: grant.device, refreshState: "uncertain" })
})
