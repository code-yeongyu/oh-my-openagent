import { describe, expect, test } from "bun:test"
import { loginDevice } from "./device-flow"
import type { MachineDevice } from "./protocol"
import { decideReplace } from "./replace-device"
import { createSession } from "./session"
import { clock, fakeApi, grant, memorySecrets, minted, refusal, temporaryHome } from "./test-support"

const earlier = { deviceId: "dev-earlier", deviceName: "Old Laptop" }

// #14032: the first poll answers machine_exists naming the earlier device; the replace attempt's poll answers `second`.
async function replaceRun(second: () => Response, replaceDevice?: (existing: MachineDevice) => Promise<boolean>) {
  const secrets = memorySecrets()
  const codeBodies: unknown[] = []
  let polls = 0
  const api = fakeApi(async (request) => {
    const body = await request.json()
    if (request.url.endsWith("/code")) {
      codeBodies.push(body)
      return Response.json(minted)
    }
    return ++polls === 1 ? refusal("machine_exists", earlier, 409) : second()
  })
  const shown: unknown[] = []
  const offered: MachineDevice[] = []
  const login = loginDevice(
    createSession({
      beforeKeysDiscarded: async () => undefined,
      api,
      store: secrets.store(api),
      home: await temporaryHome(),
    }),
    {
      name: "Test CLI",
      platform: "linux",
      ...clock(),
      show: (code) => shown.push(code),
      chooseDevice: async () => {
        throw new Error("no device may be offered for removal")
      },
      replaceDevice: async (existing) => {
        offered.push(existing)
        return replaceDevice === undefined ? true : replaceDevice(existing)
      },
    },
  )
  return { api, login, secrets, codeBodies, shown, offered, polls: () => polls }
}

describe("replacing this computer's earlier device on machine_exists", () => {
  test("an accepted offer asks for a new code with replace, saves the grant, and reports the replaced device", async () => {
    const run = await replaceRun(() => Response.json({ ...grant, replacedDeviceId: earlier.deviceId }))
    expect(await run.login).toEqual({ replacedDeviceId: earlier.deviceId })
    expect(run.offered).toEqual([earlier])
    expect(run.codeBodies).toEqual([
      { client: { name: "Test CLI", platform: "linux" } },
      { client: { name: "Test CLI", platform: "linux" }, replace: { deviceId: earlier.deviceId } },
    ])
    expect(run.shown).toHaveLength(2)
    const saved = await run.secrets.store(run.api).read()
    expect(saved?.accessToken).toBe(grant.accessToken)
    expect(saved).not.toHaveProperty("replacedDeviceId")
  })

  test("a declined offer keeps the machine_exists refusal without a second code or a save", async () => {
    const run = await replaceRun(
      () => Response.json(grant),
      async () => false,
    )
    await expect(run.login).rejects.toThrow("This computer already has an OmO device")
    expect(run.codeBodies).toHaveLength(1)
    expect(run.secrets.writes).toHaveLength(0)
  })

  test("omo login --replace in a script replaces without prompting", async () => {
    const lines: string[] = []
    const decide = decideReplace({
      replace: true,
      interactive: false,
      confirm: async () => {
        throw new Error("--replace never prompts")
      },
      log: (line) => lines.push(line),
    })
    const run = await replaceRun(() => Response.json({ ...grant, replacedDeviceId: earlier.deviceId }), decide)
    expect(await run.login).toEqual({ replacedDeviceId: earlier.deviceId })
    expect(lines).toEqual([
      "This computer already has an OmO device (Old Laptop, id dev-earlier). Replacing it with this sign-in.",
    ])
  })

  test("a script without --replace keeps the refusal and names the flag, never prompting", async () => {
    const decide = decideReplace({
      replace: false,
      interactive: false,
      confirm: async () => {
        throw new Error("a script is never prompted")
      },
      log: () => {},
    })
    const run = await replaceRun(() => Response.json(grant), decide)
    await expect(run.login).rejects.toThrow(
      "This computer already has an OmO device (Old Laptop, id dev-earlier). Run omo login --replace",
    )
    expect(run.codeBodies).toHaveLength(1)
    expect(run.secrets.writes).toHaveLength(0)
  })

  test("replace_mismatch stops with a start-over message and saves nothing", async () => {
    const run = await replaceRun(() => refusal("invalid_grant", { reason: "replace_mismatch" }))
    await expect(run.login).rejects.toThrow("not this computer's earlier device")
    expect(run.polls()).toBe(2)
    expect(run.secrets.writes).toHaveLength(0)
  })

  test("a service without replace support answers machine_exists again and is named as such", async () => {
    const run = await replaceRun(() => refusal("machine_exists", earlier, 409))
    await expect(run.login).rejects.toThrow("This OmO service can't replace a computer's earlier device yet")
    expect(run.codeBodies).toHaveLength(2)
    expect(run.offered).toHaveLength(1)
    expect(run.secrets.writes).toHaveLength(0)
  })
})
