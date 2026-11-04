// The service's revoke freeze (omo-service sync-design section 7; trigger sync_freeze_on_revoke,
// pushGate, the rotation admission rule), shared by both in-process wire servers so a test drives
// one model. A revoke reaches it the way clients reach the service's revokeDevice: through
// `DELETE /v1/devices/:id` (`omo logout`, the Devices page) or `POST /v1/session/sign-out` (the
// desktop sign-out). A revoked member sets `rotation_pending`; while it is set every push is refused
// `stale_base`; the revoked device's every request is refused with the on-contract
// `401 device_revoked` envelope; a rotation that keeps a revoked key is refused `forbidden`.

export interface ModelDevice {
  readonly id: string
  readonly kind: "desktop" | "cli"
  readonly principal: string | null
  readonly signingKey: string | null
  revokedAt: string | null
}

const envelope = (status: number, code: string): Response =>
  Response.json({ error: { code, message: code, retryable: false, requestId: `req_${code}` } }, { status })

export class FreezeModel {
  private pendingFlag = false
  private readonly devices = new Map<string, ModelDevice>()
  /** The permanent revoked-key ledger (sync_revoked_keys): revocations never appear in the chain. */
  private readonly register = new Set<string>()
  private readonly listeners = new Set<() => void>()
  private readonly unreadable = new Set<string>()

  constructor(private readonly isMember: (signingKey: string) => boolean) {}

  get pending(): boolean {
    return this.pendingFlag
  }

  /** Sets or clears the flag; setting it announces `sync.state.changed` as the service does. */
  setPending(pending: boolean): void {
    const raised = pending && !this.pendingFlag
    this.pendingFlag = pending
    if (raised) for (const listener of this.listeners) listener()
  }

  onStateChanged(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  addDevice(device: Omit<ModelDevice, "revokedAt">): void {
    if (!this.devices.has(device.id)) this.devices.set(device.id, { ...device, revokedAt: null })
  }

  /** revokeDevice: the row is marked, its key enters the ledger, and a member's revoke freezes pushes. */
  revoke(deviceId: string): void {
    const device = this.devices.get(deviceId)
    if (device === undefined || device.revokedAt !== null) return
    device.revokedAt = new Date(0).toISOString()
    if (device.signingKey === null) return
    this.register.add(device.signingKey)
    if (this.isMember(device.signingKey)) this.setPending(true)
  }

  isRevokedDevice(deviceId: string): boolean {
    return this.devices.get(deviceId)?.revokedAt != null
  }

  isRevokedKey(signingKey: string): boolean {
    return this.register.has(signingKey)
  }

  /** The device list: every row of the account, revoked rows included, unfiltered. */
  deviceList(currentId: string): unknown {
    return {
      devices: [...this.devices.values()].map((d) => ({
        id: d.id, name: d.id, kind: d.kind, platform: "linux", createdAt: new Date(0).toISOString(),
        lastSeenAt: new Date(0).toISOString(), current: d.id === currentId, syncing: true,
        revokedAt: d.revokedAt, syncPrincipal: d.principal,
      })),
      browsers: [],
    }
  }

  /** The refusal every request of a revoked device gets. */
  revokedRefusal(): Response {
    return envelope(401, "device_revoked")
  }

  staleRefusal(): Response {
    return envelope(409, "stale_base")
  }

  forbiddenRefusal(): Response {
    return envelope(403, "forbidden")
  }

  /** Makes `GET /v1/devices` fail for one caller, so that device cannot build a rotation. */
  blockDeviceList(deviceId: string): void {
    this.unreadable.add(deviceId)
  }

  /** The revoke and device-list routes; null when the request is not one of them. */
  route(method: string, path: string, callerDeviceId: string): Response | null {
    if (method === "GET" && path === "/v1/devices") {
      return this.unreadable.has(callerDeviceId) ? envelope(503, "unavailable") : Response.json(this.deviceList(callerDeviceId))
    }
    const revoke = /^\/v1\/devices\/([^/]+)$/.exec(path)
    if (method === "DELETE" && revoke !== null) {
      this.revoke(decodeURIComponent(revoke[1] ?? ""))
      return new Response(null, { status: 204 })
    }
    if (method === "POST" && path === "/v1/session/sign-out") {
      this.revoke(callerDeviceId)
      return Response.json({ signedOut: true })
    }
    return null
  }
}
