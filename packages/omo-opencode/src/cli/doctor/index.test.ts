/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"
import { formatDoctorFailure } from "./index"

describe("formatDoctorFailure", () => {
  it("omits raw error messages and stacks that can contain config values", () => {
    // given
    const error = new ReferenceError("Bun is not defined")

    // when
    const lines = formatDoctorFailure(error)

    // then
    const output = lines.join("\n")
    expect(output).toContain("Doctor failed unexpectedly")
    expect(output).not.toContain(error.message)
    expect(output).not.toContain("ReferenceError")
    expect(output).not.toContain("memory pressure")
  })

  it("omits non-Error throwables that can contain config values", () => {
    // given
    const thrown = "boom"

    // when
    const lines = formatDoctorFailure(thrown)

    // then
    expect(lines.join("\n")).toContain("Doctor failed unexpectedly")
    expect(lines.join("\n")).not.toContain(thrown)
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
