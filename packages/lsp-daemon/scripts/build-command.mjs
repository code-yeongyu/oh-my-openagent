const ABSOLUTE_COMMAND_PATH = /^(?:[A-Za-z]:[\\/]|\\\\|\/)/

export function shouldUseShellForCommand(command, platform = process.platform) {
  return platform === "win32" && !ABSOLUTE_COMMAND_PATH.test(command)
}
