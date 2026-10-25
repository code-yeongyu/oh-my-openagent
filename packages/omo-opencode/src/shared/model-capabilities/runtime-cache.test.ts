/// <reference types="bun-types" />
import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import type { ModelCapabilitiesSnapshot } from "@oh-my-opencode/model-core"
import { getBundledModelCapabilitiesSnapshot, getModelCapabilities, readRuntimeModelCapabilitiesSnapshot } from "./index"

const k31: ModelCapabilitiesSnapshot["models"][string] = {
	id: "k3.1-pro",
	family: "kimi",
	reasoning: true,
	toolCall: true,
	limit: { context: 1048576, output: 131072 },
}

function snapshot(generatedAt: string, models: ModelCapabilitiesSnapshot["models"]): ModelCapabilitiesSnapshot {
	return { generatedAt, sourceUrl: "https://models.dev/api.json", models }
}

const tempDirs: string[] = []
afterEach(() => {
	for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe("runtime model-capabilities cache", () => {
	test("#given a refreshed cache with a model the bundled snapshot lacks #when resolving #then the cache entry is used", () => {
		const bundled = getBundledModelCapabilitiesSnapshot()
		expect(bundled.models["k3.1-pro"]).toBeUndefined()

		const without = getModelCapabilities({ providerID: "kimi-for-coding", modelID: "k3.1-pro", runtimeSnapshot: undefined, providerCache: { findProviderModelMetadata: () => undefined } as never })
		const runtime = readRuntimeModelCapabilitiesSnapshot(() => snapshot("2099-01-01T00:00:00.000Z", { "k3.1-pro": k31 }))
		const withCache = getModelCapabilities({ providerID: "kimi-for-coding", modelID: "k3.1-pro", runtimeSnapshot: runtime, providerCache: { findProviderModelMetadata: () => undefined } as never })

		expect(withCache.diagnostics.snapshot.source).toBe("runtime-snapshot")
		expect(withCache.diagnostics.resolutionMode).toBe("snapshot-backed")
		expect(withCache.maxOutputTokens).toBe(131072)
		expect(without.diagnostics.snapshot.source).not.toBe("runtime-snapshot")
	})

	test("#given a provider-qualified cache key #when resolving #then it wins over the bare bundled entry", () => {
		const runtime = readRuntimeModelCapabilitiesSnapshot(() =>
			snapshot("2099-01-01T00:00:00.000Z", { "opencode-go/kimi-k3.1-pro": { ...k31, id: "kimi-k3.1-pro", limit: { context: 1048576, output: 65536 } } }),
		)
		const result = getModelCapabilities({ providerID: "opencode-go", modelID: "kimi-k3.1-pro", runtimeSnapshot: runtime, providerCache: { findProviderModelMetadata: () => undefined } as never })
		expect(result.diagnostics.snapshot.source).toBe("runtime-snapshot")
		expect(result.maxOutputTokens).toBe(65536)
	})

	test("#given no cache, a malformed cache, an unreadable cache, or one older than the bundled snapshot #when reading #then it is ignored", () => {
		expect(readRuntimeModelCapabilitiesSnapshot(() => null)).toBeUndefined()
		expect(readRuntimeModelCapabilitiesSnapshot(() => ({ generatedAt: "2099-01-01T00:00:00.000Z" }) as never)).toBeUndefined()
		expect(readRuntimeModelCapabilitiesSnapshot(() => ({ generatedAt: "2099-01-01T00:00:00.000Z", models: [] }) as never)).toBeUndefined()
		expect(readRuntimeModelCapabilitiesSnapshot(() => { throw new Error("EACCES") })).toBeUndefined()
		expect(readRuntimeModelCapabilitiesSnapshot(() => snapshot("2026-01-01T00:00:00.000Z", { "k3.1-pro": k31 }), "2026-07-29T03:28:21.339Z")).toBeUndefined()
		expect(readRuntimeModelCapabilitiesSnapshot(() => snapshot("2026-08-01T00:00:00.000Z", { "k3.1-pro": k31 }), "2026-07-29T03:28:21.339Z")).toBeDefined()
	})

	test("#given model-capabilities.json in the OMO cache dir #when getModelCapabilities runs with no explicit snapshot #then it reads that file", async () => {
		const root = mkdtempSync(join(tmpdir(), "omo-runtime-capabilities-"))
		tempDirs.push(root)
		mkdirSync(join(root, "oh-my-opencode"), { recursive: true })
		writeFileSync(
			join(root, "oh-my-opencode", "model-capabilities.json"),
			JSON.stringify(snapshot("2099-01-01T00:00:00.000Z", { "k3.1-pro": k31 })),
		)
		// A fresh process: the default cache store memoizes per process.
		const script = [
			`const { getModelCapabilities } = await import(${JSON.stringify(resolve(import.meta.dir, "index.ts"))})`,
			`const r = getModelCapabilities({ providerID: "kimi-for-coding", modelID: "k3.1-pro" })`,
			`console.log(JSON.stringify({ source: r.diagnostics.snapshot.source, mode: r.diagnostics.resolutionMode, output: r.maxOutputTokens }))`,
		].join("\n")
		const child = Bun.spawnSync([process.execPath, "-e", script], {
			env: { ...process.env, XDG_CACHE_HOME: root },
			stdout: "pipe",
			stderr: "pipe",
		})
		const lines = child.stdout.toString().trim().split(/\r?\n/)
		expect(child.exitCode).toBe(0)
		expect(JSON.parse(lines.at(-1) ?? "{}")).toEqual({ source: "runtime-snapshot", mode: "snapshot-backed", output: 131072 })
	})
})
