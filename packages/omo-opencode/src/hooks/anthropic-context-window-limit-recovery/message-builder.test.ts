import { beforeEach, describe, expect, mock, test } from "bun:test"
import { sanitizeEmptyMessagesBeforeSummarize, PLACEHOLDER_TEXT } from "./message-builder"

const replaceEmptyTextPartsAsync = mock(() => Promise.resolve(false))
const injectTextPartAsync = mock(() => Promise.resolve(false))
const findMessagesWithEmptyTextPartsFromSDK = mock(() => Promise.resolve([] as string[]))

const deps = {
  isSqliteBackend: () => true,
  findMessagesWithEmptyTextPartsFromSDK,
  replaceEmptyTextPartsAsync,
  injectTextPartAsync,
}

describe("sanitizeEmptyMessagesBeforeSummarize", () => {
  beforeEach(() => {
    replaceEmptyTextPartsAsync.mockReset()
    replaceEmptyTextPartsAsync.mockResolvedValue(false)
    injectTextPartAsync.mockReset()
    injectTextPartAsync.mockResolvedValue(false)
    findMessagesWithEmptyTextPartsFromSDK.mockReset()
    findMessagesWithEmptyTextPartsFromSDK.mockResolvedValue([])
  })

  test("#given sqlite message with tool content and empty text part #when sanitizing #then it fixes the mixed-content message", async () => {
    // given
    const client = {
      session: {
        messages: mock(() => Promise.resolve({
          data: [
            {
              info: { id: "msg-1" },
              parts: [
                { type: "tool_result", text: "done" },
                { type: "text", text: "" },
              ],
            },
          ],
        })),
      },
    } as never
    findMessagesWithEmptyTextPartsFromSDK.mockResolvedValue(["msg-1"])
    replaceEmptyTextPartsAsync.mockResolvedValue(true)

    // when
    const fixedCount = await sanitizeEmptyMessagesBeforeSummarize("ses-1", client, deps)

    // then
    expect(fixedCount).toBe(1)
    expect(replaceEmptyTextPartsAsync).toHaveBeenCalledWith(client, "ses-1", "msg-1", PLACEHOLDER_TEXT)
    expect(injectTextPartAsync).not.toHaveBeenCalled()
  })

  test("#given sqlite message with mixed content and failed replacement #when sanitizing #then it injects the placeholder text part", async () => {
    // given
    const client = {
      session: {
        messages: mock(() => Promise.resolve({
          data: [
            {
              info: { id: "msg-2" },
              parts: [
                { type: "tool_use", text: "call" },
                { type: "text", text: "" },
              ],
            },
          ],
        })),
      },
    } as never
    findMessagesWithEmptyTextPartsFromSDK.mockResolvedValue(["msg-2"])
    injectTextPartAsync.mockResolvedValue(true)

    // when
    const fixedCount = await sanitizeEmptyMessagesBeforeSummarize("ses-2", client, deps)

    // then
    expect(fixedCount).toBe(1)
    expect(injectTextPartAsync).toHaveBeenCalledWith(client, "ses-2", "msg-2", PLACEHOLDER_TEXT)
  })
})
