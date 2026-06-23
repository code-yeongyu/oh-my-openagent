/// <reference path="./bun-test.d.ts" />

import { describe, expect, it, mock } from "bun:test"
import {
  clearDestructiveCache,
  evaluateDestructiveAction,
  type DestructiveActionResult,
} from "./destructive-action-gate"
import type { ReasoningCoreClient } from "./reasoning-core-client"

interface ArgueCallExpectation {
  conclusion: string
  blocked: boolean
  rules: string[]
}

function createStubClient(expectations: Record<string, ArgueCallExpectation>): ReasoningCoreClient {
  const argue = mock(async (req: unknown) => {
    const request = req as { theory: { strict_rules?: Array<{ id: string; antecedents: string[]; consequent: string }>; defeasible_rules?: Array<{ id: string; antecedents: string[]; consequent: string }>; premises: Array<{ formula: string }> } }
    const premiseSet = new Set(request.theory.premises.map((p) => p.formula))
    const allRules = [
      ...(request.theory.strict_rules ?? []),
      ...(request.theory.defeasible_rules ?? []),
    ]
    const fired = allRules.filter((rule) => rule.antecedents.every((a) => premiseSet.has(a)))
    if (fired.length === 0) {
      return { conclusions: {} }
    }
    const proof = fired.map((rule) => ({
      conclusion: rule.consequent,
      rule_id: rule.id,
      rule_kind: request.theory.strict_rules?.includes(rule) ? "strict" : "defeasible",
    }))
    return {
      conclusions: {
        block_action: {
          status: "Accepted",
          proof_chain: proof,
        },
      },
    }
  })
  void expectations
  return { argue } as unknown as ReasoningCoreClient
}

