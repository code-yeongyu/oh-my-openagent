import { afterEach, expect, test } from "bun:test"
import { clearDelegatedChildSessionBootstrap, registerDelegatedChildSessionBootstrap } from "./delegated-child-session-bootstrap"
import { clearAllSessionFallbackSnapshots, clearSessionFallbackSnapshot, getSessionFallbackSnapshot, setSessionFallbackSnapshot } from "./session-fallback-snapshot"

afterEach(clearAllSessionFallbackSnapshots)

test("fallback snapshots distinguish unregistered from empty and clone nested settings", () => {
  const chain = [{ providers: ["budget"], model: "backup", thinking: { type: "enabled" as const, budgetTokens: 100 } }]
  expect(getSessionFallbackSnapshot("child")).toBeUndefined()
  setSessionFallbackSnapshot("child", chain)
  chain[0].providers[0] = "changed"
  chain[0].thinking.budgetTokens = 200
  const snapshot = getSessionFallbackSnapshot("child")
  if (!snapshot) throw new Error("Missing dispatch snapshot")
  expect(snapshot[0]).toEqual({ providers: ["budget"], model: "backup", thinking: { type: "enabled", budgetTokens: 100 } })
  snapshot[0].providers.push("changed")
  const thinking = snapshot[0].thinking
  if (!thinking) throw new Error("Missing captured thinking settings")
  thinking.budgetTokens = 300
  expect(getSessionFallbackSnapshot("child")?.[0]).toEqual({ providers: ["budget"], model: "backup", thinking: { type: "enabled", budgetTokens: 100 } })
  setSessionFallbackSnapshot("child", undefined)
  expect(getSessionFallbackSnapshot("child")).toEqual([])
  clearSessionFallbackSnapshot("child")
  expect(getSessionFallbackSnapshot("child")).toBeUndefined()
})

test("the creation snapshot survives prompt-bootstrap cleanup for later continuation", () => {
  registerDelegatedChildSessionBootstrap({ sessionID: "child", promptText: "work", fallbackChain: [{ providers: ["budget"], model: "backup" }] })
  clearDelegatedChildSessionBootstrap("child")
  expect(getSessionFallbackSnapshot("child")).toEqual([{ providers: ["budget"], model: "backup" }])
  clearSessionFallbackSnapshot("child")
  expect(getSessionFallbackSnapshot("child")).toBeUndefined()
})
