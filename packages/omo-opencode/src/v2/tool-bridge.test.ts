import { describe, expect, it } from "bun:test"
import { tool } from "@opencode-ai/plugin/tool"
import { convertV1Tool } from "./tool-bridge"

describe("#given V1 tool definition", () => {
  describe("#when converting to a V2 registration", () => {
    it("#then execute bridges context and returns text content", async () => {
      // given
      const seen: Array<{ directory: string; sessionID: string }> = []
      const definition = tool({
        description: "echo tool",
        args: { word: tool.schema.string() },
        execute: async (args, context) => {
          seen.push({ directory: context.directory, sessionID: context.sessionID })
          return `got:${args.word}`
        },
      })
      const registration = convertV1Tool("echo", definition, {
        defaultDirectory: "/fallback",
        resolveDirectory: async () => "/proj",
      })

      // when
      const result = (await registration.execute({ word: "hi" }, {
        sessionID: "ses-1",
        agent: "sisyphus",
        messageID: "m-1",
        signal: new AbortController().signal,
        progress: async () => {},
      } as never)) as { content: Array<{ type: string; text: string }> }

      // then
      expect(registration.name).toBe("echo")
      expect(result.content).toEqual([{ type: "text", text: "got:hi" }])
      expect(seen).toEqual([{ directory: "/proj", sessionID: "ses-1" }])
    })
  })

  describe("#when directory resolution fails", () => {
    it("#then falls back to the default directory", async () => {
      // given
      const seen: string[] = []
      const definition = tool({
        description: "echo tool",
        args: {},
        execute: async (_args, context) => {
          seen.push(context.directory)
          return "ok"
        },
      })
      const registration = convertV1Tool("echo", definition, {
        defaultDirectory: "/fallback",
        resolveDirectory: async () => {
          throw new Error("no record")
        },
      })

      // when
      await registration.execute({}, {
        sessionID: "unknown",
        agent: "a",
        messageID: "m",
        signal: new AbortController().signal,
        progress: async () => {},
      } as never)

      // then
      expect(seen).toEqual(["/fallback"])
    })
  })
})
