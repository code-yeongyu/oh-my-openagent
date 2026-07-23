import { expect, test } from "bun:test"

import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { resolveParentContext } from "./parent-context-resolver"

test("#given missing tool caller identity #when resolving delegate parent context #then it fails closed before session lookup", async () => {
  const context = unsafeTestValue<Parameters<typeof resolveParentContext>[0]>({
    sessionID: "parent-session",
    messageID: "message-id",
    agent: undefined,
    abort: new AbortController().signal,
  })

  await expect(resolveParentContext(context, unsafeTestValue({}))).rejects.toThrow(
    "trusted caller identity is required",
  )
})
