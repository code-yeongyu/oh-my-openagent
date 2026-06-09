import { describe, it, expect, beforeAll, afterAll } from "bun:test"
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createSessionStorage } from "./session-storage"

const testDir = join(tmpdir(), "session-storage-test-" + Date.now())

beforeAll(() => {
	mkdirSync(testDir, { recursive: true })
})

afterAll(() => {
	rmSync(testDir, { recursive: true, force: true })
})

describe("createSessionStorage", () => {
	describe("#given plain JSON state (no serialize/deserialize)", () => {
		interface SimpleState {
			sessionID: string
			value: number
		}

		const storageDir = join(testDir, "simple")
		const storage = createSessionStorage<SimpleState>({
			storageDir,
		})

		it("#then round-trips write and read correctly", () => {
			const state: SimpleState = { sessionID: "s1", value: 42 }
			storage.save("s1", state)
			const loaded = storage.load("s1")
			expect(loaded).toEqual(state)
		})

		it("#then returns null when file does not exist", () => {
			const loaded = storage.load("nonexistent")
			expect(loaded).toBeNull()
		})

		it("#then clears the file", () => {
			storage.save("s2", { sessionID: "s2", value: 1 })
			storage.clear("s2")
			expect(storage.load("s2")).toBeNull()
		})

		it("#then returns null on corrupted JSON", () => {
			mkdirSync(join(testDir, "corrupted"), { recursive: true })
			const corruptedStorage = createSessionStorage<SimpleState>({
				storageDir: join(testDir, "corrupted"),
			})
			writeFileSync(
				join(testDir, "corrupted", "bad.json"),
				"not valid json{{{",
			)
			expect(corruptedStorage.load("bad")).toBeNull()
		})
	})

	describe("#given defaultValue provided", () => {
		const storageDir = join(testDir, "with-default")

		it("#then returns cloned defaultValue when file does not exist", () => {
			const storage = createSessionStorage<Set<string>, string[]>({
				storageDir,
				defaultValue: new Set(),
				serialize: (state) => [...state],
				deserialize: (data) => new Set(data),
			})

			const result1 = storage.load("missing1")
			const result2 = storage.load("missing2")

			expect(result1).toEqual(new Set())
			expect(result2).toEqual(new Set())
			// Must be different instances (structuredClone)
			result1.add("mutated")
			expect(result2.has("mutated")).toBe(false)
		})

		it("#then returns cloned defaultValue on corrupted JSON", () => {
			mkdirSync(join(testDir, "default-corrupted"), { recursive: true })
			const storage = createSessionStorage<Set<string>, string[]>({
				storageDir: join(testDir, "default-corrupted"),
				defaultValue: new Set(),
				serialize: (state) => [...state],
				deserialize: (data) => new Set(data),
			})
			writeFileSync(
				join(testDir, "default-corrupted", "bad.json"),
				"<<<invalid>>>",
			)
			expect(storage.load("bad")).toEqual(new Set())
		})
	})

	describe("#given custom serialize/deserialize (Set↔Array)", () => {
		const storageDir = join(testDir, "set-array")

		interface SerializedData {
			sessionID: string
			items: string[]
			updatedAt: number
		}

		const storage = createSessionStorage<Set<string>, SerializedData>({
			storageDir,
			defaultValue: new Set(),
			serialize: (state, sessionID) => ({
				sessionID,
				items: [...state],
				updatedAt: Date.now(),
			}),
			deserialize: (data) => new Set(data.items),
		})

		it("#then round-trips Set through Array serialization", () => {
			const original = new Set(["a", "b", "c"])
			storage.save("s1", original)
			const loaded = storage.load("s1")
			expect(loaded).toEqual(original)
		})

		it("#then writes valid JSON with expected shape", () => {
			const { readFileSync } = require("node:fs")
			storage.save("shape-check", new Set(["x"]))
			const raw = JSON.parse(
				readFileSync(join(storageDir, "shape-check.json"), "utf-8"),
			)
			expect(raw.sessionID).toBe("shape-check")
			expect(raw.items).toEqual(["x"])
			expect(typeof raw.updatedAt).toBe("number")
		})
	})

	describe("#given backward compatibility fixtures", () => {
		it("#then reads agent-usage-reminder format", () => {
			const dir = join(testDir, "compat-agent-usage")
			mkdirSync(dir, { recursive: true })
			writeFileSync(
				join(dir, "sess1.json"),
				JSON.stringify({
					sessionID: "sess1",
					agentUsed: true,
					reminderCount: 3,
					updatedAt: 1700000000000,
				}),
			)

			interface AgentUsageState {
				sessionID: string
				agentUsed: boolean
				reminderCount: number
				updatedAt: number
			}

			const storage = createSessionStorage<AgentUsageState>({
				storageDir: dir,
			})
			const loaded = storage.load("sess1")
			expect(loaded).toEqual({
				sessionID: "sess1",
				agentUsed: true,
				reminderCount: 3,
				updatedAt: 1700000000000,
			})
		})

		it("#then reads interactive-bash-session format", () => {
			const dir = join(testDir, "compat-bash")
			mkdirSync(dir, { recursive: true })
			writeFileSync(
				join(dir, "sess1.json"),
				JSON.stringify({
					sessionID: "sess1",
					tmuxSessions: ["tmux-1", "tmux-2"],
					updatedAt: 1700000000000,
				}),
			)

			interface SerializedState {
				sessionID: string
				tmuxSessions: string[]
				updatedAt: number
			}

			interface State {
				sessionID: string
				tmuxSessions: Set<string>
				updatedAt: number
			}

			const storage = createSessionStorage<State, SerializedState>({
				storageDir: dir,
				deserialize: (data) => ({
					sessionID: data.sessionID,
					tmuxSessions: new Set(data.tmuxSessions),
					updatedAt: data.updatedAt,
				}),
				serialize: (state, _sessionID) => ({
					sessionID: state.sessionID,
					tmuxSessions: Array.from(state.tmuxSessions),
					updatedAt: state.updatedAt,
				}),
			})

			const loaded = storage.load("sess1")
			expect(loaded).toEqual({
				sessionID: "sess1",
				tmuxSessions: new Set(["tmux-1", "tmux-2"]),
				updatedAt: 1700000000000,
			})
		})

		it("#then reads rules-injector format without injectedRealPaths (backward compat)", () => {
			const dir = join(testDir, "compat-rules")
			mkdirSync(dir, { recursive: true })
			// Old format: no injectedRealPaths field
			writeFileSync(
				join(dir, "sess1.json"),
				JSON.stringify({
					sessionID: "sess1",
					injectedHashes: ["hash1", "hash2"],
					updatedAt: 1700000000000,
				}),
			)

			interface InjectedRulesData {
				sessionID: string
				injectedHashes: string[]
				injectedRealPaths?: string[]
				updatedAt: number
			}

			type RulesState = {
				contentHashes: Set<string>
				realPaths: Set<string>
			}

			const storage = createSessionStorage<RulesState, InjectedRulesData>({
				storageDir: dir,
				defaultValue: { contentHashes: new Set(), realPaths: new Set() },
				deserialize: (data) => ({
					contentHashes: new Set(data.injectedHashes),
					realPaths: new Set(data.injectedRealPaths ?? []),
				}),
				serialize: (state, sessionID) => ({
					sessionID,
					injectedHashes: [...state.contentHashes],
					injectedRealPaths: [...state.realPaths],
					updatedAt: Date.now(),
				}),
			})

			const loaded = storage.load("sess1")
			expect(loaded).toEqual({
				contentHashes: new Set(["hash1", "hash2"]),
				realPaths: new Set(),
			})
		})

		it("#then reads rules-injector format with injectedRealPaths", () => {
			const dir = join(testDir, "compat-rules-full")
			mkdirSync(dir, { recursive: true })
			writeFileSync(
				join(dir, "sess1.json"),
				JSON.stringify({
					sessionID: "sess1",
					injectedHashes: ["h1"],
					injectedRealPaths: ["/path/a", "/path/b"],
					updatedAt: 1700000000000,
				}),
			)

			interface InjectedRulesData {
				sessionID: string
				injectedHashes: string[]
				injectedRealPaths?: string[]
				updatedAt: number
			}

			type RulesState = {
				contentHashes: Set<string>
				realPaths: Set<string>
			}

			const storage = createSessionStorage<RulesState, InjectedRulesData>({
				storageDir: dir,
				defaultValue: { contentHashes: new Set(), realPaths: new Set() },
				deserialize: (data) => ({
					contentHashes: new Set(data.injectedHashes),
					realPaths: new Set(data.injectedRealPaths ?? []),
				}),
				serialize: (state, sessionID) => ({
					sessionID,
					injectedHashes: [...state.contentHashes],
					injectedRealPaths: [...state.realPaths],
					updatedAt: Date.now(),
				}),
			})

			const loaded = storage.load("sess1")
			expect(loaded).toEqual({
				contentHashes: new Set(["h1"]),
				realPaths: new Set(["/path/a", "/path/b"]),
			})
		})
	})

	describe("#given clear on nonexistent file", () => {
		it("#then does not throw", () => {
			const storage = createSessionStorage<{ id: string }>({
				storageDir: join(testDir, "clear-noop"),
			})
			expect(() => storage.clear("nonexistent")).not.toThrow()
		})
	})

	describe("#given storageDir does not exist", () => {
		it("#then save creates the directory", () => {
			const dir = join(testDir, "auto-create", "nested")
			const storage = createSessionStorage<{ id: string }>({
				storageDir: dir,
			})
			storage.save("s1", { id: "test" })
			expect(existsSync(dir)).toBe(true)
			expect(storage.load("s1")).toEqual({ id: "test" })
		})
	})

	// T5 — sanitize is always-on but fail-safe: an unsafe sessionID degrades
	// (load falls back, save/clear no-op) without throwing, and never touches the
	// filesystem outside storageDir. Traversal defense is preserved.
	describe("#given an unsafe sessionID (sanitize fail-safe degrade)", () => {
		const storageDir = join(testDir, "sanitize")
		const storage = createSessionStorage<{ id: string }>({ storageDir })

		it("#then load degrades to null and does not escape storageDir", () => {
			expect(storage.load("../evil")).toBeNull()
			expect(existsSync(join(testDir, "evil.json"))).toBe(false)
		})

		it("#then save is a no-op and writes nothing outside storageDir", () => {
			expect(() => storage.save("../evil", { id: "x" })).not.toThrow()
			expect(existsSync(join(testDir, "evil.json"))).toBe(false)
		})

		it("#then clear is a no-op and does not throw", () => {
			expect(() => storage.clear("../evil")).not.toThrow()
		})

		it("#then an over-length sessionID degrades on load/save/clear (length cap)", () => {
			const longID = "a".repeat(200)
			expect(storage.load(longID)).toBeNull()
			expect(() => storage.save(longID, { id: "x" })).not.toThrow()
			expect(existsSync(join(storageDir, `${longID}.json`))).toBe(false)
			expect(() => storage.clear(longID)).not.toThrow()
		})
	})

	// T6 — onParseError selects the catch behavior. The catch wraps both
	// JSON.parse and deserialize, so a deserialize that throws a non-Error
	// value exercises the non-Error branch deterministically.
	describe("#given onParseError", () => {
		it("#then 'fallback' (default) swallows a non-Error throw and returns null", () => {
			const dir = join(testDir, "onparse-fallback-nonerror")
			mkdirSync(dir, { recursive: true })
			writeFileSync(join(dir, "s.json"), JSON.stringify({ ok: true }))
			const storage = createSessionStorage<{ ok: boolean }, { ok: boolean }>({
				storageDir: dir,
				deserialize: () => {
					throw "boom"
				},
			})
			expect(storage.load("s")).toBeNull()
		})

		it("#then 'fallback' returns defaultValue on malformed JSON (Error branch)", () => {
			const dir = join(testDir, "onparse-fallback-error")
			mkdirSync(dir, { recursive: true })
			writeFileSync(join(dir, "s.json"), "{not json")
			const storage = createSessionStorage<{ ok: boolean }>({
				storageDir: dir,
				defaultValue: { ok: false },
				onParseError: "fallback",
			})
			expect(storage.load("s")).toEqual({ ok: false })
		})

		it("#then 'rethrow-non-error' re-throws a non-Error value", () => {
			const dir = join(testDir, "onparse-rethrow-nonerror")
			mkdirSync(dir, { recursive: true })
			writeFileSync(join(dir, "s.json"), JSON.stringify({ ok: true }))
			const storage = createSessionStorage<{ ok: boolean }, { ok: boolean }>({
				storageDir: dir,
				onParseError: "rethrow-non-error",
				deserialize: () => {
					throw "boom"
				},
			})
			expect(() => storage.load("s")).toThrow("boom")
		})

		it("#then 'rethrow-non-error' still falls back on Error-type failures", () => {
			const dir = join(testDir, "onparse-rethrow-error")
			mkdirSync(dir, { recursive: true })
			writeFileSync(join(dir, "s.json"), "{not json")
			const storage = createSessionStorage<{ ok: boolean }>({
				storageDir: dir,
				onParseError: "rethrow-non-error",
			})
			expect(storage.load("s")).toBeNull()
		})
	})

	// T7 — retryOnENOENT must survive the storageDir vanishing between checks
	// (TOCTOU), and the data written after retry must round-trip identically.
	describe("#given retryOnENOENT", () => {
		it("#then save recreates a deleted storageDir and data is identical", () => {
			const dir = join(testDir, "retry-enoent")
			const storage = createSessionStorage<Set<string>, string[]>({
				storageDir: dir,
				defaultValue: new Set(),
				retryOnENOENT: true,
				serialize: (state) => [...state],
				deserialize: (data) => new Set(data),
			})
			storage.save("s1", new Set(["seed"]))
			rmSync(dir, { recursive: true, force: true })
			expect(existsSync(dir)).toBe(false)

			const original = new Set(["a", "b", "c"])
			expect(() => storage.save("s1", original)).not.toThrow()
			expect(existsSync(dir)).toBe(true)
			expect(storage.load("s1")).toEqual(original)
		})
	})

	// T8 — defaults: sanitize on, onParseError "fallback", retryOnENOENT false.
	describe("#given no flags (defaults)", () => {
		const dir = join(testDir, "defaults")
		const storage = createSessionStorage<{ id: string }>({ storageDir: dir })

		it("#then sanitize defaults to on (fail-safe: load degrades to null, no escape)", () => {
			expect(storage.load("../evil")).toBeNull()
			expect(existsSync(join(testDir, "evil.json"))).toBe(false)
		})

		it("#then onParseError defaults to 'fallback' (returns null, no throw)", () => {
			mkdirSync(dir, { recursive: true })
			writeFileSync(join(dir, "bad.json"), "{not json")
			expect(storage.load("bad")).toBeNull()
		})

		it("#then retryOnENOENT defaults to false: save still creates the dir on first write", () => {
			const freshDir = join(testDir, "defaults-fresh")
			const s = createSessionStorage<{ id: string }>({ storageDir: freshDir })
			s.save("s1", { id: "test" })
			expect(s.load("s1")).toEqual({ id: "test" })
		})
	})

	// T9 — type-level: the defaultValue overload returns non-null TState; the
	// flag-only overload returns TState | null. Flags must not collapse overloads.
	// These assertions are compile-time only; the bodies must never dereference a
	// possibly-null value at runtime, so the type-only checks live in an unreached
	// function that the type-checker still analyzes.
	describe("#given the typed overloads (compile-time assertions)", () => {
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		function _typeAssertions() {
			const withDefault = createSessionStorage<{ id: string }>({
				storageDir: join(testDir, "type-default"),
				defaultValue: { id: "d" },
				onParseError: "rethrow-non-error",
				retryOnENOENT: true,
			})
			// load returns TState (non-null): direct member access must typecheck.
			const a: string = withDefault.load("s").id
			void a

			const withoutDefault = createSessionStorage<{ id: string }>({
				storageDir: join(testDir, "type-nullable"),
				onParseError: "fallback",
			})
			const loaded = withoutDefault.load("missing")
			// @ts-expect-error load may be null here, so .id is not allowed
			void loaded.id
		}

		it("#then defaultValue overload returns non-null and flag-only returns nullable", () => {
			const withDefault = createSessionStorage<{ id: string }>({
				storageDir: join(testDir, "type-default-rt"),
				defaultValue: { id: "d" },
			})
			expect(withDefault.load("missing")).toEqual({ id: "d" })

			const withoutDefault = createSessionStorage<{ id: string }>({
				storageDir: join(testDir, "type-nullable-rt"),
			})
			expect(withoutDefault.load("missing")).toBeNull()
		})
	})
})
