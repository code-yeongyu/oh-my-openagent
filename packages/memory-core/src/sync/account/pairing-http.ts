// The pairing ceremony's pending-approval routes and the sync switches (omo-service contract
// 1.17.0, sync-design section 8.1). Rows are untrusted: the ceremony recomputes the commitment and
// both devices compare the code before anything is signed.

import type { Principal } from "../crypto/parse.ts"
import { AccountHttpError, type AccountHttpOptions } from "./http.ts"
import { admitSyncOperation, syncOperationSignal, type SyncOperationOptions } from "../operation-authority.ts"

export interface PendingApproval {
  readonly id: string
  readonly account: string
  readonly commitment: string
  readonly answer: { readonly principal: Principal; readonly approver_nonce: string } | null
  readonly reveal: { readonly principal: Principal; readonly joining_nonce: string } | null
  readonly expires_at: number
}

export interface PairingHttp {
  openPending(account: string, commitment: string, operation?: SyncOperationOptions): Promise<PendingApproval>
  readPending(id: string, operation?: SyncOperationOptions): Promise<PendingApproval | null>
  listPending(operation?: SyncOperationOptions): Promise<ReadonlyArray<PendingApproval>>
  answerPending(id: string, principal: Principal, approverNonce: string, operation?: SyncOperationOptions): Promise<PendingApproval>
  revealPending(id: string, principal: Principal, joiningNonce: string, operation?: SyncOperationOptions): Promise<PendingApproval>
  setAccountSync(enabled: boolean, operation?: SyncOperationOptions): Promise<void>
  setDeviceSync(deviceId: string, enabled: boolean, operation?: SyncOperationOptions): Promise<void>
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

const isPrincipal = (value: unknown): value is Principal =>
  isRecord(value) && value["kind"] === "device" && typeof value["id"] === "string" && typeof value["sealing_public_key"] === "string" && typeof value["signing_public_key"] === "string"

function parsePending(value: unknown): PendingApproval | null {
  if (!isRecord(value)) return null
  const { id, account, commitment, answer, reveal, expires_at } = value
  if (typeof id !== "string" || typeof account !== "string" || typeof commitment !== "string" || typeof expires_at !== "number") return null
  const parsedAnswer = isRecord(answer) && isPrincipal(answer["principal"]) && typeof answer["approver_nonce"] === "string" ? { principal: answer["principal"], approver_nonce: answer["approver_nonce"] } : null
  const parsedReveal = isRecord(reveal) && isPrincipal(reveal["principal"]) && typeof reveal["joining_nonce"] === "string" ? { principal: reveal["principal"], joining_nonce: reveal["joining_nonce"] } : null
  if ((answer !== null && answer !== undefined && parsedAnswer === null) || (reveal !== null && reveal !== undefined && parsedReveal === null)) return null
  return { id, account, commitment, answer: parsedAnswer, reveal: parsedReveal, expires_at }
}

export function createPairingHttp(options: AccountHttpOptions): PairingHttp {
  const doFetch = options.fetch ?? fetch
  const send = async (method: string, path: string, body: unknown, operation: SyncOperationOptions = options): Promise<unknown> => {
    const headers: Record<string, string> = { authorization: `Bearer ${await options.token()}` }
    if (body !== undefined) headers["content-type"] = "application/json"
    const signal = syncOperationSignal(operation)
    const response = await admitSyncOperation(operation, () => doFetch(`${options.baseUrl}${path}`, {
      method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(signal === undefined ? {} : { signal }),
    }))
    if (!response.ok) {
      const code = await response.json().then(
        (b: unknown) => (isRecord(b) && isRecord(b["error"]) && typeof b["error"]["code"] === "string" ? b["error"]["code"] : "unknown"),
        () => "unknown",
      )
      throw new AccountHttpError(response.status >= 500 ? "unavailable" : code, response.status)
    }
    return response.status === 204 ? null : response.json()
  }
  const pending = async (method: string, path: string, body: unknown, operation?: SyncOperationOptions): Promise<PendingApproval> => {
    const parsed = parsePending(await send(method, path, body, operation))
    if (parsed === null) throw new AccountHttpError("malformed_reply", 200)
    return parsed
  }
  return {
    openPending: (account, commitment, operation) => pending("PUT", "/v1/sync/pending", { account, commitment }, operation),
    async readPending(id, operation) {
      try {
        return await pending("GET", `/v1/sync/pending/${encodeURIComponent(id)}`, undefined, operation)
      } catch (error) {
        if (error instanceof AccountHttpError && error.code === "not_found") return null
        throw error
      }
    },
    async listPending(operation) {
      const body = await send("GET", "/v1/sync/pending", undefined, operation)
      const rows = isRecord(body) && Array.isArray(body["pending"]) ? body["pending"] : []
      return rows.map(parsePending).filter((row): row is PendingApproval => row !== null)
    },
    answerPending: (id, principal, approverNonce, operation) => pending("POST", `/v1/sync/pending/${encodeURIComponent(id)}/answer`, { principal, approver_nonce: approverNonce }, operation),
    revealPending: (id, principal, joiningNonce, operation) => pending("POST", `/v1/sync/pending/${encodeURIComponent(id)}/reveal`, { principal, joining_nonce: joiningNonce }, operation),
    async setAccountSync(enabled, operation) {
      await send("PUT", "/v1/account/sync", { enabled }, operation)
    },
    async setDeviceSync(deviceId, enabled, operation) {
      await send("PUT", `/v1/devices/${encodeURIComponent(deviceId)}/sync`, { enabled }, operation)
    },
  }
}
