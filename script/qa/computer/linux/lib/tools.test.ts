// A session's host tools are found where the distribution installs them, not only on PATH:
// Debian and Fedora put at-spi-bus-launcher under /usr/libexec, which no image puts on PATH.
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test } from "bun:test"

import { resolveTool } from "./tools.ts"

function layout(body: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "r47-tools-"))
  try {
    body(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function place(path: string, mode: number): void {
  mkdirSync(join(path, ".."), { recursive: true })
  writeFileSync(path, "#!/bin/sh\n")
  chmodSync(path, mode)
}

test("a tool absent from PATH is found in a libexec directory of the layout", () => {
  layout((root) => {
    const libexec = join(root, "usr/libexec")
    place(join(libexec, "at-spi-bus-launcher"), 0o755)
    const found = resolveTool("at-spi-bus-launcher", {
      which: () => null,
      libexecDirs: [join(root, "usr/lib/at-spi2-core"), libexec],
    })
    expect(found).toBe(join(libexec, "at-spi-bus-launcher"))
  })
})

test("PATH wins over a libexec copy, and a non-executable file is not a tool", () => {
  layout((root) => {
    const libexec = join(root, "usr/libexec")
    place(join(libexec, "xfwm4"), 0o644)
    expect(resolveTool("xfwm4", { which: () => null, libexecDirs: [libexec] })).toBeNull()
    expect(resolveTool("xfwm4", { which: () => "/opt/bin/xfwm4", libexecDirs: [libexec] })).toBe("/opt/bin/xfwm4")
  })
})

test("a tool in no directory of the layout is missing", () => {
  layout((root) => {
    expect(
      resolveTool("at-spi-bus-launcher", { which: () => null, libexecDirs: [join(root, "usr/libexec")] }),
    ).toBeNull()
  })
})
