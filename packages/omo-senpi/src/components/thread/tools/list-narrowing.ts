import type { ThreadToolResult } from "../contracts"

/** A listing cut to the rows whose thread value, name, alias or folder contains `query` (ignoring case), then to `limit` rows. */
export function narrowListing(
  listed: ThreadToolResult,
  query: string | undefined,
  limit: number | undefined,
): ThreadToolResult {
  if ((query === undefined && limit === undefined) || listed.kind !== "ok" || !("threads" in listed)) return listed
  const needle = query?.toLowerCase()
  const matching =
    needle === undefined
      ? listed.threads
      : listed.threads.filter((row) =>
          [row.thread, row.name, row.alias, row.cwd].some(
            (field) => typeof field === "string" && field.toLowerCase().includes(needle),
          ),
        )
  const shown = limit === undefined ? matching : matching.slice(0, limit)
  return {
    ...listed,
    threads: shown,
    ...(shown.length < matching.length ? { rows_omitted: matching.length - shown.length } : {}),
  }
}
