export type OmoCommandPrimary = "status" | "memo" | "ulw"
export type OmoCommandAction = "status" | "on" | "off" | "toggle"

export interface ParsedOmoCommand {
  primary: OmoCommandPrimary
  action: OmoCommandAction
}

export function parseOmoCommandArgs(args: string): ParsedOmoCommand {
  const tokens = args
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => t.toLowerCase())

  const primaryRaw = tokens[0] ?? "status"
  const actionRaw = tokens[1] ?? "status"

  const primary: OmoCommandPrimary =
    primaryRaw === "mono" || primaryRaw === "memo"
      ? "memo"
      : primaryRaw === "ulw" || primaryRaw === "ultrawork"
        ? "ulw"
        : "status"

  const action: OmoCommandAction =
    actionRaw === "on" || actionRaw === "off" || actionRaw === "toggle"
      ? actionRaw
      : "status"

  return { primary, action }
}

