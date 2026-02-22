/**
 * Plugin configuration for Claude Code hooks execution
 * Contains settings for hook command execution (zsh, etc.)
 */

const isWindows = process.platform === "win32"

export const DEFAULT_CONFIG = {
  // Windows doesn't have zsh by default, so we disable forceZsh on Windows
  forceZsh: !isWindows,
  zshPath: "/bin/zsh",
}
