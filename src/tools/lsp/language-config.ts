import { EXT_TO_LANG } from "./constants"
import { detectShebangLanguage } from "./shebang-detection"

export function getLanguageId(filePath: string, ext: string): string {
  if (ext && EXT_TO_LANG[ext]) {
    return EXT_TO_LANG[ext]
  }

  if (!ext) {
    const shebangLang = detectShebangLanguage(filePath)
    if (shebangLang) {
      return shebangLang
    }
  }

  return "plaintext"
}