describe("evaluateDestructiveAction", () => {
  describe("bash via ASPIC+ reasoning", () => {
    it("blocks rm -rf / via sr-rm-recursive-root strict rule", async () => {
      clearDestructiveCache()
      const client = createStubClient({})
      const result = await evaluateDestructiveAction(client, "bash", { command: "rm -rf /" })
      expect(result).not.toBeUndefined()
      expect((result as DestructiveActionResult).blocked).toBe(true)
      expect((result as DestructiveActionResult).fired_rules).toEqual(
        expect.arrayContaining(["sr-rm-recursive-root"]),
      )
    })

    it("blocks rm /etc/passwd via sr-rm-system-path strict rule", async () => {
      clearDestructiveCache()
      const client = createStubClient({})
      const result = await evaluateDestructiveAction(client, "bash", { command: "rm /etc/passwd" })
      expect(result).not.toBeUndefined()
      expect((result as DestructiveActionResult).fired_rules).toEqual(
        expect.arrayContaining(["sr-rm-system-path"]),
      )
    })

    it("blocks fork bomb via sr-fork-bomb axiom rule", async () => {
      clearDestructiveCache()
      const client = createStubClient({})
      const result = await evaluateDestructiveAction(client, "bash", { command: ":(){ :|:& };:" })
      expect((result as DestructiveActionResult).fired_rules).toEqual(
        expect.arrayContaining(["sr-fork-bomb"]),
      )
    })

    it("blocks mkfs.ext4 /dev/sda via sr-disk-format axiom rule", async () => {
      clearDestructiveCache()
      const client = createStubClient({})
      const result = await evaluateDestructiveAction(client, "bash", { command: "mkfs.ext4 /dev/sda" })
      expect((result as DestructiveActionResult).fired_rules).toEqual(
        expect.arrayContaining(["sr-disk-format"]),
      )
    })

    it("blocks dd if=/dev/zero via sr-raw-disk-write axiom rule", async () => {
      clearDestructiveCache()
      const client = createStubClient({})
      const result = await evaluateDestructiveAction(client, "bash", { command: "dd if=/dev/zero of=/dev/sda" })
      expect((result as DestructiveActionResult).fired_rules).toEqual(
        expect.arrayContaining(["sr-raw-disk-write"]),
      )
    })

    it("blocks system shutdown via sr-system-shutdown axiom rule", async () => {
      clearDestructiveCache()
      const client = createStubClient({})
      const result = await evaluateDestructiveAction(client, "bash", { command: "reboot" })
      expect((result as DestructiveActionResult).fired_rules).toEqual(
        expect.arrayContaining(["sr-system-shutdown"]),
      )
    })

    it("allows rm -rf ./node_modules (no absolute path, no system path)", async () => {
      clearDestructiveCache()
      const client = createStubClient({})
      const result = await evaluateDestructiveAction(client, "bash", { command: "rm -rf ./node_modules" })
      expect(result).toBeNull()
    })

    it("allows echo hello", async () => {
      clearDestructiveCache()
      const client = createStubClient({})
      const result = await evaluateDestructiveAction(client, "bash", { command: "echo hello" })
      expect(result).toBeNull()
    })

    it("blocks chmod -R / via sr-chmod-recursive-root strict rule", async () => {
      clearDestructiveCache()
      const client = createStubClient({})
      const result = await evaluateDestructiveAction(client, "bash", { command: "chmod -R 755 /" })
      expect((result as DestructiveActionResult).fired_rules).toEqual(
        expect.arrayContaining(["sr-chmod-recursive-root"]),
      )
    })

    it("returns null when client.argue is unavailable (graceful fallback)", async () => {
      clearDestructiveCache()
      const result = await evaluateDestructiveAction({} as ReasoningCoreClient, "bash", { command: "rm -rf /" })
      expect(result).toBeNull()
    })

    it("caches verdict for repeat commands (single argue invocation)", async () => {
      clearDestructiveCache()
      const client = createStubClient({})
      await evaluateDestructiveAction(client, "bash", { command: "rm -rf /" })
      await evaluateDestructiveAction(client, "bash", { command: "rm -rf /" })
      const argueMock = (client.argue as unknown as { mock: { calls: unknown[] } }).mock
      expect(argueMock.calls.length).toBe(1)
    })
  })

  describe("write via ASPIC+ reasoning", () => {
    it("blocks write to .env via sr-write-dotenv strict rule", async () => {
      clearDestructiveCache()
      const client = createStubClient({})
      const result = await evaluateDestructiveAction(client, "write", { file_path: ".env" })
      expect((result as DestructiveActionResult).fired_rules).toEqual(
        expect.arrayContaining(["sr-write-dotenv"]),
      )
    })

    it("blocks write to ~/.ssh/id_rsa via sr-write-ssh strict rule", async () => {
      clearDestructiveCache()
      const client = createStubClient({})
      const result = await evaluateDestructiveAction(client, "write", { file_path: "/Users/foo/.ssh/id_rsa" })
      expect((result as DestructiveActionResult).fired_rules).toEqual(
        expect.arrayContaining(["sr-write-ssh"]),
      )
    })

    it("blocks write to /etc/passwd via sr-write-etc strict rule", async () => {
      clearDestructiveCache()
      const client = createStubClient({})
      const result = await evaluateDestructiveAction(client, "write", { file_path: "/etc/passwd" })
      expect((result as DestructiveActionResult).fired_rules).toEqual(
        expect.arrayContaining(["sr-write-etc"]),
      )
    })

    it("blocks write to credentials.json via sr-write-credential strict rule", async () => {
      clearDestructiveCache()
      const client = createStubClient({})
      const result = await evaluateDestructiveAction(client, "write", { file_path: "credentials.json" })
      expect((result as DestructiveActionResult).fired_rules).toEqual(
        expect.arrayContaining(["sr-write-credential"]),
      )
    })

    it("blocks write to ~/.bashrc via dr-write-shell-rc defeasible rule", async () => {
      clearDestructiveCache()
      const client = createStubClient({})
      const result = await evaluateDestructiveAction(client, "write", { file_path: "~/.bashrc" })
      expect((result as DestructiveActionResult).fired_rules).toEqual(
        expect.arrayContaining(["dr-write-shell-rc"]),
      )
    })

    it("allows write to src/foo.ts (no sensitive markers)", async () => {
      clearDestructiveCache()
      const client = createStubClient({})
      const result = await evaluateDestructiveAction(client, "write", { file_path: "src/foo.ts" })
      expect(result).toBeNull()
    })
  })

  describe("non-relevant tools", () => {
    it("returns null for read tool", async () => {
      clearDestructiveCache()
      const client = createStubClient({})
      const result = await evaluateDestructiveAction(client, "read", { file_path: ".env" })
      expect(result).toBeNull()
    })

    it("returns null for grep tool", async () => {
      clearDestructiveCache()
      const client = createStubClient({})
      const result = await evaluateDestructiveAction(client, "grep", { pattern: "rm -rf" })
      expect(result).toBeNull()
    })
  })
})
