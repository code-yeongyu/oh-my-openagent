import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { readDeviceServiceDevices } from "@oh-my-opencode/device-service-core"
import { deviceServiceStateDir } from "@oh-my-opencode/device-service-core/state-dir"
import { isDeviceRevoked, listLiveDevices } from "@oh-my-opencode/omo-opencode/service-auth"
import { createOmoNativeProductConfig } from "../../telemetry/product-identity"
import type { AccountAccess, SignedIn } from "../access"
import type { EnrollPorts } from "."
import { StepRefusal } from "./outcome"
import { openSshPort } from "./ssh-port"

const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted === true) return reject(signal.reason)
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer)
        reject(signal.reason)
      },
      { once: true },
    )
  })

/** The caller's own sign-in and device service, the OpenSSH client and the real clock. */
export function defaultEnrollPorts(options: {
  readonly access: AccountAccess
  readonly env: Readonly<Record<string, string | undefined>>
  readonly home?: string
}): EnrollPorts {
  const { access } = options
  const signedIn = async <T>(read: (signedIn: SignedIn) => Promise<T>): Promise<T> => {
    const result = await access.signedIn(read)
    if (result.kind === "ok") return result.value
    throw new StepRefusal("caller_signed_out", "this device cannot read its account", result.error.next_action, {
      code: result.error.code,
    })
  }
  const stateDir = deviceServiceStateDir(process.platform, options.env, options.home ?? homedir())
  return {
    origin: access.origin,
    ssh: openSshPort,
    liveDeviceIds: () => signedIn(async ({ session }) => (await listLiveDevices(session)).map((device) => device.id)),
    isDeviceRevoked: (id) => signedIn(({ session }) => isDeviceRevoked(session, id)),
    machines: async () => {
      const rows = await readDeviceServiceDevices({ stateDir, version: createOmoNativeProductConfig().packageVersion })
      return typeof rows === "string"
        ? []
        : rows.map((row) => ({ id: row.id, state: row.online ? "online" : "offline" }))
    },
    clock: { now: Date.now, sleep },
    doriterm: async (args) => {
      // doriterm's checkout as its setup skill places it; a device without one has no mesh to attach to.
      const cli = join(
        options.home ?? homedir(),
        ".local",
        "share",
        "doriface-host",
        "src",
        "apps",
        "host",
        "scripts",
        "setup",
        "cli.ts",
      )
      if (!existsSync(cli)) return { code: null, lines: [] }
      const child = Bun.spawn(["bun", cli, ...args], { stdin: "ignore", stdout: "pipe", stderr: "ignore" })
      const [code, stdout] = await Promise.all([child.exited, new Response(child.stdout).text()])
      return { code, lines: stdout.split("\n").filter((line) => line !== "") }
    },
  }
}
