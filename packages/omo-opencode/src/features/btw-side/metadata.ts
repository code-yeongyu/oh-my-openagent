import { isRecord } from "@oh-my-opencode/utils"

export const BTW_SIDE_METADATA_KEY = "omo_btw_side"
export const BTW_SIDE_METADATA_VERSION = 1

export type BtwSideMetadata = {
  version: typeof BTW_SIDE_METADATA_VERSION
  parent_session_id: string
  boundary_message_id: string
}

export function createBtwSideMetadata(args: {
  parentSessionID: string
  boundaryMessageID: string
}): BtwSideMetadata {
  return {
    version: BTW_SIDE_METADATA_VERSION,
    parent_session_id: args.parentSessionID,
    boundary_message_id: args.boundaryMessageID,
  }
}

export function parseBtwSideMetadata(value: unknown): BtwSideMetadata | undefined {
  if (!isRecord(value)) return undefined
  if (value.version !== BTW_SIDE_METADATA_VERSION) return undefined
  if (typeof value.parent_session_id !== "string" || value.parent_session_id.length === 0) {
    return undefined
  }
  if (typeof value.boundary_message_id !== "string" || value.boundary_message_id.length === 0) {
    return undefined
  }
  return {
    version: BTW_SIDE_METADATA_VERSION,
    parent_session_id: value.parent_session_id,
    boundary_message_id: value.boundary_message_id,
  }
}

export function getBtwSideMetadata(session: {
  metadata?: Record<string, unknown>
} | undefined): BtwSideMetadata | undefined {
  return parseBtwSideMetadata(session?.metadata?.[BTW_SIDE_METADATA_KEY])
}
