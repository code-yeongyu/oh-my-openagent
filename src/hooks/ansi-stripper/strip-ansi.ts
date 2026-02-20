const ANSI_REGEX =
  /[\x1b\x9b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g

export function stripAnsi(text: string): string {
  return text.replace(ANSI_REGEX, "")
}

export function containsAnsi(text: string): boolean {
  return ANSI_REGEX.test(text)
}
