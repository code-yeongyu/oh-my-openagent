export type FileScanCursor = {
  readonly direction: "file_scan"
  readonly revision: string
  readonly offset: number
  readonly skip: boolean
}

/**
 * `forward` continues after `offset` (page mode); `older` pages the entries of a tail window before `before`, down to
 * the window's first entry `floor` (the cursor a tail read issues, #14173); `file_tail` does the same for a window
 * read from the session file's end, whose requested `count` the next page reuses and whose positions count from
 * that window's first entry (#14418).
 */
export type TranscriptCursor =
  | FileScanCursor
  | { readonly direction: "forward"; readonly revision: string; readonly offset: number }
  | { readonly direction: "older"; readonly revision: string; readonly before: number; readonly floor: number }
  | { readonly direction: "file_tail"; readonly revision: string; readonly before: number; readonly count: number }

export type EntryCursor = { readonly revision: string; readonly before: string; readonly floor: string }

export const THREAD_TAIL_MAX_ITEMS: 200
export function encodeTranscriptCursor(cursor: TranscriptCursor): string
export function encodeEntryCursor(cursor: EntryCursor): string
export function decodeTranscriptCursor(raw: string): TranscriptCursor | null
export function decodeEntryCursor(raw: string): EntryCursor | "retired" | null
export function isReadCursor(raw: unknown): boolean
