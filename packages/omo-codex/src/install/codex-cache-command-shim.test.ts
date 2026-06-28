/// <reference path="../../../../bun-test.d.ts" />
/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { windowsCommandShim } from "./codex-cache-command-shim"

describe("codex-cache-command-shim", () => {
  test("#given Windows npx cache target with @version #when rendering command shim #then target stays a quoted cmd argument", () => {
    // given
    const targetPath = String.raw`C:\Users\cole\AppData\Local\npm-cache\_npx\lazycodex-ai@4.13.0\node_modules\lazycodex-ai\dist\cli-node\index.js`

    // when
    const shim = windowsCommandShim(targetPath)

    // then
    expect(shim).toContain(`"%OMO_NODE_BINARY%" "${targetPath}" %*`)
    expect(shim).not.toContain(" sh -c ")
    expect(shim).not.toContain(" bash -lc ")
  })
})
