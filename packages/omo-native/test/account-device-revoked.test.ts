import { expect, test } from "bun:test"
import { join } from "node:path"
import { fakeApi, grant, memorySecrets, privateKeys, refusal, temporaryHome } from "../../omo-opencode/src/cli/service-auth/test-support"
import { ACCOUNT_EXIT, runAccountVerb } from "../account-cli"

for (const code of ["device_revoked", "unknown_refusal"]) {
  test(`account token and show settle a 401 ${code} refresh`, async () => {
    // Given an expired credential and a definite service refusal.
    let refreshes = 0
    const api = fakeApi((request) => {
      expect(new URL(request.url).pathname).toBe("/v1/session/refresh")
      refreshes++
      return refusal(code, undefined, 401)
    })
    const store = memorySecrets().store(api)
    const expired = { ...grant, ...privateKeys, accessTokenExpiresAt: "2000-01-01T00:00:00Z" }
    await store.write(expired)
    const home = await temporaryHome()
    const output: string[] = []
    const dependencies = {
      api,
      store,
      home,
      pinDir: () => join(home, "sync-device"),
      readStdin: async () => "",
      output: (line: string) => {
        output.push(line)
      },
      error: () => {},
    }

    // When the account command attempts the refresh.
    const result = await runAccountVerb(dependencies, ["token"])

    // Then only the known terminal refusal clears the session.
    if (code === "device_revoked") {
      expect(result).toBe(ACCOUNT_EXIT.ended)
      expect(output.map((line) => JSON.parse(line))).toEqual([{ ended: { code: "device_revoked" } }])
      expect(await store.read()).toBeNull()
      output.length = 0
      expect(await runAccountVerb(dependencies, ["show"])).toBe(ACCOUNT_EXIT.ok)
      expect(output.map((line) => JSON.parse(line))).toEqual([{ signedIn: false }])
    } else {
      expect(result).toBe(ACCOUNT_EXIT.ended)
      expect(output.map((line) => JSON.parse(line))).toEqual([{ ended: { code: "refresh_recovery_expired" } }])
      expect(await store.read()).toEqual({ ...expired, refreshState: "uncertain" })
      output.length = 0
      expect(await runAccountVerb(dependencies, ["show"])).toBe(ACCOUNT_EXIT.ok)
      expect(output.map((line) => JSON.parse(line))).toEqual([
        {
          signedIn: true,
          device: grant.device,
          refreshState: "uncertain",
        },
      ])
      expect(await runAccountVerb(dependencies, ["token"])).toBe(ACCOUNT_EXIT.ended)
      expect(JSON.parse(output.at(-1) ?? "{}")).toEqual({ ended: { code: "refresh_recovery_expired" } })
    }
    expect(refreshes).toBe(1)
  })
}
