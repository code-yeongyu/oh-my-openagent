// Contract tests for script/build-omob.ts.

import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import {
	acquireCacheLock,
	deriveOmobAiVersion,
	ensureCacheClone,
	hostTargetFor,
	packSoleSenpiTarball,
	parseOmobArgs,
	resolveCachedSenpiPackage,
} from "./build-omob"
import { planRuntimePrune, selectPruneEntries } from "./omob-runtime-prune"

function tempDir(prefix: string): string {
	return mkdtempSync(join(tmpdir(), prefix))
}

/** A pid that is guaranteed dead: spawn a trivial process and wait for it to exit. */
function deadPid(): number {
	const result = spawnSync(process.execPath, ["-e", "process.exit(0)"], { stdio: "ignore" })
	expect(result.error).toBeUndefined()
	expect(result.status).toBe(0)
	return result.pid as number
}

describe("parseOmobArgs", () => {
	test.skipIf(process.platform === "win32")("defaults to the latest tracked refs and the host target", () => {
		const parsed = parseOmobArgs([], "darwin", "arm64", "/home/dev")
		expect(parsed.senpiRef).toBe("origin/main")
		expect(parsed.omoRef).toBe("origin/dev")
		expect(parsed.name).toBe("omob")
		expect(parsed.keep).toBe(2)
		expect(parsed.target).toBe("darwin-arm64")
		expect(parsed.installDir).toBe(resolve("/home/dev", ".local", "bin"))
		expect(parsed.cacheDir).toBe(resolve("/home/dev", ".cache", "omob"))
		expect(parsed.skipFetch).toBe(false)
		expect(parsed.skipInstall).toBe(false)
	})

	test("accepts ref overrides and keep counts", () => {
		const parsed = parseOmobArgs(
			["--senpi-ref", "origin/feat/x", "--omo-ref", "abc1234", "--keep", "5", "--skip-fetch", "--skip-install"],
			"linux",
			"x64",
			"/home/dev",
		)
		expect(parsed.senpiRef).toBe("origin/feat/x")
		expect(parsed.omoRef).toBe("abc1234")
		expect(parsed.keep).toBe(5)
		expect(parsed.skipFetch).toBe(true)
		expect(parsed.skipInstall).toBe(true)
		expect(parsed.target).toBe("linux-x64")
	})

	test("rejects unknown flags", () => {
		expect(() => parseOmobArgs(["--nonsense"], "darwin", "arm64", "/home/dev")).toThrow()
	})

	test("maps host platforms onto release targets", () => {
		expect(hostTargetFor("darwin", "arm64")).toBe("darwin-arm64")
		expect(hostTargetFor("darwin", "x64")).toBe("darwin-x64")
		expect(hostTargetFor("linux", "arm64")).toBe("linux-arm64")
		expect(hostTargetFor("linux", "x64")).toBe("linux-x64")
		expect(hostTargetFor("win32", "x64")).toBe("windows-x64")
	})
})

describe("deriveOmobAiVersion", () => {
	test("embeds both short shas in the dev version", () => {
		expect(deriveOmobAiVersion("c6e7dd7fb0f993336ed61c62acc5d55c6ada8bfc", "7fd18dfeec7a7db89a983b2c3cb90835b8c3c5f7")).toBe(
			"0.0.0-omob.c6e7dd7.7fd18df",
		)
	})
})

describe("acquireCacheLock", () => {
	test("#given a free cache #when the lock is taken #then it records this pid and releases", () => {
		const cacheDir = tempDir("omob-lock-free-")
		try {
			const lock = acquireCacheLock(cacheDir, 4242)
			expect(lock.path).toBe(join(cacheDir, ".lock"))
			expect(readFileSync(lock.path, "utf8").trim()).toBe("4242")
			lock.release()
			expect(existsSync(lock.path)).toBe(false)
		} finally {
			rmSync(cacheDir, { recursive: true, force: true })
		}
	})

	test("#given a live holder #when a second build starts #then it fails fast naming the holder and lock", () => {
		const cacheDir = tempDir("omob-lock-busy-")
		try {
			const held = acquireCacheLock(cacheDir, process.pid)
			// A concurrent build shares clone/install/tarball/output state; interleaving them can
			// pack one run's engine under another run's provenance stamp.
			expect(() => acquireCacheLock(cacheDir, process.pid + 1)).toThrow(
				new RegExp(`another omob build is running \\(pid ${process.pid}\\).*\\.lock`, "s"),
			)
			held.release()
			const after = acquireCacheLock(cacheDir, 777)
			expect(readFileSync(after.path, "utf8").trim()).toBe("777")
			after.release()
		} finally {
			rmSync(cacheDir, { recursive: true, force: true })
		}
	})

	test("#given a lock left by a dead process #when a build starts #then the stale lock is reclaimed", () => {
		const cacheDir = tempDir("omob-lock-stale-")
		try {
			mkdirSync(cacheDir, { recursive: true })
			writeFileSync(join(cacheDir, ".lock"), `${deadPid()}\n`)
			const lock = acquireCacheLock(cacheDir, 99_001)
			expect(readFileSync(lock.path, "utf8").trim()).toBe("99001")
			lock.release()
		} finally {
			rmSync(cacheDir, { recursive: true, force: true })
		}
	})

	test("#given a released lock #when release is called again #then it stays a no-op", () => {
		const cacheDir = tempDir("omob-lock-idem-")
		try {
			const lock = acquireCacheLock(cacheDir, 31_337)
			lock.release()
			const other = acquireCacheLock(cacheDir, 31_338)
			lock.release()
			// The first lock must not delete a lock it no longer owns.
			expect(existsSync(other.path)).toBe(true)
			expect(readFileSync(other.path, "utf8").trim()).toBe("31338")
			other.release()
		} finally {
			rmSync(cacheDir, { recursive: true, force: true })
		}
	})
})

