/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import packageJson from "../../../../../package.json" with { type: "json" }
import { formatNativeInstallEntryCommand, resolveNativeInstallPlan } from "./plan"

describe("formatNativeInstallEntryCommand channel tag", () => {
  test("#given a prerelease plugin #when the installer command is formatted #then it pins the beta tag", () => {
    // given
    const version = "5.0.0-beta.89"

    // when
    const bunCommand = formatNativeInstallEntryCommand(resolveNativeInstallPlan(true), version)
    const npmCommand = formatNativeInstallEntryCommand(resolveNativeInstallPlan(false), version)

    // then
    expect(bunCommand).toBe("bunx oh-my-openagent@beta install --platform=native")
    expect(npmCommand).toBe("npx oh-my-openagent@beta install --platform=native")
  })

  test("#given a stable plugin #when the installer command is formatted #then it carries no tag", () => {
    // given
    const version = "5.0.0"

    // when
    const command = formatNativeInstallEntryCommand(resolveNativeInstallPlan(true), version)

    // then
    expect(command).toBe("bunx oh-my-openagent install --platform=native")
  })

  test("#given no explicit version #when the installer command is formatted #then it follows the bundled plugin version", () => {
    // given
    const expected = formatNativeInstallEntryCommand(resolveNativeInstallPlan(true), packageJson.version)

    // when
    const command = formatNativeInstallEntryCommand(resolveNativeInstallPlan(true))

    // then
    expect(command).toBe(expected)
  })
})
