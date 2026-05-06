const ATTACHABLE_SESSION_STATUSES = ["idle", "running"] as const

export type AttachableSessionStatus = (typeof ATTACHABLE_SESSION_STATUSES)[number]

export function isAttachableSessionStatus(
  status: string | undefined,
): status is AttachableSessionStatus {
  return ATTACHABLE_SESSION_STATUSES.some(
    (attachableSessionStatus) => attachableSessionStatus === status,
  )
}
