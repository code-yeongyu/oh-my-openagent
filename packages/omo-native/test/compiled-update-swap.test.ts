import { afterAll, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { removeTree } from "../../../test-support/remove-tree"
import { downloadAndSwapBinary, swapReleaseBinary, type SwapSteps } from "../compiled-update-swap"

// The real swap `omo update` performs, against a local release server that also serves SHA256SUMS.
// The fake releases are shell scripts, so this suite is POSIX only; the injected-steps suite below runs
// the win32 branch on every OS.
const root = mkdtempSync(join(tmpdir(), "omo-update-swap-"))
const ran = join(root, "executed")
const releases: Record<string, string> = {
  "omo-good": "#!/bin/sh\n[ -n \"$BUN_BE_BUN\" ] && { echo 1.4.3; exit 0; }\necho 'omo 9.9.10 (engine: senpi 2026.1.1; scheme nodef)'\n",
  "omo-wrong-version": "#!/bin/sh\necho 'omo 9.9.8 (engine: senpi 2026.1.1; scheme nodef)'\n",
  "omo-tampered": `#!/bin/sh\ntouch '${ran}'\necho 'omo 9.9.10 (engine: senpi 2026.1.1; scheme nodef)'\n`,
}
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex")
const sums = [
  `${sha256(releases["omo-good"] ?? "")}  omo-good`,
  `${sha256(releases["omo-wrong-version"] ?? "")}  omo-wrong-version`,
  `${sha256("what the release published")}  omo-tampered`,
].join("\n")
const server = Bun.serve({
  port: 0,
  fetch: (request) => {
    const name = new URL(request.url).pathname.split("/").at(-1) ?? ""
    if (name === "SHA256SUMS") return new Response(sums)
    const body = releases[name]
    return body === undefined ? new Response("missing", { status: 404 }) : new Response(body)
  },
})

afterAll(() => {
  server.stop(true)
  removeTree(root)
})

function installed(name: string, mode = 0o755): string {
  const destination = join(root, name)
  writeFileSync(destination, "old binary")
  chmodSync(destination, mode)
  return destination
}

const leftovers = (destination: string) => readdirSync(root).filter((entry) => entry.startsWith(`${destination.split("/").at(-1)}.`))

describe.skipIf(process.platform === "win32")("downloadAndSwapBinary", () => {
  test("#given a verified release, even under an inherited BUN_BE_BUN #then it replaces the binary, keeps its mode and leaves no temp file", async () => {
    const destination = installed("omo-good", 0o750)
    const inherited = process.env.BUN_BE_BUN
    process.env.BUN_BE_BUN = "1"
    try {
      await downloadAndSwapBinary(`${server.url}v9.9.10/omo-good`, destination, process.platform, "9.9.10")
    } finally {
      if (inherited === undefined) delete process.env.BUN_BE_BUN
      else process.env.BUN_BE_BUN = inherited
    }
    expect(readFileSync(destination, "utf8")).toBe(releases["omo-good"] ?? "")
    expect(statSync(destination).mode & 0o777).toBe(0o750)
    expect(leftovers(destination)).toEqual([])
  })

  test("#given a download that does not match the published checksum #then it is never written or run and the binary is untouched", async () => {
    const destination = installed("omo-tampered")
    await expect(downloadAndSwapBinary(`${server.url}v9.9.10/omo-tampered`, destination, process.platform, "9.9.10")).rejects.toThrow("checksum")
    expect(existsSync(ran)).toBe(false)
    expect(readFileSync(destination, "utf8")).toBe("old binary")
    expect(leftovers(destination)).toEqual([])
  })

  for (const [name, why] of [["omo-wrong-version", "reports another version"], ["omo-missing", "is not published"]] as const) {
    test(`#given a release that ${why} #then it throws and the installed binary is untouched`, async () => {
      const destination = installed(name)
      await expect(downloadAndSwapBinary(`${server.url}v9.9.10/${name}`, destination, process.platform, "9.9.10")).rejects.toThrow()
      expect(readFileSync(destination, "utf8")).toBe("old binary")
      expect(leftovers(destination)).toEqual([])
    })
  }
})

const BYTES = new TextEncoder().encode("new binary")
const DIGEST = createHash("sha256").update(BYTES).digest("hex")

function fakeSteps(overrides: Partial<SwapSteps> & { readonly failRename?: (from: string, to: string) => boolean } = {}) {
  const files = new Map<string, string>([["C:/omo/omo.exe", "old binary"]])
  const steps: SwapSteps = {
    download: async (url) => (url.endsWith("SHA256SUMS") ? new TextEncoder().encode(`${DIGEST} *omo-windows-x64.exe\n`) : BYTES),
    probeVersion: () => ({ status: 0, stdout: "omo 9.9.10 (engine: senpi 2026.1.1)\n", stderr: "" }),
    writeExecutable: (path, bytes) => { files.set(path, new TextDecoder().decode(bytes)) },
    modeOf: () => 0o755,
    assertWritableDir: () => undefined,
    rename: (from, to) => {
      if (overrides.failRename?.(from, to) === true) throw new Error("EBUSY: file is locked")
      const content = files.get(from)
      if (content === undefined) throw new Error(`ENOENT ${from}`)
      files.delete(from)
      files.set(to, content)
    },
    remove: (path) => { files.delete(path) },
    tempPath: (destination) => `${destination}.new-test`,
    ...overrides,
  }
  return { files, steps }
}

const winRequest = {
  url: "https://releases.test/v9.9.10/omo-windows-x64.exe",
  checksumsUrl: "https://releases.test/v9.9.10/SHA256SUMS",
  asset: "omo-windows-x64.exe",
  destination: "C:/omo/omo.exe",
  platform: "win32",
  version: "9.9.10",
} as const

describe("swapReleaseBinary on win32", () => {
  test("#given a verified release #then the old binary moves aside and the new one takes its place", async () => {
    const { files, steps } = fakeSteps()
    await swapReleaseBinary(winRequest, steps)
    expect(Object.fromEntries(files)).toEqual({ "C:/omo/omo.exe": "new binary", "C:/omo/omo.exe.old": "old binary" })
  })

  test("#given the second rename fails #then the old binary is renamed back and the error surfaces", async () => {
    const { files, steps } = fakeSteps({ failRename: (from) => from.endsWith(".new-test") })
    await expect(swapReleaseBinary(winRequest, steps)).rejects.toThrow("EBUSY")
    expect(Object.fromEntries(files)).toEqual({ "C:/omo/omo.exe": "old binary" })
  })

  test("#given a directory this user cannot write #then it refuses before downloading anything", async () => {
    let downloads = 0
    const { files, steps } = fakeSteps({
      assertWritableDir: () => { throw new Error("C:/omo is not writable by this user") },
      download: async () => { downloads += 1; return BYTES },
    })
    await expect(swapReleaseBinary(winRequest, steps)).rejects.toThrow("not writable")
    expect(downloads).toBe(0)
    expect(Object.fromEntries(files)).toEqual({ "C:/omo/omo.exe": "old binary" })
  })

  test("#given a probe that prints terminal control characters #then the error echoes one short printable line", async () => {
    const { steps } = fakeSteps({ probeVersion: () => ({ status: 1, stdout: `\u001b]0;pwned\u0007${"x".repeat(500)}\nsecond line`, stderr: "" }) })
    const error = await swapReleaseBinary(winRequest, steps).then(() => undefined, (caught: unknown) => caught)
    const message = error instanceof Error ? error.message : ""
    expect(message).not.toMatch(/[\u0000-\u001f\u007f]/)
    expect(message).not.toContain("second line")
    expect(message.length).toBeLessThan(300)
  })
})
