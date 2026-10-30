import { admitSyncOperation, type SyncOperationOptions } from "../operation-authority.ts"
import type { AccountHttp } from "./http.ts"
import type { PairingHttp } from "./pairing-http.ts"

/** Pass authority into the transport too: admission around a token-refreshing helper is too early. */
export const accountOperation = (http: AccountHttp, operation: SyncOperationOptions = {}): AccountHttp => ({
  listKeys: () => admitSyncOperation(operation, () => http.listKeys(operation)),
  listEntries: () => admitSyncOperation(operation, () => http.listEntries(operation)),
  listEntriesAfter: (after) => admitSyncOperation(operation, () => http.listEntriesAfter(after, operation)),
  listRecoveryWraps: () => admitSyncOperation(operation, () => http.listRecoveryWraps(operation)),
  state: () => admitSyncOperation(operation, () => http.state(operation)),
  appendKeys: (request) => admitSyncOperation(operation, () => http.appendKeys(request, operation)),
  recoveryJoin: (request) => admitSyncOperation(operation, () => http.recoveryJoin(request, operation)),
})

export const pairingOperation = (http: PairingHttp, operation: SyncOperationOptions = {}): PairingHttp => ({
  openPending: (account, commitment) => admitSyncOperation(operation, () => http.openPending(account, commitment, operation)),
  readPending: (id) => admitSyncOperation(operation, () => http.readPending(id, operation)),
  listPending: () => admitSyncOperation(operation, () => http.listPending(operation)),
  answerPending: (id, principal, nonce) => admitSyncOperation(operation, () => http.answerPending(id, principal, nonce, operation)),
  revealPending: (id, principal, nonce) => admitSyncOperation(operation, () => http.revealPending(id, principal, nonce, operation)),
  setAccountSync: (enabled) => admitSyncOperation(operation, () => http.setAccountSync(enabled, operation)),
  setDeviceSync: (id, enabled) => admitSyncOperation(operation, () => http.setDeviceSync(id, enabled, operation)),
})
