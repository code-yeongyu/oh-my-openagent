import type { RpcExtensionUIRequest } from "@code-yeongyu/senpi"
import { describe, expect, test } from "bun:test"

import { buildAutoUiResponse } from "./ui-auto-answer"

describe("buildAutoUiResponse", () => {
  test("#given a confirm request #when auto-answering #then it denies (confirmed:false)", () => {
    // given
    const request: RpcExtensionUIRequest = { type: "extension_ui_request", id: "u1", method: "confirm", title: "t", message: "m" }

    // when
    const response = buildAutoUiResponse(request)

    // then
    expect(response).toEqual({ type: "extension_ui_response", id: "u1", confirmed: false })
  })

  test("#given select/input/editor requests #when auto-answering #then each cancels", () => {
    // given
    const requests: RpcExtensionUIRequest[] = [
      { type: "extension_ui_request", id: "s", method: "select", title: "t", options: ["a", "b"] },
      { type: "extension_ui_request", id: "i", method: "input", title: "t" },
      { type: "extension_ui_request", id: "e", method: "editor", title: "t" },
    ]

    // when / then
    for (const request of requests) {
      expect(buildAutoUiResponse(request)).toEqual({ type: "extension_ui_response", id: request.id, cancelled: true })
    }
  })

  test("#given a display-only request #when auto-answering #then no response is emitted", () => {
    // given
    const notify: RpcExtensionUIRequest = { type: "extension_ui_request", id: "n", method: "notify", message: "hi" }
    const setStatus: RpcExtensionUIRequest = {
      type: "extension_ui_request",
      id: "st",
      method: "setStatus",
      statusKey: "k",
      statusText: "v",
    }

    // when / then
    expect(buildAutoUiResponse(notify)).toBeNull()
    expect(buildAutoUiResponse(setStatus)).toBeNull()
  })
})
