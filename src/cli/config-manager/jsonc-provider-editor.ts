import { modify, applyEdits } from "jsonc-parser"

export function modifyProviderInJsonc(
  content: string,
  newProviderValue: Record<string, unknown>
): string {
  const edits = modify(content, ["provider"], newProviderValue, {
    formattingOptions: { tabSize: 2, insertSpaces: true },
  })
  return applyEdits(content, edits)
}
