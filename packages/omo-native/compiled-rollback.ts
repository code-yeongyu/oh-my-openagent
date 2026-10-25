import { migrateHostSessionSockets, planHostSessionSocketMigration } from "../senpi-task/src/store/rollback-migrate"
import { pruneMissingStoreIndexEntriesSync } from "../senpi-task/src/runners/rpc-host/store-index"

type CompiledRollbackMigrationRequest =
  | {
      readonly operation?: "migrate"
      readonly storeDir: string
      readonly to: string
      readonly deadEndpoints?: readonly string[]
      readonly dryRun?: boolean
      readonly planOnly?: boolean
    }
  | {
      readonly operation: "prune-store-index"
      readonly indexPath: string
    }

export function compiledRollbackMigration() {
  return {
    run(request: CompiledRollbackMigrationRequest) {
      if (request.operation === "prune-store-index") {
        return { removed: pruneMissingStoreIndexEntriesSync(request.indexPath) }
      }
      if (request.planOnly) {
        return planHostSessionSocketMigration(request.storeDir, request.to)
      }
      return migrateHostSessionSockets(request.storeDir, {
        to: request.to,
        deadEndpoints: new Set(request.deadEndpoints ?? []),
        dryRun: request.dryRun,
      })
    },
  }
}
