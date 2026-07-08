/// <reference path="../../../../../bun-test.d.ts" />
/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { formatVersionOutput } from "./formatter"
import type { VersionInfo } from "./types"

describe("formatVersionOutput", () => {
  test("#given a pinned version equal to the running version #when formatting #then reports the pin without a mismatch warning", () => {
    // given a pin that matches what is actually running
    const info: VersionInfo = {
      currentVersion: "3.16.0",
      latestVersion: null,
      isUpToDate: false,
      isLocalDev: false,
      isPinned: true,
      pinnedVersion: "3.16.0",
      status: "pinned",
    }

    // when
    const output = formatVersionOutput(info)

    // then
    expect(output).toContain("pinned to 3.16.0")
    expect(output.toLowerCase()).not.toContain("but running")
  })

  test("#given a pin that differs from the running version #when formatting #then warns the pin does not control the loaded version", () => {
    // given a config pinned to 3.16.0 while 4.7.5 is actually loaded
    const info: VersionInfo = {
      currentVersion: "4.7.5",
      latestVersion: null,
      isUpToDate: false,
      isLocalDev: false,
      isPinned: true,
      pinnedVersion: "3.16.0",
      status: "pinned-mismatch",
    }

    // when
    const output = formatVersionOutput(info)

    // then the warning names both the pinned and the actually-running version
    expect(output).toContain("3.16.0")
    expect(output).toContain("4.7.5")
    expect(output.toLowerCase()).toContain("but running")
  })
})
