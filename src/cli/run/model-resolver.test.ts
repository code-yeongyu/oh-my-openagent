/// <reference types="bun-types" />

import { describe, it, expect } from "bun:test"
import { resolveRunModel } from "./model-resolver"

describe("resolveRunModel", () => {
  it("given no model string, when resolved, then returns undefined", () => {
    // given
    const modelString = undefined

    // when
    const result = resolveRunModel(modelString)

    // then
    expect(result).toBeUndefined()
  })

  it("given empty string, when resolved, then throws Error", () => {
    // given
    const modelString = ""

    // when
    const resolve = () => resolveRunModel(modelString)

    // then
    expect(resolve).toThrow()
  })

  it("given valid 'anthropic/claude-sonnet-4', when resolved, then returns correct object", () => {
    // given
    const modelString = "anthropic/claude-sonnet-4"

    // when
    const result = resolveRunModel(modelString)

    // then
    expect(result).toEqual({ providerID: "anthropic", modelID: "claude-sonnet-4" })
  })

  it("given nested slashes 'openai/gpt-5.3/preview', when resolved, then modelID is 'gpt-5.3/preview'", () => {
    // given
    const modelString = "openai/gpt-5.3/preview"

    // when
    const result = resolveRunModel(modelString)

    // then
    expect(result).toEqual({ providerID: "openai", modelID: "gpt-5.3/preview" })
  })

  it("given legacy gateway alias without sub-provider, when resolved, then returns canonical vercel/openai model", () => {
    // given
    const modelString = "gateway/gpt-5.4"

    // when
    const result = resolveRunModel(modelString)

    // then
    expect(result).toEqual({ providerID: "vercel", modelID: "openai/gpt-5.4" })
  })

  it("given legacy gateway alias with explicit sub-provider, when resolved, then returns canonical vercel transport model", () => {
    // given
    const modelString = "gateway/anthropic/claude-opus-4-7"

    // when
    const result = resolveRunModel(modelString)

    // then
    expect(result).toEqual({ providerID: "vercel", modelID: "anthropic/claude-opus-4.7" })
  })

  it("given no slash 'claude-sonnet-4', when resolved, then throws Error", () => {
    // given
    const modelString = "claude-sonnet-4"

    // when
    const resolve = () => resolveRunModel(modelString)

    // then
    expect(resolve).toThrow()
  })

  it("given empty provider '/claude-sonnet-4', when resolved, then throws Error", () => {
    // given
    const modelString = "/claude-sonnet-4"

    // when
    const resolve = () => resolveRunModel(modelString)

    // then
    expect(resolve).toThrow()
  })

  it("given trailing slash 'anthropic/', when resolved, then throws Error", () => {
    // given
    const modelString = "anthropic/"

    // when
    const resolve = () => resolveRunModel(modelString)

    // then
    expect(resolve).toThrow()
  })
})
