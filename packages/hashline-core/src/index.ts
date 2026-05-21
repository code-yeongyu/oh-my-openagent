/**
 * Hashline core public API.
 *
 * Hash dependency choice: Option 2.
 * This package embeds a runtime-aware xxHash32 implementation (`xxhash32.ts`)
 * that prefers the host runtime's native xxHash32 binding when available and
 * falls back to a pure-JS implementation otherwise. No package-level dependency
 * on any specific runtime; the binding is detected via globalThis at call time.
 */
export { NIBBLE_STR, HASHLINE_DICT, HASHLINE_REF_PATTERN, HASHLINE_OUTPUT_PATTERN } from "./constants"
export type { ReplaceEdit, AppendEdit, PrependEdit, HashlineEdit } from "./types"
export {
  computeLineHash,
  computeLegacyLineHash,
  formatHashLine,
  formatHashLines,
  streamHashLinesFromUtf8,
  streamHashLinesFromLines,
} from "./hash-computation"
export { parseLineRef, validateLineRef, validateLineRefs, HashlineMismatchError, normalizeLineRef } from "./validation"
export type { LineRef } from "./validation"
export { applyHashlineEdits, applyHashlineEditsWithReport } from "./edit-operations"
export type { HashlineApplyReport } from "./edit-operations"
export {
  applySetLine,
  applyReplaceLines,
  applyInsertAfter,
  applyInsertBefore,
  applyAppend,
  applyPrepend,
} from "./edit-operation-primitives"
export { getEditLineNumber, collectLineRefs, detectOverlappingRanges } from "./edit-ordering"
export { dedupeEdits } from "./edit-deduplication"
export {
  stripLinePrefixes,
  toNewLines,
  restoreLeadingIndent,
  stripInsertAnchorEcho,
  stripInsertBeforeEcho,
  stripInsertBoundaryEcho,
  stripRangeBoundaryEcho,
} from "./edit-text-normalization"
export { canonicalizeFileText, restoreFileText } from "./file-text-canonicalization"
export type { FileTextEnvelope } from "./file-text-canonicalization"
export {
  stripTrailingContinuationTokens,
  stripMergeOperatorChars,
  restoreOldWrappedLines,
  maybeExpandSingleLineMerge,
  restoreIndentForPairedReplacement,
  autocorrectReplacementLines,
} from "./autocorrect-replacement-lines"
export { normalizeHashlineEdits } from "./normalize-edits"
export type { RawHashlineEdit } from "./normalize-edits"
export { createHashlineChunkFormatter } from "./hashline-chunk-formatter"
export type { HashlineChunkFormatter } from "./hashline-chunk-formatter"
export type { HashlineStreamOptions } from "./hash-computation"
export { toHashlineContent, generateUnifiedDiff, countLineDiffs } from "./diff-utils"
export { generateHashlineDiff } from "./hashline-edit-diff"
