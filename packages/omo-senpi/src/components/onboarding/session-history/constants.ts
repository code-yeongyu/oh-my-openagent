/** Chunk size for full transcript reads. */
export const TRANSCRIPT_PREFIX_BYTES = 32 * 1024
/** Small reads avoid wasting the metadata budget on long Codex instruction headers. */
export const METADATA_READ_BYTES = 8 * 1024
/** Prevent malformed transcripts from turning project discovery into a full file scan. */
export const MAX_TRANSCRIPT_SCAN_BYTES = 1024 * 1024

/**
 * Upper bound on transcripts inspected per agent source. Newest-first ordering
 * means the cap drops only stale sessions when a home directory is unusually large.
 */
export const MAX_TRANSCRIPTS_PER_SOURCE = 5000
/** Directory reads and candidate stats share one budget per agent source. */
export const MAX_DISCOVERY_OPERATIONS_PER_SOURCE = MAX_TRANSCRIPTS_PER_SOURCE * 4
export const MAX_METADATA_BYTES_PER_SOURCE = 64 * 1024 * 1024
export const MAX_METADATA_OPERATIONS_PER_SOURCE = MAX_TRANSCRIPTS_PER_SOURCE * 4
export const MAX_METADATA_RECORDS_PER_SOURCE = 100_000
export const MAX_METADATA_RECORDS_PER_TRANSCRIPT = 1_000
export const DEFAULT_RECENT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

export const MAX_IMPORTED_TRANSCRIPT_BYTES = 4 * 1024 * 1024 * 1024
export const MAX_IMPORTED_MESSAGES = 200
export const MAX_IMPORT_HISTORY_BYTES = 32 * 1024 * 1024
export const MAX_IMPORT_BYTES = 4 * 1024 * 1024 * 1024
export const MAX_IMPORT_TRANSCRIPTS = 100
export const MAX_IMPORT_RECORDS = 100_000
/**
 * A single JSONL record past this size (a screenshot tool result, a pasted log)
 * is skipped whole instead of being buffered; it still counts as one record.
 */
export const MAX_IMPORT_RECORD_BYTES = 4 * 1024 * 1024

export const MAX_OMO_DISCOVERY_OPERATIONS = 20_000
export const MAX_OMO_SESSION_HEADERS = 5_000
export const OMO_HEADER_READ_BYTES = 8192
/** A session holding only startup records measures 1.4-2 KB; past this size it is taken to hold a conversation. */
export const OMO_STARTUP_ONLY_MAX_BYTES = 256 * 1024

/** Digest bound: one digest per session stays in the 3-4 KB range. */
export const MAX_SESSION_DIGEST_BYTES = 4096

export const PROJECT_SCAN_CAP = MAX_TRANSCRIPTS_PER_SOURCE * 2 + MAX_OMO_SESSION_HEADERS
