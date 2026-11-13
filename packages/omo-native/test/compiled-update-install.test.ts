import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  realpath,
  rm,
  stat,
  symlink,
  unlink,
  utimes,
  writeFile,
} from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { compiledUpdate } from "../compiled-update"
import { BinaryUpdateError, installReleaseBinary } from "../compiled-update-install"

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "omo-update-test-")))
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
    root,
    destination,
    bytes,
    urls,
    probes,
    options: {
      destination,
      asset: "omo-linux-x64",
      version: "9.9.10",
      platform: "linux" as const,
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
  const staleRecord = (pid: number, startedAt = Date.now()) =>
    `omo-update fixture\n${pid}\n${startedAt}\nfixture-incarnation\nunavailable\n`

  for (const kind of ["dead holder", "expired live holder", "aged empty legacy lock"]) {
    test(`#given a leftover lock with ${kind} #then the updater reclaims it and finishes without manual repair`, async () => {
      const f = await fixture()
      const lockPath = `${f.destination}.update-lock`
      const old = Date.now() - 60 * 60_000
      await writeFile(
        lockPath,
        kind === "aged empty legacy lock"
          ? ""
          : staleRecord(
              kind === "dead holder" ? 2_147_483_647 : process.pid,
              kind === "expired live holder" ? old : Date.now(),
            ),
      )
      if (kind === "aged empty legacy lock") await utimes(lockPath, old / 1000, old / 1000)
      await installReleaseBinary(f.options)
      expect(await readFile(f.destination, "utf8")).toBe("new executable")
      expect(await readdir(f.root)).toEqual(["omo"])
    })
  }

  test("#given a crashed reclaim guard #then recovery completes in the same update invocation", async () => {
    const f = await fixture()
    const lockPath = `${f.destination}.update-lock`
    const record = staleRecord(2_147_483_647)
    const guardPath = `${lockPath}.reclaim-${createHash("sha256").update(record).digest("hex").slice(0, 16)}`
    await writeFile(lockPath, record)
    await writeFile(guardPath, staleRecord(2_147_483_647))
    await installReleaseBinary(f.options)
    expect(await readFile(f.destination, "utf8")).toBe("new executable")
    expect(await readdir(f.root)).toEqual(["omo"])
  })

  test("#given two simultaneous stale-lock reclaimers #then exactly one updater enters and the other cannot delete its lock", async () => {
    const f = await fixture()
    await writeFile(`${f.destination}.update-lock`, staleRecord(2_147_483_647))
    const entered = Promise.withResolvers<void>()
    const proceed = Promise.withResolvers<void>()
    const options = {
      ...f.options,
      fetchAsset: async (url: string) => {
        entered.resolve()
        await proceed.promise
        return f.options.fetchAsset(url)
      },
    }
    const attempts = [0, 1].map(() => installReleaseBinary(options).catch((error: unknown) => error))
    try {
      expect(await Promise.race([entered.promise.then(() => true), Promise.all(attempts).then(() => false)])).toBe(true)
      expect(((await Promise.race(attempts)) as BinaryUpdateError).code).toBe("update_in_progress")
      expect(await readFile(f.destination, "utf8")).toBe("old executable")
    } finally {
      proceed.resolve()
      await Promise.all(attempts)
    }
    expect(f.probes).toHaveLength(1)
    expect(await readdir(f.root)).toEqual(["omo"])
  })

  test("#given a replaced expired lease #then its old downloader cannot swap the binary or remove the successor lock", async () => {
    const f = await fixture()
    const firstEntered = Promise.withResolvers<void>()
    const secondEntered = Promise.withResolvers<void>()
    const firstProceed = Promise.withResolvers<void>()
    const secondProceed = Promise.withResolvers<void>()
    const first = installReleaseBinary({
      ...f.options,
      fetchAsset: async (url) => {
        firstEntered.resolve()
        await firstProceed.promise
        return f.options.fetchAsset(url)
      },
    }).catch((error: unknown) => error)
    await firstEntered.promise
    await writeFile(`${f.destination}.update-lock`, staleRecord(process.pid, Date.now() - 60 * 60_000))
    const second = installReleaseBinary({
      ...f.options,
      fetchAsset: async (url) => {
        secondEntered.resolve()
        await secondProceed.promise
        return f.options.fetchAsset(url)
      },
    }).catch((error: unknown) => error)
    try {
      expect(await Promise.race([secondEntered.promise.then(() => true), second.then(() => false)])).toBe(true)
      const successor = await readFile(`${f.destination}.update-lock`, "utf8")
      firstProceed.resolve()
      expect(((await first) as BinaryUpdateError).code).toBe("update_in_progress")
      expect(await readFile(`${f.destination}.update-lock`, "utf8")).toBe(successor)
      expect(await readFile(f.destination, "utf8")).toBe("old executable")
    } finally {
      firstProceed.resolve()
      secondProceed.resolve()
      await Promise.all([first, second])
    }
    expect(f.probes).toHaveLength(1)
    expect(await readdir(f.root)).toEqual(["omo"])
  })

  test.skipIf(process.platform === "win32")(
    "#given a symlink launcher #then the target is updated and the managed link is preserved",
    async () => {
      const f = await fixture()
      const alias = join(f.root, "omo-link")
      await symlink(f.destination, alias)
      await installReleaseBinary({ ...f.options, destination: alias })
      expect((await lstat(alias)).isSymbolicLink()).toBe(true)
      expect(await readlink(alias)).toBe(f.destination)
      expect(await readFile(alias, "utf8")).toBe("new executable")
      expect(f.probes).toEqual([f.destination])
      expect((await readdir(f.root)).sort()).toEqual(["omo", "omo-link"])
    },
  )

  test("#given rollback-file cleanup fails #then the install lock is still released", async () => {
    const f = await fixture()
    const error = await installReleaseBinary({
      ...f.options,
      run: async (file, args) => {
        const result = await f.options.run(file, args)
        const previous = (await readdir(f.root)).find((name) => name.includes(".old-"))
        if (previous === undefined) throw new Error("rollback fixture is missing")
        await unlink(join(f.root, previous))
        await mkdir(join(f.root, previous))
        return result
      },
    }).catch((value: unknown) => value)
    expect(error).toBeInstanceOf(Error)
    expect((await readdir(f.root)).includes("omo.update-lock")).toBe(false)
    expect(await readFile(f.destination, "utf8")).toBe("new executable")
  })

  test("#given a valid mirror release #when installed #then checksums precede bytes and the installed path is probed before rollback cleanup", async () => {
    const f = await fixture()
    await installReleaseBinary(f.options)
    expect(await readFile(f.destination, "utf8")).toBe("new executable")
    expect(f.urls).toEqual(["https://get.omo.dev/v/9.9.10/SHA256SUMS", "https://get.omo.dev/v/9.9.10/omo-linux-x64"])
    expect(f.probes).toEqual([f.destination])
    // Windows has no POSIX permission bits to observe; the executable bit is a POSIX contract.
    if (process.platform !== "win32") expect((await stat(f.destination)).mode & 0o777).toBe(0o755)
    expect(await readdir(f.root)).toEqual(["omo"])
  })

  test("#given the mirror is unavailable #then the identical pinned GitHub release is used", async () => {
    const f = await fixture()
    await installReleaseBinary({
      ...f.options,
      fetchAsset: async (url) =>
        url.startsWith("https://get.omo.dev/") ? new Response("", { status: 503 }) : f.options.fetchAsset(url),
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
        ...f.options,
        fetchAsset: async (url) => (url.endsWith("SHA256SUMS") ? new Response(sums) : new Response(f.bytes)),
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
      ...f.options,
      run: async () => ({ code: 0, stdout: "omo 9.9.9 (engine: old)\n" }),
    }).catch((value: unknown) => value)
    expect(error).toBeInstanceOf(BinaryUpdateError)
    expect((error as BinaryUpdateError).code).toBe("verification_failed")
    expect(await readFile(f.destination, "utf8")).toBe("old executable")
    expect(await readdir(f.root)).toEqual(["omo"])
  })

  test("#given a beta release tagged without npm's zero prefix #then its branded --version is accepted", async () => {
    const f = await fixture()
    await installReleaseBinary({
      ...f.options,
      version: "9.9.10-beta.1",
      run: async () => ({ code: 0, stdout: "omo 9.9.10-0.beta.1 (engine: fixture)\n" }),
    })
    expect(await readFile(f.destination, "utf8")).toBe("new executable")
    expect(await readdir(f.root)).toEqual(["omo"])
  })

  test.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "#given a non-writable install directory #then a typed refusal occurs before any download and leaves no partial state",
    async () => {
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
    },
  )

  test("#given an interrupted response body #then the old executable survives and partial bytes and lock are removed", async () => {
    const f = await fixture()
    const error = await installReleaseBinary({
      ...f.options,
      fetchAsset: async (url) =>
        url.endsWith("SHA256SUMS")
          ? f.options.fetchAsset(url)
          : new Response(
              new ReadableStream({
                start(controller) {
                  controller.error(new Error("connection reset"))
                },
              }),
            ),
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
      const record = (await readFile(`${f.destination}.update-lock`, "utf8")).split("\n")
      expect(Number(record[1])).toBe(process.pid)
      expect(Number(record[2])).toBeGreaterThan(Date.now() - 10_000)
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
      ...f.options,
      platform: "darwin",
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
      ...f.options,
      platform: "darwin",
      run: async () => ({ code: 1, stdout: "" }),
    }).catch((value: unknown) => value)
    expect((error as BinaryUpdateError).code).toBe("verification_failed")
    expect(await readFile(f.destination, "utf8")).toBe("old executable")
    expect(await readdir(f.root)).toEqual(["omo"])
  })

  test("#given a Windows swap whose installed probe fails #then the moved-aside executable is restored", async () => {
    const f = await fixture()
    const error = await installReleaseBinary({
      ...f.options,
      platform: "win32",
      run: async () => {
        throw new Error("cannot start executable")
      },
    }).catch((value: unknown) => value)
    expect((error as BinaryUpdateError).code).toBe("verification_failed")
    expect(await readFile(f.destination, "utf8")).toBe("old executable")
    expect(await readdir(f.root)).toEqual(["omo"])
  })

  test("#given a plain compiled update #then it executes the installer and returns a single result line", async () => {
    const f = await fixture()
    const result = await compiledUpdate({
      omoAiVersion: "9.9.9",
      releaseTarget: "linux-x64",
      destination: f.destination,
      platform: "linux",
      arch: "x64",
      fetchReleases: async () => [{ tag_name: "v9.9.10", assets: [{ name: "omo-linux-x64" }] }],
      install: (request) => installReleaseBinary({ ...f.options, ...request }),
      args: ["update"],
    })
    expect(result.exitCode).toBe(0)
    expect(result.output).toBe("omo updated 9.9.9 -> 9.9.10")
    expect(await readFile(f.destination, "utf8")).toBe("new executable")
  })
})
