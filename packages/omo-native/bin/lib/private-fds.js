import { closeSync } from "node:fs"
import { inspectPrivateFdTable, PRIVATE_FDS_ENV, privateFdHandoffFor } from "./private-fd-table.js"

// The npm launcher captures the table before anything spawns, so its helper children never see it,
// and closes named sockets it can never forward so no child inherits them. Windows pairs are
// transferred on explicit hops only; their waiting parent's copies close immediately after spawn.
const table = process.env[PRIVATE_FDS_ENV]
delete process.env[PRIVATE_FDS_ENV]
if (table) for (const fd of inspectPrivateFdTable(table).discard) closeSync(fd)

export function privateFdHandoff(env) {
  return privateFdHandoffFor(env, table)
}
