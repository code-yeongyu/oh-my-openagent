import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { chmod, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { compiledUpdate } from "../compiled-update"
import { BinaryUpdateError, installReleaseBinary } from "../compiled-update-install"

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "omo-update-test-"))
  roots.push(root)
  const destination = join(root, "omo")
  await writeFile(destination, "old executable", { mode: 0o755 })
  const bytes = new TextEncoder().encode("new executable")
  const digest = createHash("sha256").update(bytes).digest("hex")
  const urls: string[] = []
  const probes: string[] = []
  const fetchAsset = async (url: string) => {
    urls.push(url)
    return new Response(url.endsWith("SHA256SUMS") ? `${digest}  omo-linux-x64\n` : bytes)
  }
  return {
    root, destination, bytes, urls, probes,
    options: {
      destination, asset: "omo-linux-x64", version: "9.9.10", platform: "linux" as const,
      fetchAsset,
      run: async (path: string, _args: readonly string[]) => {
        probes.push(path)
        expect(await readFile(path, "utf8")).toBe("new executable")
        // The old inode must survive until the installed executable has been verified.
        expect((await readdir(root)).some((name) => name.includes(".old-"))).toBe(true)
        return { code: 0, stdout: "omo 9.9.10 (engine: senpi test)\n" }
      },
    },
  }
}

