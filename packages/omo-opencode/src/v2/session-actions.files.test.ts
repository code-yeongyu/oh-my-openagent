/// <reference path="../../../../bun-test.d.ts" />
import { expect, it } from "bun:test"
import { sendPrompt } from "./session-actions"

function fixture() {
  const prompts: Array<Record<string, unknown>> = []
  const synthetic: string[] = []
  const api = {
    get: async () => ({}), context: async () => [], create: async () => ({}), interrupt: async () => ({}),
    switchAgent: async () => {}, switchModel: async () => {}, update: async () => {},
    synthetic: async ({ text }: { text: string }) => { synthetic.push(text) },
    prompt: async (input: Record<string, unknown>) => { prompts.push(input) },
  }
  return { api, prompts, synthetic }
}

const PNG_DATA_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="

it("forwards a file: part to the V2 prompt as files", async () => {
  const { api, prompts } = fixture()
  await sendPrompt(api, { path: { id: "ses_look" }, body: { parts: [
    { type: "text", text: "describe it" },
    { type: "file", mime: "image/png", url: "file:///C:/x.png", filename: "x.png" },
  ] } })
  expect(prompts).toEqual([{ sessionID: "ses_look", text: "describe it", files: [{ uri: "file:///C:/x.png", name: "x.png" }] }])
})

it("forwards a data: URL part to the V2 prompt as files", async () => {
  const { api, prompts } = fixture()
  await sendPrompt(api, { path: { id: "ses_look" }, body: { parts: [
    { type: "text", text: "describe it" },
    { type: "file", mime: "image/png", url: PNG_DATA_URL, filename: "clip.png" },
  ] } })
  const files = prompts[0]?.files as Array<{ uri: string; name?: string }>
  expect(files).toHaveLength(1)
  expect(files[0]?.uri.startsWith("data:image/png;base64,")).toBe(true)
  expect(files[0]?.name).toBe("clip.png")
})

it("sends no files key for a text-only prompt", async () => {
  const { api, prompts } = fixture()
  await sendPrompt(api, { path: { id: "ses_text" }, body: { parts: [{ type: "text", text: "go" }] } })
  expect(prompts).toEqual([{ sessionID: "ses_text", text: "go" }])
  expect("files" in (prompts[0] ?? {})).toBe(false)
})

it("passes V2-shaped body.files through and skips file parts without a url", async () => {
  const { api, prompts } = fixture()
  await sendPrompt(api, { path: { id: "ses_v2" }, body: { text: "see", files: [{ uri: "file:///tmp/a.pdf", name: "a.pdf" }], parts: [{ type: "file", filename: "nourl.png" }] } })
  expect(prompts[0]?.files).toEqual([{ uri: "file:///tmp/a.pdf", name: "a.pdf" }])
})

it("keeps noReply prompts synthetic even when they carry files", async () => {
  const { api, prompts, synthetic } = fixture()
  await sendPrompt(api, { path: { id: "ses_ctx" }, body: { noReply: true, parts: [
    { type: "text", text: "context" },
    { type: "file", url: "file:///C:/x.png", filename: "x.png" },
  ] } })
  expect(synthetic).toEqual(["context"])
  expect(prompts).toEqual([])
})
