import { describe, expect, it } from "bun:test"
import { normalizeSDKResponse } from "./normalize-sdk-response"

describe("normalizeSDKResponse", () => {
  it("returns data array when response includes data", () => {
    //#given
    const response = { data: [{ id: "1" }] }

    //#when
    const result = normalizeSDKResponse(response, [] as Array<{ id: string }>)

    //#then
    expect(result).toEqual([{ id: "1" }])
  })

  it("returns fallback array when data is missing", () => {
    //#given
    const response = {}
    const fallback = [{ id: "fallback" }]

    //#when
    const result = normalizeSDKResponse(response, fallback)

    //#then
    expect(result).toEqual(fallback)
  })

  it("returns response array directly when SDK returns plain array", () => {
    //#given
    const response = [{ id: "2" }]

    //#when
    const result = normalizeSDKResponse(response, [] as Array<{ id: string }>)

    //#then
    expect(result).toEqual([{ id: "2" }])
  })

  it("returns response when data missing and preferResponseOnMissingData is true", () => {
    //#given
    const response = { value: "legacy" }

    //#when
    const result = normalizeSDKResponse(response, { value: "fallback" }, { preferResponseOnMissingData: true })

    //#then
    expect(result).toEqual({ value: "legacy" })
  })

  it("returns an array fallback for a non-array error envelope when raw response is preferred", () => {
    //#given
    const response = {
      data: undefined,
      error: { message: "session messages unavailable" },
      request: new Request("https://example.com/session/ses_123/messages"),
      response: new Response(null, { status: 502 }),
    }
    const fallback = [{ id: "fallback" }]

    //#when
    const result = normalizeSDKResponse(response, fallback, { preferResponseOnMissingData: true })

    //#then
    expect(result).toBe(fallback)
  })

  it("returns an array fallback when an error envelope omits data", () => {
    //#given
    const response = {
      error: { message: "session messages unavailable" },
      request: new Request("https://example.com/session/ses_123/messages"),
      response: new Response(null, { status: 502 }),
    }
    const fallback = [{ id: "fallback" }]

    //#when
    const result = normalizeSDKResponse(response, fallback, { preferResponseOnMissingData: true })

    //#then
    expect(result).toBe(fallback)
  })

  it("returns an array fallback when response data is not an array", () => {
    //#given
    const response = { data: { id: "malformed" } }
    const fallback = [{ id: "fallback" }]

    //#when
    const result = normalizeSDKResponse(response, fallback, { preferResponseOnMissingData: true })

    //#then
    expect(result).toBe(fallback)
  })

  it("returns fallback for null response", () => {
    //#given
    const response = null

    //#when
    const result = normalizeSDKResponse(response, [] as string[])

    //#then
    expect(result).toEqual([])
  })

  it("returns object fallback for direct data nullish pattern", () => {
    //#given
    const response = { data: undefined as { connected: string[] } | undefined }
    const fallback = { connected: [] }

    //#when
    const result = normalizeSDKResponse(response, fallback)

    //#then
    expect(result).toEqual(fallback)
  })
})
