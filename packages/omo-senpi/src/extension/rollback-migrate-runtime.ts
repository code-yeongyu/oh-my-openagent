import { readFileSync } from "node:fs"

import {
  migrateHostSessionSockets,
  planHostSessionSocketMigration,
} from "../../../senpi-task/src/store/rollback-migrate"
import { pruneMissingStoreIndexEntries } from "../../../senpi-task/src/runners/rpc-host/store-index"

type MigrationRequest = {
  readonly operation?: "migrate"
  readonly storeDir: string
  readonly to: string
  readonly deadEndpoints?: readonly string[]
  readonly dryRun?: boolean
  readonly planOnly?: boolean
}

type PruneRequest = {
  readonly operation: "prune-store-index"
  readonly indexPath: string
}

const request = JSON.parse(readFileSync(0, "utf8")) as MigrationRequest | PruneRequest
const result = request.operation === "prune-store-index"
  ? { removed: await pruneMissingStoreIndexEntries(request.indexPath) }
  : request.planOnly
    ? planHostSessionSocketMigration(request.storeDir, request.to)
    : migrateHostSessionSockets(request.storeDir, {
        to: request.to,
        deadEndpoints: new Set(request.deadEndpoints ?? []),
        dryRun: request.dryRun,
      })
process.stdout.write(`${JSON.stringify(result)}\n`)
