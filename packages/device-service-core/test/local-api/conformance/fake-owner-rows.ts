import type { ListingRow, SessionsList } from "../../../src/local-api/protocol.ts";

// What a service does with sessions.list `rows` (docs/local-api.md): `kind`, `parent` and `parent_listed` only from
// `rows: 2`, `durable_id` only from `rows: 3`. A service that predates a version refuses it as invalid_request.
export type RowsVersion = 1 | 2 | 3;

export const rowsRefused = (request: SessionsList, newest: RowsVersion): boolean =>
  (request.rows ?? 1) > newest;

export const rowsAs = (row: ListingRow, rows: SessionsList["rows"]): ListingRow => {
  const { kind, parent, parent_listed, durable_id, ...base } = row;
  const links = {
    ...(kind === undefined ? {} : { kind }),
    ...(parent === undefined || parent_listed === undefined ? {} : { parent, parent_listed }),
  };
  if (rows === undefined) return base;
  if (rows === 2) return { ...base, ...links };
  return { ...base, ...links, ...(durable_id === undefined ? {} : { durable_id }) };
};