describe("verified standalone binary installation", () => {
  test("#given a valid mirror release #when installed #then checksums precede bytes and the installed path is probed before rollback cleanup", async () => {
    const f = await fixture()
    await installReleaseBinary(f.options)
    expect(await readFile(f.destination, "utf8")).toBe("new executable")
    expect(f.urls).toEqual(["https://get.omo.dev/v/9.9.10/SHA256SUMS", "https://get.omo.dev/v/9.9.10/omo-linux-x64"])
    expect(f.probes).toEqual([f.destination])
    expect((await stat(f.destination)).mode & 0o777).toBe(0o755)
    expect(await readdir(f.root)).toEqual(["omo"])
  })

  test("#given the mirror is unavailable #then the identical pinned GitHub release is used", async () => {
    const f = await fixture()
    await installReleaseBinary({
      ...f.options,
      fetchAsset: async (url) => url.startsWith("https://get.omo.dev/") ? new Response("", { status: 503 }) : f.options.fetchAsset(url),
    })
    expect(f.urls).toEqual([
      "https://github.com/code-yeongyu/oh-my-openagent/releases/download/v9.9.10/SHA256SUMS",
      "https://github.com/code-yeongyu/oh-my-openagent/releases/download/v9.9.10/omo-linux-x64",
    ])
  })

  for (const sums of ["", `${"0".repeat(64)}  other-asset\n`, `${"0".repeat(64)}  omo-linux-x64\n`]) {
    test(`#given invalid integrity metadata ${sums.slice(0, 8)} #then no unverified executable runs and the old binary survives`, async () => {
      const f = await fixture()
      const error = await installReleaseBinary({
        ...f.options, fetchAsset: async (url) => url.endsWith("SHA256SUMS") ? new Response(sums) : new Response(f.bytes),
      }).catch((value: unknown) => value)
      expect(error).toBeInstanceOf(BinaryUpdateError)
      expect((error as BinaryUpdateError).code).toBe("integrity_failed")
      expect(f.probes).toEqual([])
      expect(await readFile(f.destination, "utf8")).toBe("old executable")
      expect(await readdir(f.root)).toEqual(["omo"])
    })
  }

  test("#given installed --version reports the wrong version #then the old executable is restored without staging leftovers", async () => {
    const f = await fixture()
    const error = await installReleaseBinary({
      ...f.options, run: async () => ({ code: 0, stdout: "omo 9.9.9 (engine: old)\n" }),
    }).catch((value: unknown) => value)
    expect(error).toBeInstanceOf(BinaryUpdateError)
    expect((error as BinaryUpdateError).code).toBe("verification_failed")
    expect(await readFile(f.destination, "utf8")).toBe("old executable")
    expect(await readdir(f.root)).toEqual(["omo"])
  })

  test.skipIf(process.platform === "win32" || process.getuid?.() === 0)("#given a non-writable install directory #then a typed refusal occurs before any download and leaves no partial state", async () => {
    const f = await fixture()
    await chmod(f.root, 0o555)
    try {
      const error = await installReleaseBinary(f.options).catch((value: unknown) => value)
      expect(error).toBeInstanceOf(BinaryUpdateError)
      expect((error as BinaryUpdateError).code).toBe("directory_not_writable")
      expect(f.urls).toEqual([])
      expect(await readdir(f.root)).toEqual(["omo"])
    } finally {
      await chmod(f.root, 0o755)
    }
  })

  test("#given an interrupted response body #then the old executable survives and partial bytes and lock are removed", async () => {
    const f = await fixture()
    const error = await installReleaseBinary({
      ...f.options,
      fetchAsset: async (url) => url.endsWith("SHA256SUMS") ? f.options.fetchAsset(url) : new Response(new ReadableStream({
        start(controller) { controller.error(new Error("connection reset")) },
      })),
    }).catch((value: unknown) => value)
    expect(error).toBeInstanceOf(BinaryUpdateError)
    expect(await readFile(f.destination, "utf8")).toBe("old executable")
    expect(await readdir(f.root)).toEqual(["omo"])
  })

  test("#given another update owns the lock #then concurrent installation is refused without disturbing it", async () => {
    const f = await fixture()
    const entered = Promise.withResolvers<void>()
    const proceed = Promise.withResolvers<void>()
    const first = installReleaseBinary({
      ...f.options,
      fetchAsset: async (url) => {
        entered.resolve()
        await proceed.promise
        return f.options.fetchAsset(url)
      },
    })
    await entered.promise
    try {
      const error = await installReleaseBinary(f.options).catch((value: unknown) => value)
      expect((error as BinaryUpdateError).code).toBe("update_in_progress")
      expect(await readFile(f.destination, "utf8")).toBe("old executable")
    } finally {
      proceed.resolve()
      await first
    }
    expect(await readdir(f.root)).toEqual(["omo"])
  })

  test("#given a macOS release #then its existing signature is checked before replacement without rewriting its bytes", async () => {
    const f = await fixture()
    const calls: string[] = []
    await installReleaseBinary({
      ...f.options, platform: "darwin",
      run: async (file, args) => {
        calls.push(file)
        if (file === "/usr/bin/codesign") {
          expect(args.slice(0, 2)).toEqual(["--verify", "--strict"])
          expect(await readFile(args[2], "utf8")).toBe("new executable")
          expect(await readFile(f.destination, "utf8")).toBe("old executable")
          return { code: 0, stdout: "" }
        }
        return f.options.run(file, args)
      },
    })
    expect(calls).toEqual(["/usr/bin/codesign", f.destination])
    expect(await readdir(f.root)).toEqual(["omo"])
  })

  test("#given invalid macOS signing #then replacement never occurs", async () => {
    const f = await fixture()
    const error = await installReleaseBinary({
      ...f.options, platform: "darwin", run: async () => ({ code: 1, stdout: "" }),
    }).catch((value: unknown) => value)
    expect((error as BinaryUpdateError).code).toBe("verification_failed")
    expect(await readFile(f.destination, "utf8")).toBe("old executable")
    expect(await readdir(f.root)).toEqual(["omo"])
  })

  test("#given a Windows swap whose installed probe fails #then the moved-aside executable is restored", async () => {
    const f = await fixture()
    const error = await installReleaseBinary({
      ...f.options, platform: "win32", run: async () => { throw new Error("cannot start executable") },
    }).catch((value: unknown) => value)
    expect((error as BinaryUpdateError).code).toBe("verification_failed")
    expect(await readFile(f.destination, "utf8")).toBe("old executable")
    expect(await readdir(f.root)).toEqual(["omo"])
  })

  test("#given a plain compiled update #then it executes the installer and returns a single result line", async () => {
    const f = await fixture()
    const result = await compiledUpdate({
      omoAiVersion: "9.9.9", releaseTarget: "linux-x64", destination: f.destination, platform: "linux", arch: "x64",
      fetchReleases: async () => [{ tag_name: "v9.9.10", assets: [{ name: "omo-linux-x64" }] }],
      install: (request) => installReleaseBinary({ ...f.options, ...request }),
      args: ["update"],
    })
    expect(result.exitCode).toBe(0)
    expect(result.output).toBe("omo updated 9.9.9 -> 9.9.10")
    expect(await readFile(f.destination, "utf8")).toBe("new executable")
  })
})
