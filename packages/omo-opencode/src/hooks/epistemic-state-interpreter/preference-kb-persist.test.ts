import { describe, expect, test, mock } from "bun:test"

import { persistPreferenceToKb } from "./preference-kb-persist"
import type { RulePreference } from "./preference-types"

function createKbAddMock(impl?: () => Promise<{ id: string }>) {
  return mock(impl ?? (async () => ({ id: "kb-1" })))
}

describe("persistPreferenceToKb", () => {
  describe("#given a support-derived preference", () => {
    test("#when persisting #then kbAdd is called with layer=Learned, Preference content, and prefer:support:<reason> tags", async () => {
      const kbAdd = createKbAddMock()
      const preference: RulePreference = {
        superior: "rule-alpha",
        inferior: "rule-beta",
        strength: 0.7,
      }

      await persistPreferenceToKb({
        client: { kbAdd } as unknown as Parameters<typeof persistPreferenceToKb>[0]["client"],
        preference,
        kind: "support",
        reason: "multi-plane",
      })

      expect(kbAdd).toHaveBeenCalledTimes(1)
      const calls = kbAdd.mock.calls as unknown[][]
      const call = calls[0]?.[0] as {
        layer: string
        content: { Preference: { superior: string; inferior: string } }
        tags: string[]
      }
      expect(call.layer).toBe("Learned")
      expect(call.content).toEqual({
        Preference: { superior: "rule-alpha", inferior: "rule-beta" },
      })
      expect(call.tags).toContain("prefer:support:multi-plane")
    })
  })

  describe("#given a constraint-derived preference", () => {
    test("#when persisting #then kbAdd is called with prefer:constraint:<reason> tag", async () => {
      const kbAdd = createKbAddMock()
      const preference: RulePreference = {
        superior: "rule-x",
        inferior: "rule-y",
        strength: 1,
      }

      await persistPreferenceToKb({
        client: { kbAdd } as unknown as Parameters<typeof persistPreferenceToKb>[0]["client"],
        preference,
        kind: "constraint",
        reason: "blocked",
      })

      expect(kbAdd).toHaveBeenCalledTimes(1)
      const calls = kbAdd.mock.calls as unknown[][]
      const call = calls[0]?.[0] as { tags: string[] }
      expect(call.tags).toContain("prefer:constraint:blocked")
    })
  })

  describe("#given kbAdd rejects with an error", () => {
    test("#when persisting #then the promise resolves without throwing", async () => {
      const kbAdd = createKbAddMock(async () => {
        throw new Error("kb unavailable")
      })

      const promise = persistPreferenceToKb({
        client: { kbAdd } as unknown as Parameters<typeof persistPreferenceToKb>[0]["client"],
        preference: { superior: "a", inferior: "b", strength: 0.5 },
        kind: "support",
        reason: "legacy",
      })
      await expect(promise).resolves.toBeUndefined()
    })
  })

  describe("#given a client without kbAdd", () => {
    test("#when persisting #then it returns without throwing", async () => {
      const promise = persistPreferenceToKb({
        client: {} as unknown as Parameters<typeof persistPreferenceToKb>[0]["client"],
        preference: { superior: "a", inferior: "b", strength: 0.5 },
        kind: "support",
        reason: "legacy",
      })
      await expect(promise).resolves.toBeUndefined()
    })
  })
})
