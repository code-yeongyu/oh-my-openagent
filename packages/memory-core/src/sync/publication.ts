import { rename, renameSyncWithContentionRetry } from "../fs/resilient.ts"
import { admitSyncOperation, type SyncOperationOptions } from "./operation-authority.ts"

/** The credential-writer lock spans admission and the synchronous syscall, on every raw retry. */
export const publishSyncRename = async (source: string, target: string, options: SyncOperationOptions): Promise<void> => {
  const authority = options.authority
  if (authority?.boundary === undefined) return rename(source, target, begin => admitSyncOperation(options, begin))
  const boundary = authority.boundary.bind(authority)
  await renameSyncWithContentionRetry(source, target, begin => boundary(() => admitSyncOperation(options, begin)))
}
