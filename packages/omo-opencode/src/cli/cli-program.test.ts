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

  test("cleanup command exposes Codex cleanup for lazycodex migrations", async () => {
    // given
    const cliProgramSource = await readFile(
      path.resolve(import.meta.dir, "cleanup-command.ts"),
      "utf-8",
    )

    // when
    const cleanupBlock = cliProgramSource.match(
      /program\s*\n\s*\.command\("cleanup"\)([\s\S]*?)\.action\(/,
    )

    // then
    expect(cleanupBlock).not.toBeNull()
    expect(cleanupBlock?.[1]).toContain('new Option("--platform <platform>"')
    expect(cleanupBlock?.[1]).toContain('.choices(["codex"])')
    expect(cleanupBlock?.[1]).toContain("--codex-home")
    expect(cleanupBlock?.[1]).toContain("--project")
  })

  test("cleanup command exposes uninstall as the user-facing alias", async () => {
    // given
    const cliProgramSource = await readFile(
      path.resolve(import.meta.dir, "cleanup-command.ts"),
      "utf-8",
    )

    // when
    const cleanupBlock = cliProgramSource.match(
      /program\s*\n\s*\.command\("cleanup"\)([\s\S]*?)\.action\(/,
    )

    // then
    expect(cleanupBlock).not.toBeNull()
    expect(cleanupBlock?.[1]).toContain('.alias("uninstall")')
  })

  test("doctor command exposes explicit platform selection for Codex-only diagnostics", async () => {
    // given
    const cliProgramSource = await readFile(
      path.resolve(import.meta.dir, "cli-program.ts"),
      "utf-8",
    )

    // when
    const doctorBlock = cliProgramSource.match(
      /program\s*\n\s*\.command\("doctor"\)([\s\S]*?)\.action\(/,
    )

    // then
    expect(doctorBlock).not.toBeNull()
    expect(doctorBlock?.[1]).toContain('new Option("--platform <platform>"')
    expect(doctorBlock?.[1]).toContain('.choices(["opencode", "codex"])')
    expect(cliProgramSource).toContain(
      "resolveDoctorTarget(process.env.OMO_INVOCATION_NAME, options.platform ?? rootDoctorPlatform)",
    )
  })
})

test("program configures explicit '-h, --help' help option for consistent help-flag ordering", async () => {
  // given
  const cliProgramSource = await readFile(
    path.resolve(import.meta.dir, "cli-program.ts"),
    "utf-8",
  )

  // when
  const programBlock = cliProgramSource.match(
    /program\s*\n((?:\s*\.\w+\([^)]*\)\s*\n?)*)/,
  )

  // then
  expect(programBlock).not.toBeNull()
  expect(programBlock?.[1]).toContain('.helpOption("-h, --help", "Display help for command")')
})

test("program registers runtime commands", async () => {
  // given
  const cliProgramSource = await readFile(
    path.resolve(import.meta.dir, "cli-program.ts"),
    "utf-8",
  )

  // when
  const registersRuntimeCommands = cliProgramSource.includes("configureRuntimeCommands(program)")

  // then
  expect(registersRuntimeCommands).toBe(true)
})
