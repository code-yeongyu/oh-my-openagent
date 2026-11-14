import type { ListingRow, SessionsList } from "../../../src/local-api/protocol.ts"

// What a service does with sessions.list `rows` (docs/local-api.md): `kind`, `parent` and `parent_listed` only from
// `rows: 2`, `durable_id` only from `rows: 3`, `model` and `archived` only from `rows: 4`. A service that predates a
// version refuses it as invalid_request.
export type RowsVersion = 1 | 2 | 3 | 4

export const rowsRefused = (request: SessionsList, newest: RowsVersion): boolean => (request.rows ?? 1) > newest

export const rowsAs = (row: ListingRow, rows: SessionsList["rows"]): ListingRow => {
  const { kind, parent, parent_listed, durable_id, model, archived, ...base } = row
  const links = {
    ...(kind === undefined ? {} : { kind }),
    ...(parent === undefined || parent_listed === undefined ? {} : { parent, parent_listed }),
  }
  if (rows === undefined) return base
  if (rows === 2) return { ...base, ...links }
  const durable = durable_id === undefined ? {} : { durable_id }
  if (rows === 3) return { ...base, ...links, ...durable }
  return {
    ...base,
    ...links,
    ...durable,
    ...(model === undefined ? {} : { model }),
    ...(archived === undefined ? {} : { archived }),
  }
}