describe("packSoleSenpiTarball", () => {
	test("#given a decoy tarball from a previous version #when packing #then the decoy is gone and the fresh one is returned", () => {
		const cacheDir = tempDir("omob-pack-decoy-")
		const tarballDir = join(cacheDir, "tarballs")
		try {
			mkdirSync(tarballDir, { recursive: true })
			writeFileSync(join(tarballDir, "code-yeongyu-senpi-1900.1.1.tgz"), "stale")
			const name = packSoleSenpiTarball(tarballDir, () => {
				writeFileSync(join(tarballDir, "code-yeongyu-senpi-2026.9.4.tgz"), "fresh")
			})
			expect(name).toBe("code-yeongyu-senpi-2026.9.4.tgz")
			expect(readdirSync(tarballDir)).toEqual(["code-yeongyu-senpi-2026.9.4.tgz"])
		} finally {
			rmSync(cacheDir, { recursive: true, force: true })
		}
	})

	test("#given a pack that produces nothing #when packing #then it throws", () => {
		const cacheDir = tempDir("omob-pack-none-")
		try {
			expect(() => packSoleSenpiTarball(join(cacheDir, "tarballs"), () => {})).toThrow(/found 0/)
		} finally {
			rmSync(cacheDir, { recursive: true, force: true })
		}
	})

	test("#given a pack that produces two tarballs #when packing #then it throws naming both", () => {
		const cacheDir = tempDir("omob-pack-two-")
		const tarballDir = join(cacheDir, "tarballs")
		try {
			expect(() =>
				packSoleSenpiTarball(tarballDir, () => {
					writeFileSync(join(tarballDir, "a-1.0.0.tgz"), "x")
					writeFileSync(join(tarballDir, "b-2.0.0.tgz"), "x")
				}),
			).toThrow(/found 2: a-1\.0\.0\.tgz, b-2\.0\.0\.tgz/) // sorted, so the message is deterministic
		} finally {
			rmSync(cacheDir, { recursive: true, force: true })
		}
	})

	test("#given non-tarball residue #when packing #then only .tgz files are considered", () => {
		const cacheDir = tempDir("omob-pack-residue-")
		const tarballDir = join(cacheDir, "tarballs")
		try {
			const name = packSoleSenpiTarball(tarballDir, () => {
				writeFileSync(join(tarballDir, "notes.txt"), "x")
				writeFileSync(join(tarballDir, "pkg-1.0.0.tgz"), "x")
			})
			expect(name).toBe("pkg-1.0.0.tgz")
		} finally {
			rmSync(cacheDir, { recursive: true, force: true })
		}
	})
})

describe("resolveCachedSenpiPackage", () => {
	test("#given a cache manifest for one commit #when resolving another commit #then it never reuses the package", () => {
		const cacheDir = tempDir("omob-artifact-cache-")
		try {
			const artifactRoot = join(cacheDir, "artifacts", "senpi", "aaa1111", "install", "node_modules", "@code-yeongyu", "senpi")
			mkdirSync(artifactRoot, { recursive: true })
			writeFileSync(
				join(cacheDir, "artifacts", "senpi", "aaa1111", "manifest.json"),
				JSON.stringify({ commit: "aaa1111", packageRoot: artifactRoot, tarballName: "senpi.tgz" }),
			)
			expect(resolveCachedSenpiPackage(cacheDir, "bbb2222")).toBeUndefined()
			expect(resolveCachedSenpiPackage(cacheDir, "aaa1111")).toBe(artifactRoot)
		} finally {
			rmSync(cacheDir, { recursive: true, force: true })
		}
	})
})

