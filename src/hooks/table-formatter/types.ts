export type TextCompleteHook = {
  "experimental.text.complete"?: (
    input: {
      sessionID: string
      messageID: string
      partID: string
    },
    output: { text: string }
  ) => Promise<void>
}

export interface ParsedTable {
  startIndex: number
  endIndex: number
  original: string
  headers: string[]
  alignments: Array<"left" | "center" | "right">
  rows: string[][]
}
