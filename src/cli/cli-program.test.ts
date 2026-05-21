import { describe, test, expect } from "bun:test"
import { readFile } from "node:fs/promises"
import path from "node:path"

describe("cli-program", () => {
  test("install command exposes 'setup' as an alias so the historical install path keeps working", async () => {
    // given
    const cliProgramSource = await readFile(
      path.resolve(import.meta.dir, "cli-program.ts"),
      "utf-8",
    )

    // when
    const installBlock = cliProgramSource.match(
      /program\s*\n\s*\.command\("install"\)([\s\S]*?)\.action\(/,
    )

    // then
    expect(installBlock).not.toBeNull()
    expect(installBlock?.[1]).toContain('.alias("setup")')
  })
})
