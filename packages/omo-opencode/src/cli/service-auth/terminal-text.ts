import { stripVTControlCharacters } from "node:util"

export function terminalText(value: string): string {
  return stripVTControlCharacters(value).replace(/[\p{C}\p{Zl}\p{Zp}]/gu, "")
}
