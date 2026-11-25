import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createOmoSdk, SDK_VERSION } from "./omo-sdk"

// The source entry the runtime bundle is built from: its exported names are the eval cells' API.
test("#given the source entry #when a read runs with no sign-in #then it answers signed_out and the version is dev", async () => {
  const sdk = createOmoSdk({ ports: { desktopLaunch: () => false, credentialStore: { read: async () => null } } })
  const result = await sdk.account.whoami()
  expect(result.kind === "error" ? result.error.code : result.kind).toBe("signed_out")
  expect(SDK_VERSION).toBe("dev")
})

// A session reaches this entry by importing it in an eval cell and calling createOmoSdk() with no principal: the root
// is the OS user's script principal (design lane, default-deny ruling), so a session's cell keeps every call it had.
test("#given the entry as a session's eval cell builds it #when it reads the account, devices and the device service and warms the daemon #then each answers as before default deny, none is refused", async () => {
  const home = mkdtempSync(join(tmpdir(), "omo-sdk-session-cell-"))
  const sdk = createOmoSdk({
    env: {
      HOME: home,
      OMO_CODING_AGENT_DIR: home,
      OMO_SESSION_ID: "s-1",
      OMO_SERVICE_API_URL: "https://accounts.invalid",
    },
    cwd: home,
    home,
    agentDir: home,
    ports: {
      desktopLaunch: () => false,
      credentialStore: { read: async () => null },
      deviceServiceStatus: async () => "not_running",
    },
  })
  const codeOf = (answer: { readonly kind: string; readonly error?: { readonly code: string } }) =>
    answer.kind === "error" ? answer.error?.code : answer.kind
  expect(codeOf(await sdk.account.whoami())).toBe("signed_out")
  expect(codeOf(await sdk.devices.list())).toBe("signed_out")
  expect(codeOf(await sdk.deviceService.status())).toBe("ok")
  expect(codeOf(await sdk.daemon.warm({}, { deadline_ms: 50 }))).not.toBe("sender_not_allowed")
  await sdk.dispose()
  rmSync(home, { recursive: true, force: true })
})
