import { describe, expect, it } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { buildSubagentPaneTitle, escapeTmuxFormat } from "./pane-command"

const tmuxPath = Bun.which("tmux")
const itWithTmux = it.skipIf(process.platform === "win32" || tmuxPath === null)

describe("buildSubagentPaneTitle", () => {
  it("#given format syntax in the description #when the title is built #then every # is doubled after the 20-character cut", () => {
    expect(buildSubagentPaneTitle("#(touch x)#{pane_id} and more")).toBe("omo-subagent-##(touch x)##{pane_id}")
  })

  it("#given a NUL byte #when the title is built #then it is dropped so the tmux spawn does not throw", () => {
    expect(buildSubagentPaneTitle("a\0b")).toBe("omo-subagent-ab")
  })

  itWithTmux("#given a real tmux server #when select-pane -T gets the title #then tmux stores it literally instead of expanding #{} or starting a #() job", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "omo-tmux-title-"))
    const socketName = `omo-title-${process.pid}-${Date.now()}`
    const { TMUX: _outerTmux, ...env } = process.env
    const tmux = (...args: string[]) =>
      Bun.spawnSync([tmuxPath ?? "tmux", "-L", socketName, "-f", "/dev/null", ...args], { stdout: "pipe", stderr: "pipe", env })

    try {
      expect(tmux("new-session", "-d", "-c", tempDir, "sleep 30").exitCode).toBe(0)

      expect(tmux("select-pane", "-T", buildSubagentPaneTitle("#{pane_id}#(touch c)")).exitCode).toBe(0)

      expect(tmux("display-message", "-p", "#{pane_title}").stdout.toString().trim()).toBe("omo-subagent-#{pane_id}#(touch c)")
      expect(existsSync(join(tempDir, "c"))).toBe(false)
    } finally {
      tmux("kill-server")
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  itWithTmux("#given a real tmux server #when split-window -c gets an escaped directory #then the pane opens in the literal directory", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "omo-tmux-dir-"))
    const literalDir = join(tempDir, "#{session_name}")
    mkdirSync(literalDir)
    const socketName = `omo-dir-${process.pid}-${Date.now()}`
    const { TMUX: _outerTmux, ...env } = process.env
    const tmux = (...args: string[]) =>
      Bun.spawnSync([tmuxPath ?? "tmux", "-L", socketName, "-f", "/dev/null", ...args], { stdout: "pipe", stderr: "pipe", env })

    try {
      expect(tmux("new-session", "-d", "-c", tempDir, "sleep 30").exitCode).toBe(0)

      const split = tmux("split-window", "-d", "-P", "-F", "#{pane_id}", "-c", escapeTmuxFormat(literalDir), "sleep 30")
      const paneId = split.stdout.toString().trim()

      expect(split.exitCode).toBe(0)
      expect(realpathSync(tmux("display-message", "-p", "-t", paneId, "#{pane_start_path}").stdout.toString().trim())).toBe(realpathSync(literalDir))
    } finally {
      tmux("kill-server")
      rmSync(tempDir, { recursive: true, force: true })
    }
  })
})
