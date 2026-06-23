import { describe, expect, test } from "bun:test"
import { translateMessages, type ImageUploader } from "./messages-translator"

describe("translateMessages", () => {
  describe("#given a single user message", () => {
    test("#when translated #then returns a single role-marked line and no ref_file_ids", async () => {
      const r = await translateMessages([{ role: "user", content: "hello" }])
      expect(r.ok).toBe(true)
      if (r.ok) {
        expect(r.prompt).toBe("[user]: hello")
        expect(r.ref_file_ids).toEqual([])
      }
    })
  })

  describe("#given system + user + assistant + user turns", () => {
    test("#when translated #then concatenates with double-newline separators", async () => {
      const r = await translateMessages([
        { role: "system", content: "be brief" },
        { role: "user", content: "ciao" },
        { role: "assistant", content: "ok" },
        { role: "user", content: "more" },
      ])
      expect(r.ok).toBe(true)
      if (r.ok) {
        expect(r.prompt).toBe(
          "[system]: be brief\n\n[user]: ciao\n\n[assistant]: ok\n\n[user]: more",
        )
      }
    })
  })

  describe("#given an empty messages array", () => {
    test("#when translated #then returns ok=false with empty reason", async () => {
      const r = await translateMessages([])
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.reason).toMatch(/empty/i)
    })
  })

  describe("#given a function role message (legacy)", () => {
    test("#when translated #then returns ok=false explicitly rejecting the legacy role", async () => {
      const r = await translateMessages([
        { role: "user", content: "hi" },
        { role: "function", content: "x" },
      ])
      expect(r.ok).toBe(false)
      if (!r.ok) {
        expect(r.reason).toMatch(/function/i)
        expect(r.reason).toMatch(/tool|use tool/i)
      }
    })
  })

  describe("#given a tool role message without tool_call_id", () => {
    test("#when translated #then returns ok=false complaining about missing tool_call_id", async () => {
      const r = await translateMessages([
        { role: "user", content: "hi" },
        { role: "tool", content: "fn-result" } as never,
      ])
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.reason).toMatch(/tool_call_id/i)
    })
  })

  describe("#given a tool role message with tool_call_id and content", () => {
    test("#when translated #then prompt embeds a DSML tool_results block referencing that id", async () => {
      const r = await translateMessages([
        { role: "user", content: "hi" },
        {
          role: "tool",
          content: '{"time":"2026-05-08T17:00:00Z"}',
          tool_call_id: "call_abc123",
          name: "get_current_time",
        } as never,
      ])
      expect(r.ok).toBe(true)
      if (r.ok) {
        expect(r.prompt).toContain("[user]: hi")
        expect(r.prompt).toContain("<|DSML|tool_results>")
        expect(r.prompt).toContain('tool_call_id="call_abc123"')
        expect(r.prompt).toContain("get_current_time")
      }
    })
  })

  describe("#given an assistant message with tool_calls but no content", () => {
    test("#when translated #then prompt embeds a DSML tool_calls history block under [assistant]", async () => {
      const r = await translateMessages([
        { role: "user", content: "Che ore sono?" },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_abc",
              type: "function",
              function: {
                name: "get_current_time",
                arguments: JSON.stringify({ tz: "UTC" }),
              },
            },
          ],
        } as never,
      ])
      expect(r.ok).toBe(true)
      if (r.ok) {
        expect(r.prompt).toContain("[assistant]:")
        expect(r.prompt).toContain("<|DSML|tool_calls>")
        expect(r.prompt).toContain('<|DSML|invoke name="get_current_time">')
      }
    })
  })

  describe("#given an assistant message with both content and tool_calls", () => {
    test("#when translated #then prompt includes both the content and the DSML tool_calls block", async () => {
      const r = await translateMessages([
        { role: "user", content: "ciao" },
        {
          role: "assistant",
          content: "Sto chiamando un tool…",
          tool_calls: [
            {
              id: "call_x",
              type: "function",
              function: { name: "noop", arguments: "{}" },
            },
          ],
        } as never,
      ])
      expect(r.ok).toBe(true)
      if (r.ok) {
        expect(r.prompt).toContain("Sto chiamando un tool")
        expect(r.prompt).toContain("<|DSML|tool_calls>")
      }
    })
  })

  describe("#given a full multi-turn sequence (user → assistant tool_calls → tool result → user)", () => {
    test("#when translated #then prompt interleaves [user], [assistant] DSML tool_calls, [tool] DSML tool_results, [user] in order", async () => {
      const r = await translateMessages([
        { role: "user", content: "Che ore sono?" },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_t",
              type: "function",
              function: {
                name: "get_current_time",
                arguments: JSON.stringify({ tz: "UTC" }),
              },
            },
          ],
        } as never,
        {
          role: "tool",
          content: '{"time":"17:00 UTC"}',
          tool_call_id: "call_t",
          name: "get_current_time",
        } as never,
        { role: "user", content: "ok grazie" },
      ])
      expect(r.ok).toBe(true)
      if (r.ok) {
        const idx0 = r.prompt.indexOf("[user]: Che ore sono?")
        const idx1 = r.prompt.indexOf("<|DSML|tool_calls>")
        const idx2 = r.prompt.indexOf("<|DSML|tool_results>")
        const idx3 = r.prompt.indexOf("[user]: ok grazie")
        expect(idx0).toBeGreaterThanOrEqual(0)
        expect(idx1).toBeGreaterThan(idx0)
        expect(idx2).toBeGreaterThan(idx1)
        expect(idx3).toBeGreaterThan(idx2)
      }
    })
  })

  describe("#given an assistant message with null content", () => {
    test("#when translated #then treats null content as empty string", async () => {
      const r = await translateMessages([
        { role: "user", content: "q" },
        { role: "assistant", content: null },
        { role: "user", content: "again" },
      ])
      expect(r.ok).toBe(true)
      if (r.ok) {
        expect(r.prompt).toBe("[user]: q\n\n[assistant]: \n\n[user]: again")
      }
    })
  })

  describe("#given assistant.reasoning_content (V0.10.1)", () => {
    test("#when non-empty #then [reasoning] line precedes [assistant]; #when empty #then no [reasoning]", async () => {
      const r1 = await translateMessages([{ role: "user", content: "ciao" }, { role: "assistant", content: "ok", reasoning_content: "thinking" } as never])
      expect(r1.ok).toBe(true)
      if (r1.ok) { expect(r1.prompt).toContain("[reasoning]: thinking"); expect(r1.prompt.indexOf("[reasoning]")).toBeLessThan(r1.prompt.indexOf("[assistant]: ok")) }
      const r2 = await translateMessages([{ role: "user", content: "q" }, { role: "assistant", content: "a", reasoning_content: "" } as never])
      expect(r2.ok).toBe(true)
      if (r2.ok) { expect(r2.prompt).not.toContain("[reasoning]"); expect(r2.prompt).toContain("[assistant]: a") }
    })
  })

  describe("#given a multimodal user message with text + data:URL image and an uploader", () => {
    test("#when translated #then text is concatenated, uploader is invoked with decoded bytes, and ref_file_ids contains the returned file id", async () => {
      const calls: { mimeType: string; filename: string; len: number }[] = []
      const uploader: ImageUploader = async (input) => {
        calls.push({ mimeType: input.mimeType, filename: input.filename, len: input.data.byteLength })
        return { ok: true, fileId: "file-xyz" }
      }
      const r = await translateMessages(
        [
          {
            role: "user",
            content: [
              { type: "text", text: "describe this:" },
              {
                type: "image_url",
                image_url: { url: "data:image/png;base64,iVBORw0KGgo=" },
              },
            ],
          } as never,
        ],
        uploader,
        "rid-mm",
      )
      expect(r.ok).toBe(true)
      if (r.ok) {
        expect(r.prompt).toContain("[user]: describe this:")
        expect(r.ref_file_ids).toEqual(["file-xyz"])
      }
      expect(calls).toHaveLength(1)
      expect(calls[0]?.mimeType).toBe("image/png")
      expect(calls[0]?.filename).toBe("image-1.png")
      expect(calls[0]?.len).toBeGreaterThan(0)
    })
  })

  describe("#given a multimodal user message with no uploader provided", () => {
    test("#when translated #then image parts are dropped silently and ref_file_ids stays empty", async () => {
      const r = await translateMessages([
        {
          role: "user",
          content: [
            { type: "text", text: "hello" },
            {
              type: "image_url",
              image_url: { url: "data:image/png;base64,iVBORw0KGgo=" },
            },
          ],
        } as never,
      ])
      expect(r.ok).toBe(true)
      if (r.ok) {
        expect(r.prompt).toBe("[user]: hello")
        expect(r.ref_file_ids).toEqual([])
      }
    })
  })

  describe("#given a multimodal user message with an http(s) image URL", () => {
    test("#when translated #then returns ok=false with a clear deferral reason", async () => {
      const r = await translateMessages([
        {
          role: "user",
          content: [
            { type: "text", text: "look" },
            { type: "image_url", image_url: { url: "https://example.com/x.png" } },
          ],
        } as never,
      ])
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.reason).toMatch(/remote image URLs not yet supported/i)
    })
  })

  describe("#given the uploader fails", () => {
    test("#when uploader returns ok=false #then translation fails with that reason", async () => {
      const uploader: ImageUploader = async () => ({ ok: false, reason: "upload_file HTTP 500" })
      const r = await translateMessages(
        [
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: "data:image/png;base64,iVBORw0KGgo=" } },
            ],
          } as never,
        ],
        uploader,
      )
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.reason).toMatch(/image upload failed/i)
    })
  })
})
