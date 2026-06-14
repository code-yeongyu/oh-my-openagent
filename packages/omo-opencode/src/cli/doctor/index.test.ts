/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"
import { formatDoctorFailure } from "./index"

describe("formatDoctorFailure", () => {
  it("surfaces the real error message and stack instead of blaming memory pressure", () => {
    // given
    const error = new ReferenceError("Bun is not defined")

    // when
    const lines = formatDoctorFailure(error)

    // then
    const output = lines.join("\n")
    expect(output).toContain("Doctor failed unexpectedly: Bun is not defined")
    expect(output).toContain("ReferenceError")
    expect(output).not.toContain("memory pressure")
  })

  it("stringifies non-Error throwables without a stack", () => {
    // given
    const thrown = "boom"

    // when
    const lines = formatDoctorFailure(thrown)

    // then
    expect(lines.join("\n")).toContain("Doctor failed unexpectedly: boom")
    expect(lines.join("\n")).not.toContain("memory pressure")
  })

  it("suggests the canonical doctor command", () => {
    // given
    const error = new Error("boom")

    // when
    const lines = formatDoctorFailure(error)

    // then
    expect(lines.join("\n")).toContain("bunx oh-my-openagent doctor --verbose")
    expect(lines.join("\n")).not.toContain("bunx oh-my-opencode doctor")
  })
})
