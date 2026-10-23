import { afterEach, describe, expect, test } from "bun:test"
import { answerCompiledFastPath } from "../compile-entry"
import { compiledUpdate, releaseAssetName, RELEASES_URL, type ReplaceBinary, replaceCommand } from "../compiled-update"

afterEach(() => {
  process.exitCode = 0
})

const ASSET = releaseAssetName(undefined, "linux", "x64")
const DESTINATION = "/opt/omo-release/omo"
const ASSET_URL = `${RELEASES_URL}/download/v9.9.10/${ASSET}`
const COMMAND = replaceCommand(ASSET_URL, DESTINATION, "linux")
const AVAILABLE = `omo 9.9.10 is available (running 9.9.9). Replace this binary with:\n${COMMAND}`

async function releaseUpdate(args: string[] | undefined, replace?: ReplaceBinary) {
  let lookups = 0
  const installs: Parameters<ReplaceBinary>[] = []
  const result = await compiledUpdate({
    omoAiVersion: "9.9.9",
    releaseTarget: undefined,
    destination: DESTINATION,
    platform: "linux",
    arch: "x64",
    fetchReleases: async () => {
      lookups += 1
      return [{ tag_name: "v9.9.10", assets: [{ name: ASSET }] }]
    },
    ...(args === undefined ? {} : { args }),
    replaceBinary: async (...call) => {
      installs.push(call)
      await replace?.(...call)
    },
  })
  return { result, lookups, installs }
}

describe("compiled omo update argument handling", () => {
  for (const flag of ["--help", "-h"]) {
    test(`#given update ${flag} #then it answers usage with exit 0 and makes no release lookup`, async () => {
      const { result, lookups } = await releaseUpdate(["update", flag])
      expect(result.exitCode).toBe(0)
      expect(result.output).toStartWith("Usage: omo update")
      expect(lookups).toBe(0)
    })
  }

  test("#given an unknown flag #then it is a usage error on stderr naming the flag, with no lookup", async () => {
    const { result, lookups } = await releaseUpdate(["update", "--forse"])
    expect(result.exitCode).toBe(2)
    expect(result.stream).toBe("stderr")
    expect(result.output).toContain("--forse")
    expect(lookups).toBe(0)
  })

  const printOnly = [["update", "--dry-run"], ["update", "--print"], ["update", "self", "--print"]]
  for (const args of printOnly) {
    test(`#given ${args.join(" ")} #then it prints the newer release and its replace command and installs nothing`, async () => {
      const { result, lookups, installs } = await releaseUpdate(args)
      expect(result.exitCode).toBe(0)
      expect(result.output).toBe(AVAILABLE)
      expect(result.stream ?? "stdout").toBe("stdout")
      expect(lookups).toBe(1)
      expect(installs).toEqual([])
    })
  }

  const installing = [undefined, ["update"], ["update", "self"], ["update", "--self"]]
  for (const args of installing) {
    test(`#given ${args?.join(" ") ?? "no arguments"} #then it installs the newer release over the running binary`, async () => {
      const { result, lookups, installs } = await releaseUpdate(args)
      expect(result.exitCode).toBe(0)
      expect(result.stream ?? "stdout").toBe("stdout")
      expect(result.output).not.toContain(COMMAND)
      expect(lookups).toBe(1)
      expect(installs).toEqual([[ASSET_URL, DESTINATION, "linux", "9.9.10"]])
    })
  }

  test("#given the install fails #then it exits 1 on stderr with the reason and the manual replace command", async () => {
    const { result, installs } = await releaseUpdate(["update"], async () => {
      throw new Error("download answered 503")
    })
    expect(installs).toHaveLength(1)
    expect(result.exitCode).toBe(1)
    expect(result.stream).toBe("stderr")
    expect(result.output).toContain("download answered 503")
    expect(result.output).toEndWith(`\n${COMMAND}`)
  })
})

describe("compiled fast path update argument handling", () => {
  const manifest = { omoAiVersion: "9.9.9", enginePin: "2026.1.1", buildInfo: undefined, engineBuild: undefined }

  function capture(args: string[]) {
    const out: string[] = []
    const err: string[] = []
    const [log, error] = [console.log, console.error]
    console.log = (value?: unknown) => { out.push(String(value)) }
    console.error = (value?: unknown) => { err.push(String(value)) }
    try {
      return { handled: answerCompiledFastPath(args, manifest), out, err, exitCode: process.exitCode }
    } finally {
      console.log = log
      console.error = error
    }
  }

  for (const flag of ["--help", "-h"]) {
    test(`#given update ${flag} #then usage is printed with exit 0`, () => {
      const result = capture(["update", flag])
      expect(result.handled).toBe(true)
      expect(result.out[0]).toStartWith("Usage: omo update")
      expect(result.exitCode ?? 0).toBe(0)
    })
  }

  test("#given an unknown flag #then the fast path exits 2 naming it", () => {
    const result = capture(["update", "--forse"])
    expect(result.handled).toBe(true)
    expect(result.exitCode).toBe(2)
    expect(result.err.join("\n")).toContain("--forse")
    expect(result.out).toEqual([])
  })

  test("#given plain update #then the fast path keeps its download hint", () => {
    const result = capture(["update"])
    expect(result.handled).toBe(true)
    expect(result.out).toEqual([`omo update runs from the compiled omo binary; download ${releaseAssetName(undefined, process.platform, process.arch)} from ${RELEASES_URL}`])
  })
})
