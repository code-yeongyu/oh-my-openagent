import type { ListingRow, SessionsList } from "../../../src/local-api/protocol.ts"

// What a service does with sessions.list `rows` (docs/local-api.md): `kind`, `parent` and `parent_listed` only from
// `rows: 2`, `durable_id` only from `rows: 3`, `model` and `archived` only from `rows: 4`, `settled` and
// `settled_by` only from `rows: 5`, `waiting` only from `rows: 6` and `engine_version` only from `rows: 7`
// (relay-daemon#1480). A service that predates a version refuses it as invalid_request.
export type RowsVersion = 1 | 2 | 3 | 4 | 5 | 6 | 7

export const rowsRefused = (request: SessionsList, newest: RowsVersion): boolean => (request.rows ?? 1) > newest

const present = <K extends keyof ListingRow>(row: ListingRow, key: K, from: number, rows: number) =>
  rows >= from && row[key] !== undefined ? { [key]: row[key] } : {}

export const rowsAs = (row: ListingRow, rows: SessionsList["rows"]): ListingRow => {
  const {
    kind,
    parent,
    parent_listed,
    durable_id: _durable,
    model: _model,
    archived: _archived,
    settled: _settled,
    settled_by: _by,
    waiting: _waiting,
    engine_version: _version,
    ...base
  } = row
  if (rows === undefined) return base
  return {
    ...base,
    ...(kind === undefined ? {} : { kind }),
    ...(parent === undefined || parent_listed === undefined ? {} : { parent, parent_listed }),
    ...present(row, "durable_id", 3, rows),
    ...present(row, "model", 4, rows),
    ...present(row, "archived", 4, rows),
    ...present(row, "settled", 5, rows),
    ...present(row, "settled_by", 5, rows),
    ...present(row, "waiting", 6, rows),
    ...present(row, "engine_version", 7, rows),
  }
}
