/// <reference types="bun-types" />

import { afterEach, describe, expect, it } from "bun:test"
import { spawn } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { pruneMarketplaceCache } from "./codex-cache-prune"

const createdRoots: string[] = []

function createCacheWithRunningRuntime(): { codexHome: string; stalePath: string; stop: () => void } {
	const codexHome = mkdtempSync(join(tmpdir(), "omo-codex-cache-prune-"))
	createdRoots.push(codexHome)
	const stalePath = join(codexHome, "plugins", "cache", "sisyphuslabs", "omo-old")
	mkdirSync(join(stalePath, "node_modules", "runtime"), { recursive: true })
	writeFileSync(join(stalePath, "package.json"), "{}")

	const runtimeName = process.platform === "win32" ? "server.exe" : "server"
	const runtimePath = join(stalePath, "node_modules", "runtime", runtimeName)
	copyFileSync(process.execPath, runtimePath)

	const child = spawn(runtimePath, ["-e", "setTimeout(() => {}, 30000)"], { stdio: "ignore" })
	return { codexHome, stalePath, stop: () => { try { child.kill() } catch { /* already gone */ } } }
}

afterEach(() => {
	for (const root of createdRoots.splice(0)) {
		rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
	}
})

describe("pruneMarketplaceCache", () => {
	it("#given a stale entry whose runtime is still alive #when it exits during the prune #then the entry is removed", async () => {
		// given
		const cache = createCacheWithRunningRuntime()
		await new Promise((resolve) => setTimeout(resolve, 400))
		setTimeout(cache.stop, 300)

		// when
		await pruneMarketplaceCache({
			codexHome: cache.codexHome,
			marketplaceName: "sisyphuslabs",
			keepPluginNames: [],
		})

		// then
		expect(existsSync(cache.stalePath)).toBe(false)
		cache.stop()
	}, { timeout: 20_000 })
})