describe("ensureCacheClone submodule ordering", () => {
	// git refuses file:// submodule transport by default (CVE-2022-39253), and
	// ensureCacheClone shells out with process.env, so the allowance has to live there for
	// the subject under test too — not only in this helper.
	const fixtureEnv = {
		GIT_CONFIG_COUNT: "3",
		GIT_CONFIG_KEY_0: "protocol.file.allow",
		GIT_CONFIG_VALUE_0: "always",
		GIT_CONFIG_KEY_1: "user.email",
		GIT_CONFIG_VALUE_1: "t@example.com",
		GIT_CONFIG_KEY_2: "user.name",
		GIT_CONFIG_VALUE_2: "Test",
	} as const

	const git = (args: readonly string[], cwd: string): void => {
		const result = spawnSync("git", [...args], { cwd, encoding: "utf8", env: { ...process.env, ...fixtureEnv } })
		if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${result.stdout}${result.stderr}`)
	}

	test("#given a ref whose submodule pointer moved #when the cache checks it out #then submodule content matches that ref", () => {
		const rootDir = tempDir("omob-submodule-")
		try {
			// upstream submodule with two commits
			const subWork = join(rootDir, "sub-work")
			mkdirSync(subWork, { recursive: true })
			git(["init", "-q", "-b", "main"], subWork)
			writeFileSync(join(subWork, "SKILL.md"), "v1\n")
			git(["add", "-A"], subWork)
			git(["commit", "-qm", "v1"], subWork)
			writeFileSync(join(subWork, "SKILL.md"), "v2\n")
			git(["add", "-A"], subWork)
			git(["commit", "-qm", "v2"], subWork)
			const subBare = join(rootDir, "sub.git")
			git(["clone", "-q", "--bare", subWork, subBare], rootDir)
			git(["config", "uploadpack.allowReachableSHA1InWant", "true"], subBare)

			// superproject: commit A pins v1, commit B pins v2
			const superWork = join(rootDir, "super-work")
			mkdirSync(superWork, { recursive: true })
			git(["init", "-q", "-b", "dev"], superWork)
			writeFileSync(join(superWork, "README.md"), "super\n")
			git(["add", "-A"], superWork)
			git(["commit", "-qm", "init"], superWork)
			git(["submodule", "add", "-q", pathToFileURL(subBare).href, "upstreams/skill"], superWork)
			const subInSuper = join(superWork, "upstreams", "skill")
			git(["checkout", "-q", "--detach", "HEAD~1"], subInSuper)
			git(["add", "-A"], superWork)
			git(["commit", "-qm", "pin submodule at v1"], superWork)
			git(["-C", subInSuper, "checkout", "-q", "--detach", "main"], superWork)
			git(["add", "-A"], superWork)
			git(["commit", "-qm", "bump submodule to v2"], superWork)
			const superBare = join(rootDir, "super.git")
			git(["clone", "-q", "--bare", superWork, superBare], rootDir)

			const cache = join(rootDir, "cache", "omo")
			const read = (): string => readFileSync(join(cache, "upstreams", "skill", "SKILL.md"), "utf8").trim()
			const restoreEnv = { ...process.env }
			Object.assign(process.env, fixtureEnv)

			// fresh clone at the tip: submodule must be at v2
			ensureCacheClone(pathToFileURL(superBare).href, cache, "origin/dev", false)
			expect(read()).toBe("v2")

			// switch BACK to the commit that pins v1 — reusing the same cache. checkout/reset do
			// not recurse, so only a post-checkout submodule sync can make this match the ref.
			ensureCacheClone(pathToFileURL(superBare).href, cache, "origin/dev~1", false)
			expect(read()).toBe("v1")

			// and forward again
			ensureCacheClone(pathToFileURL(superBare).href, cache, "origin/dev", false)
			expect(read()).toBe("v2")

			// A raw SHA is not a fetchable refspec either; resolving it must still work.
			const olderSha = spawnSync("git", ["rev-parse", "origin/dev~1"], { cwd: cache, encoding: "utf8" }).stdout.trim()
			ensureCacheClone(pathToFileURL(superBare).href, cache, olderSha, false)
			expect(read()).toBe("v1")

			for (const key of Object.keys(fixtureEnv)) delete process.env[key]
			Object.assign(process.env, restoreEnv)
		} finally {
			rmSync(rootDir, { recursive: true, force: true })
		}
	}, 120_000)
})
