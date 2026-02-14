import { describe, expect, it } from "bun:test"

import { LSPClientTransport } from "./lsp-client-transport"
import type { Diagnostic, ResolvedServer } from "./types"

const TEST_SERVER: ResolvedServer = {
  id: "test",
  command: ["test"],
  extensions: [".ts"],
  priority: 0,
}

class TestTransport extends LSPClientTransport {
  public setDiagnostics(uri: string, diagnostics: Diagnostic[]): void {
    this.diagnosticsStore.set(uri, diagnostics)
  }

  public publishDiagnostics(params: { uri?: string; diagnostics?: Diagnostic[] }): void {
    this.handlePublishDiagnostics(params)
  }

  public waitFor(uri: string, timeoutMs: number): Promise<Diagnostic[]> {
    return this.waitForPushDiagnostics(uri, timeoutMs)
  }

  public getWaiterCount(uri: string): number {
    return this.diagnosticsWaiters.get(uri)?.length ?? 0
  }
}

describe("LSPClientTransport", () => {
  describe("waitForPushDiagnostics", () => {
    it("returns cached diagnostics immediately when already in store", async () => {
      //#given
      const transport = new TestTransport(process.cwd(), TEST_SERVER)
      const uri = "file:///tmp/test.ts"
      const cached: Diagnostic[] = [
        {
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
          message: "cached",
        },
      ]
      transport.setDiagnostics(uri, cached)

      //#when
      const result = await transport.waitFor(uri, 100)

      //#then
      expect(result).toEqual(cached)
      expect(transport.getWaiterCount(uri)).toBe(0)
    })

    it("resolves when push diagnostics arrives and clears waiter", async () => {
      //#given
      const transport = new TestTransport(process.cwd(), TEST_SERVER)
      const uri = "file:///tmp/test.ts"
      const pushed: Diagnostic[] = [
        {
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
          message: "pushed",
        },
      ]

      const waiting = transport.waitFor(uri, 1000)

      //#when
      expect(transport.getWaiterCount(uri)).toBe(1)
      transport.publishDiagnostics({ uri, diagnostics: pushed })
      const result = await waiting

      //#then
      expect(result).toEqual(pushed)
      expect(transport.getWaiterCount(uri)).toBe(0)
      await expect(transport.waitFor(uri, 100)).resolves.toEqual(pushed)
    })

    it("resolves empty list on timeout and clears waiter", async () => {
      //#given
      const transport = new TestTransport(process.cwd(), TEST_SERVER)
      const uri = "file:///tmp/test.ts"

      //#when
      const result = await transport.waitFor(uri, 0)

      //#then
      expect(result).toEqual([])
      expect(transport.getWaiterCount(uri)).toBe(0)
    })
  })
})
