import { afterEach, describe, expect, test } from "bun:test"
import { answerCompiledFastPath } from "../compile-entry"
import { compiledUpdate, installCommand, releaseAssetName, RELEASES_URL, replaceCommand } from "../compiled-update"

afterEach(() => {
  process.exitCode = 0
})

const ASSET = releaseAssetName(undefined, "linux", "x64")
const DESTINATION = "/opt/omo-release/omo"
const AVAILABLE = `omo 9.9.10 is available (running 9.9.9). Replace this binary with:\n${replaceCommand(`${RELEASES_URL}/download/v9.9.10/${ASSET}`, DESTINATION, "linux")}`

async function releaseUpdate(args: string[] | undefined) {
  let lookups = 0
  const installed: string[] = []
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
    install: async (request) => {
      installed.push(request.destination)
    },
    ...(args === undefined ? {} : { args }),
  })
  return { result, lookups, installed }
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

  const printed = [
    ["update", "--dry-run"],
    ["update", "--print"],
  ]
  for (const args of printed) {
    test(`#given ${args?.join(" ") ?? "no arguments"} #then it prints the newer release and its replace command, unchanged`, async () => {
      const { result, lookups, installed } = await releaseUpdate(args)
      expect(result.exitCode).toBe(0)
      expect(result.output).toBe(AVAILABLE)
      expect(result.stream ?? "stdout").toBe("stdout")
      expect(lookups).toBe(1)
      expect(installed).toEqual([])
    })
  }
  for (const args of [undefined, ["update"], ["update", "self"], ["update", "--self"]]) {
    test(`#given ${args?.join(" ") ?? "default arguments"} #then the compiled release is installed`, async () => {
      const { result, installed } = await releaseUpdate(args)
      expect(result).toEqual({ exitCode: 0, output: "omo updated 9.9.9 -> 9.9.10" })
      expect(installed).toEqual([DESTINATION])
    })
  }
})

describe("compiled omo update destination", () => {
  const provisioned = "/home/user/.omo/binary-runtime/9.9.9/omo"

  async function updateAt(destination: string, platform: NodeJS.Platform) {
    return compiledUpdate({
      omoAiVersion: "9.9.9",
      releaseTarget: undefined,
      destination,
      provisioned,
      platform,
      arch: "x64",
      fetchReleases: async () => [
        { tag_name: "v9.9.10", assets: [{ name: releaseAssetName(undefined, platform, "x64") }] },
      ],
      args: ["update", "--dry-run"],
    })
  }

  test("#given the installed launcher as destination #then the replace command targets it, unchanged", async () => {
    const result = await updateAt(DESTINATION, "linux")
    expect(result.exitCode).toBe(0)
    expect(result.output).toBe(AVAILABLE)
  })

  for (const [platform, installer] of [
    ["linux", installCommand("linux")],
    ["win32", installCommand("win32")],
  ] as const) {
    test(`#given the provisioned runtime copy as destination on ${platform} #then it names the installer instead of a replace command the next launch would undo`, async () => {
      const result = await updateAt(provisioned, platform)
      expect(result.exitCode).toBe(1)
      expect(result.stream).toBe("stderr")
      expect(result.output.split("\n").at(-1)).toBe(installer)
      expect(result.output).not.toContain(`${provisioned}.new`)
    })
  }
})

describe("compiled fast path update argument handling", () => {
  const manifest = { omoAiVersion: "9.9.9", enginePin: "2026.1.1", buildInfo: undefined, engineBuild: undefined }

  function capture(args: string[]) {
    const out: string[] = []
    const err: string[] = []
    const [log, error] = [console.log, console.error]
    console.log = (value?: unknown) => {
      out.push(String(value))
    }
    console.error = (value?: unknown) => {
      err.push(String(value))
    }
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
    expect(result.out).toEqual([
      `omo update runs from the compiled omo binary; download ${releaseAssetName(undefined, process.platform, process.arch)} from ${RELEASES_URL}`,
    ])
  })
})
