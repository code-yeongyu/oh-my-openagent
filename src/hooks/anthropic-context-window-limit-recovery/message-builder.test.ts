import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test"

const replaceEmptyTextPartsAsync = mock(() => Promise.resolve(false))
const injectTextPartAsync = mock(() => Promise.resolve(false))
const findMessagesWithEmptyTextPartsFromSDK = mock(() => Promise.resolve([] as string[]))

async function importFreshMessageBuilder(): Promise<typeof import("./message-builder")> {
  mock.module("../../shared/logger", () => ({
    log: () => {},
  }))

  mock.module("../../shared/opencode-storage-detection", () => ({
    isSqliteBackend: () => true,
  }))

  const emptyTextMockFactory = () => ({
    findMessagesWithEmptyTextParts: () => [],
    replaceEmptyTextParts: () => false,
    replaceEmptyTextPartsAsync,
    findMessagesWithEmptyTextPartsFromSDK,
  })
  mock.module("../session-recovery/storage/empty-text", emptyTextMockFactory)
  mock.module("../session-recovery/storage/empty-text.ts", emptyTextMockFactory)

  const textPartInjectorMockFactory = () => ({
    injectTextPart: () => false,
    injectTextPartAsync,
  })
  mock.module("../session-recovery/storage/text-part-injector", textPartInjectorMockFactory)
  mock.module("../session-recovery/storage/text-part-injector.ts", textPartInjectorMockFactory)

  const module = await import(`./message-builder?test=${Date.now()}-${Math.random()}`)
  mock.restore()
  return module
}

afterAll(() => {
  mock.restore()
})

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
    const { sanitizeEmptyMessagesBeforeSummarize, PLACEHOLDER_TEXT } = await importFreshMessageBuilder()
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

    const fixedCount = await sanitizeEmptyMessagesBeforeSummarize("ses-1", client)

    expect(fixedCount).toBe(1)
    expect(replaceEmptyTextPartsAsync).toHaveBeenCalledWith(client, "ses-1", "msg-1", PLACEHOLDER_TEXT)
    expect(injectTextPartAsync).not.toHaveBeenCalled()
  })

  test("#given sqlite message with mixed content and failed replacement #when sanitizing #then it injects the placeholder text part", async () => {
    const { sanitizeEmptyMessagesBeforeSummarize, PLACEHOLDER_TEXT } = await importFreshMessageBuilder()
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

    const fixedCount = await sanitizeEmptyMessagesBeforeSummarize("ses-2", client)

    expect(fixedCount).toBe(1)
    expect(injectTextPartAsync).toHaveBeenCalledWith(client, "ses-2", "msg-2", PLACEHOLDER_TEXT)
  })
})
