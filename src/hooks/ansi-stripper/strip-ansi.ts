const ANSI_PATTERN =
  /[\x1b\x9b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g

export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "")
}

export function containsAnsi(text: string): boolean {
  return /[\x1b\x9b]/.test(text)
}
