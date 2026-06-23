/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"
import {
  buildRemoteDoclingCommand,
  buildRemoteDoclingShellScript,
  parsePdfWithRemoteDocling,
  type RemoteDoclingCommand,
} from "./remote-docling-parser"

describe("buildRemoteDoclingCommand", () => {
  it("uses the remote URL directly when an HTTP source URL is available", () => {
    const command = buildRemoteDoclingCommand({
      sourceDocument: "memory-plan.pdf",
      sourceUrl: "https://example.com/memory-plan.pdf",
      content: new Uint8Array([1, 2, 3]),
    })

    expect(command).toMatchObject({
      mode: "url",
      source: "https://example.com/memory-plan.pdf",
    })
  })

  it("falls back to base64 payload transport when the PDF source is local-only", () => {
    const command = buildRemoteDoclingCommand({
      sourceDocument: "/tmp/memory-plan.pdf",
      content: new Uint8Array([1, 2, 3]),
    })

    expect(command.mode).toBe("base64")
    expect(command.source).toBeUndefined()
    expect(command.base64Content).toBe(Buffer.from([1, 2, 3]).toString("base64"))
  })
})

describe("parsePdfWithRemoteDocling", () => {
  it("returns one text section from the remote parser result", async () => {
    const calls: RemoteDoclingCommand[] = []

    const sections = await parsePdfWithRemoteDocling(
      {
        sourceDocument: "memory-plan.pdf",
        title: "Memory plan",
        sourceUrl: "https://example.com/memory-plan.pdf",
        content: new Uint8Array([1, 2, 3]),
      },
      {
        runRemoteDocling: async (command) => {
          calls.push(command)
          return "# Memory plan\n\nThis is parsed remotely."
        },
      },
    )

    expect(calls).toHaveLength(1)
    expect(sections).toEqual([
      {
        heading: "Memory plan",
        text: "# Memory plan\n\nThis is parsed remotely.",
      },
    ])
  })
})

describe("buildRemoteDoclingShellScript", () => {
  it("uses the configured host and python env in the generated remote command", () => {
    const script = buildRemoteDoclingShellScript(
      {
        mode: "url",
        source: "https://example.com/memory-plan.pdf",
        sourceDocument: "memory-plan.pdf",
      },
      {
        remoteDoclingHost: "dst",
        remoteDoclingPythonEnv: "/opt/docling/bin/activate",
      },
    )

    expect(script.host).toBe("dst")
    expect(script.shell).toContain('/opt/docling/bin/activate')
    expect(script.shell).toContain('https://example.com/memory-plan.pdf')
  })
})
