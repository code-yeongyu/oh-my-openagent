import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"

import { createMachineIdResolver, parsePlatformUuid } from "./stale-holder"

describe("machine id resolver", () => {
  test("#given a platform UUID #when resolving a host id #then only a domain-separated hash is returned", async () => {
    const uuid = "C79FE553-52A7-5542-9639-3A49B5C119CD"
    const resolve = createMachineIdResolver(async () => uuid)

    expect(await resolve()).toBe(createHash("sha256").update(`omo-reflection-host:${uuid}`).digest("hex"))
  })

  test("#given a probe that cannot answer #when it recovers #then the failure was not cached", async () => {
    let answer: string | null = null
    let probes = 0
    const resolve = createMachineIdResolver(async () => {
      probes += 1
      return answer
    })

    expect(await resolve()).toBeNull()
    expect(probes).toBe(1)

    answer = "darwin-uuid:C79FE553-52A7-5542-9639-3A49B5C119CD"
    expect(await resolve()).toBe(createHash("sha256").update(`omo-reflection-host:${answer}`).digest("hex"))
    expect(probes).toBe(2)
  })

  test("#given a resolved id #when it is resolved again #then the probe runs once and the value is shared", async () => {
    let probes = 0
    const resolve = createMachineIdResolver(async () => {
      probes += 1
      return "darwin-uuid:stable"
    })

    const [first, second] = await Promise.all([resolve(), resolve()])
    const expected = createHash("sha256").update("omo-reflection-host:darwin-uuid:stable").digest("hex")
    expect(first).toBe(expected)
    expect(second).toBe(expected)
    expect(await resolve()).toBe(expected)
    expect(probes).toBe(1)
  })

  test("#given a probe that throws #when it is called again #then the failure is not cached", async () => {
    let probes = 0
    const resolve = createMachineIdResolver(async () => {
      probes += 1
      throw new Error("ioreg failed")
    })

    await expect(resolve()).rejects.toThrow("ioreg failed")
    await expect(resolve()).rejects.toThrow("ioreg failed")
    expect(probes).toBe(2)
  })
})

describe("platform uuid parse", () => {
  test("#given ioreg output naming a uuid #when parsed #then the uuid is returned", () => {
    const output = `+-o J316sAP  <class IOPlatformExpertDevice, id 0x100000100>\n      "IOPlatformUUID" = "C79FE553-52A7-5542-9639-3A49B5C119CD"\n`
    expect(parsePlatformUuid(output)).toBe("C79FE553-52A7-5542-9639-3A49B5C119CD")
  })

  test("#given output without the key #when parsed #then there is no uuid", () => {
    expect(parsePlatformUuid("+-o J316sAP  <class IOPlatformExpertDevice>\n")).toBeNull()
  })

  test("#given the key with an empty value #when parsed #then there is no uuid", () => {
    expect(parsePlatformUuid('      "IOPlatformUUID" = ""\n')).toBeNull()
  })

  test("#given a probe that produced nothing #when parsed #then there is no uuid", () => {
    expect(parsePlatformUuid(null)).toBeNull()
  })
})

describe("platform uuid reader", () => {
  test.if(process.platform === "darwin")(
    "#given an empty PATH #when the production probe runs #then it returns the machine id",
    () => {
      const source = new URL("./stale-holder.ts", import.meta.url).href
      const result = spawnSync(
        process.execPath,
        [
          "-e",
          `import { getStableLocalHostId } from ${JSON.stringify(source)}; console.log(await getStableLocalHostId())`,
        ],
        { encoding: "utf8", env: { ...process.env, PATH: "" }, timeout: 10_000 },
      )

      expect(result.status, result.stderr).toBe(0)
      expect(result.stdout.trim()).toMatch(/^[0-9a-f]{64}$/)
    },
  )
})
