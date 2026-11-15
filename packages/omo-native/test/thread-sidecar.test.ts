import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

import { loadThreadSdk } from "../bin/lib/thread.js"

/**
 * The thread client and device-account sidecars `omo thread` reaches another device and the alias registry through
 * (#12833). A broken sidecar must not leave `omo thread read <alias>` silently local-only, and the sign-in's own
 * warnings must reach the operator (#12848 item 4).
 */

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function capture() {
  const chunks: string[] = []
  return { write: (text: string) => void chunks.push(text), text: () => chunks.join("") }
}

function load(extra: Record<string, unknown>) {
  const stderr = capture()
  let received: Record<string, unknown> = {}
  const loading = loadThreadSdk({
    pluginRoot: "/plugin",
    agentDir: "/agent",
    env: {},
    cwd: "/work",
    stderr,
    reinstall: "Reinstall omo, then retry.",
    engine: { run: () => ({ exitCode: 0, stdout: "", stderr: "" }) },
    loadSqlite: async () => ({}),
    importSdk: async () => ({
      createThreadSdk: (options: Record<string, unknown>) => {
        received = options
        return {}
      },
    }),
    identity: { uid: 501, user: "qa" },
    ...extra,
  })
  return { loading, stderr, received: () => received }
}

describe("omo thread: remote sidecars", () => {
  test("#given a thread client sidecar that cannot be imported #when the SDK loads #then it keeps this device's threads and says on stderr that aliases and other devices are unavailable, with the reinstall step", async () => {
    const reinstall = "Reinstall omo with: npm i -g omo-ai@beta, then retry."
    const { loading, stderr, received } = load({
      reinstall,
      importThreadClient: async () => {
        throw new Error("Cannot find module omo-thread-client.js")
      },
    })

    const loaded = await loading

    expect(loaded.error).toBeUndefined()
    expect("remote" in received()).toBe(false)
    expect(stderr.text()).toContain(join("/plugin", "extensions", "omo-thread-client.js"))
    expect(stderr.text()).toContain("Cannot find module omo-thread-client.js")
    expect(stderr.text()).toContain(reinstall)
  })

  test("#given a thread client sidecar without the CLI remote surface #when the SDK loads #then it stays local-only and quiet (an older plugin, not a broken one)", async () => {
    const { loading, stderr, received } = load({ importThreadClient: async () => ({}) })

    await loading

    expect("remote" in received()).toBe(false)
    expect(stderr.text()).toBe("")
  })

  test("#given the CLI sign-in is loaded for an alias #when it reports a discard-step warning #then the warning is written to stderr", async () => {
    const pluginRoot = mkdtempSync(join(tmpdir(), "omo-thread-sidecar-"))
    roots.push(pluginRoot)
    mkdirSync(join(pluginRoot, "extensions"))
    writeFileSync(
      join(pluginRoot, "extensions", "omo-device-account.js"),
      'export function cliServiceAccess(options) { options.log?.("thread aliases: the device service forget failed (gone)"); return { origin: "https://svc" } }\n',
    )
    let offered: { loadAccess?: () => Promise<unknown> } = {}
    const { loading, stderr } = load({
      pluginRoot,
      importThreadClient: async () => ({
        createCliRemoteSurface: (options: typeof offered) => {
          offered = options
          return {}
        },
      }),
    })
    await loading

    await offered.loadAccess?.()

    expect(stderr.text()).toContain("thread aliases: the device service forget failed (gone)")
  })
})
