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
