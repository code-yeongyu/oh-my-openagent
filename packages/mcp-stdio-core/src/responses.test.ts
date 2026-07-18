import { describe, expect, test } from "bun:test"

import { errorResponse, jsonRpcId, messageFromError, successResponse } from "./responses.js"

describe("JSON-RPC response helpers", () => {
  test("#given result payload #when creating success response #then includes jsonrpc id and result", () => {
    expect(successResponse("req_1", { content: [{ type: "text", text: "ok" }] })).toEqual({
      id: "req_1",
      jsonrpc: "2.0",
      result: { content: [{ type: "text", text: "ok" }] },
    })
  })

  test("#given error without data #when creating error response #then omits data field", () => {
    expect(errorResponse(1, -32601, "Method not found")).toEqual({
      error: { code: -32601, message: "Method not found" },
      id: 1,
      jsonrpc: "2.0",
    })
  })

  test("#given error with data #when creating error response #then includes data field", () => {
    expect(errorResponse(null, -32700, "Parse error", "not-json")).toEqual({
      error: { code: -32700, data: "not-json", message: "Parse error" },
      id: null,
      jsonrpc: "2.0",
    })
  })
})

describe("jsonRpcId", () => {
  test("#given valid JSON-RPC id values #when normalizing #then preserves them", () => {
    expect(jsonRpcId("abc")).toBe("abc")
    expect(jsonRpcId(7)).toBe(7)
    expect(jsonRpcId(null)).toBe(null)
  })

  test("#given invalid JSON-RPC id values #when normalizing #then returns null", () => {
    expect(jsonRpcId(undefined)).toBe(null)
    expect(jsonRpcId({ id: "abc" })).toBe(null)
    expect(jsonRpcId(true)).toBe(null)
  })
})

describe("messageFromError", () => {
  test("#given Error instance #when extracting message #then returns error message", () => {
    expect(messageFromError(new Error("boom"))).toBe("boom")
  })

  test("#given non-Error value #when extracting message #then stringifies it", () => {
    expect(messageFromError("plain")).toBe("plain")
    expect(messageFromError(42)).toBe("42")
  })
})
