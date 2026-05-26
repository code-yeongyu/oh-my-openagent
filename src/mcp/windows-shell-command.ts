const WINDOWS_SHELL_EXTENSIONS = [".cmd", ".bat"]

function isWindowsShellScript(command: string): boolean {
  const lower = command.toLowerCase()
  return WINDOWS_SHELL_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

export function wrapWindowsShellCommand(command: string[]): string[] {
  if (process.platform !== "win32") return command
  if (command.length === 0) return command

  const [executable, ...args] = command
  if (!isWindowsShellScript(executable)) return command

  return ["cmd.exe", "/c", executable, ...args]
}
