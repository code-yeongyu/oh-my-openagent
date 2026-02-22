import { EXT_TO_LANG } from "./constants"

export function getLanguageId(ext: string): string {
  return EXT_TO_LANG[ext] || "plaintext"
}
