import { describe, it, expect } from "bun:test"
import { buildRgArgs, buildFindArgs, buildPowerShellCommand } from "./cli"

describe("buildRgArgs", () => {
  // #given default options (no hidden/follow specified)
  // #when building ripgrep args
  // #then should include --hidden and --follow by default
  it("includes --hidden by default when not explicitly set", () => {
    const args = buildRgArgs({ pattern: "*.ts" })
    expect(args).toContain("--hidden")
  })

  it("includes --follow by default when not explicitly set", () => {
    const args = buildRgArgs({ pattern: "*.ts" })
    expect(args).toContain("--follow")
  })

  // #given hidden=false explicitly set
  // #when building ripgrep args
  // #then should NOT include --hidden
  it("excludes --hidden when explicitly set to false", () => {
    const args = buildRgArgs({ pattern: "*.ts", hidden: false })
    expect(args).not.toContain("--hidden")
  })

  // #given follow=false explicitly set
  // #when building ripgrep args
  // #then should NOT include --follow
  it("excludes --follow when explicitly set to false", () => {
    const args = buildRgArgs({ pattern: "*.ts", follow: false })
    expect(args).not.toContain("--follow")
  })

  // #given hidden=true explicitly set
  // #when building ripgrep args
  // #then should include --hidden
  it("includes --hidden when explicitly set to true", () => {
    const args = buildRgArgs({ pattern: "*.ts", hidden: true })
    expect(args).toContain("--hidden")
  })

  // #given follow=true explicitly set
  // #when building ripgrep args
  // #then should include --follow
  it("includes --follow when explicitly set to true", () => {
    const args = buildRgArgs({ pattern: "*.ts", follow: true })
    expect(args).toContain("--follow")
  })

  // #given pattern with special characters
  // #when building ripgrep args
  // #then should include glob pattern correctly
  it("includes the glob pattern", () => {
    const args = buildRgArgs({ pattern: "**/*.tsx" })
    expect(args).toContain("--glob=**/*.tsx")
  })
})

describe("buildFindArgs", () => {
  // #given default options (no hidden/follow specified)
  // #when building find args
  // #then should include hidden files by default (no exclusion filter)
  it("includes hidden files by default when not explicitly set", () => {
    const args = buildFindArgs({ pattern: "*.ts" })
    // When hidden is enabled (default), should NOT have the exclusion filter
    expect(args).not.toContain("-not")
    expect(args.join(" ")).not.toContain("*/.*")
  })

  // #given default options (no follow specified)
  // #when building find args
  // #then should include -L flag for symlink following by default
  it("includes -L flag for symlink following by default", () => {
    const args = buildFindArgs({ pattern: "*.ts" })
    expect(args).toContain("-L")
  })

  // #given hidden=false explicitly set
  // #when building find args
  // #then should exclude hidden files
  it("excludes hidden files when hidden is explicitly false", () => {
    const args = buildFindArgs({ pattern: "*.ts", hidden: false })
    expect(args).toContain("-not")
    expect(args.join(" ")).toContain("*/.*")
  })

  // #given follow=false explicitly set
  // #when building find args
  // #then should NOT include -L flag
  it("excludes -L flag when follow is explicitly false", () => {
    const args = buildFindArgs({ pattern: "*.ts", follow: false })
    expect(args).not.toContain("-L")
  })

  // #given hidden=true explicitly set
  // #when building find args
  // #then should include hidden files
  it("includes hidden files when hidden is explicitly true", () => {
    const args = buildFindArgs({ pattern: "*.ts", hidden: true })
    expect(args).not.toContain("-not")
    expect(args.join(" ")).not.toContain("*/.*")
  })

  // #given follow=true explicitly set
  // #when building find args
  // #then should include -L flag
  it("includes -L flag when follow is explicitly true", () => {
    const args = buildFindArgs({ pattern: "*.ts", follow: true })
    expect(args).toContain("-L")
  })
})

describe("buildPowerShellCommand", () => {
  // #given default options (no hidden specified)
  // #when building PowerShell command
  // #then should include -Force by default
  it("includes -Force by default when not explicitly set", () => {
    const args = buildPowerShellCommand({ pattern: "*.ts" })
    const command = args.join(" ")
    expect(command).toContain("-Force")
  })

  // #given hidden=false explicitly set
  // #when building PowerShell command
  // #then should NOT include -Force
  it("excludes -Force when hidden is explicitly false", () => {
    const args = buildPowerShellCommand({ pattern: "*.ts", hidden: false })
    const command = args.join(" ")
    expect(command).not.toContain("-Force")
  })

  // #given hidden=true explicitly set
  // #when building PowerShell command
  // #then should include -Force
  it("includes -Force when hidden is explicitly true", () => {
    const args = buildPowerShellCommand({ pattern: "*.ts", hidden: true })
    const command = args.join(" ")
    expect(command).toContain("-Force")
  })

  // #given default options (no follow specified)
  // #when building PowerShell command
  // #then should NOT include -FollowSymlink (unsupported in Windows PowerShell 5.1)
  it("does NOT include -FollowSymlink (unsupported in Windows PowerShell 5.1)", () => {
    const args = buildPowerShellCommand({ pattern: "*.ts" })
    const command = args.join(" ")
    expect(command).not.toContain("-FollowSymlink")
  })

  // #given pattern with special chars
  // #when building PowerShell command
  // #then should escape single quotes properly
  it("escapes single quotes in pattern", () => {
    const args = buildPowerShellCommand({ pattern: "test's.ts" })
    const command = args.join(" ")
    expect(command).toContain("test''s.ts")
  })
})
