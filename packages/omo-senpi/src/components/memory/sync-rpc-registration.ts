import { z } from "zod"
import { createSyncRpcCoordinator } from "./sync-rpc-coordinator"
import type { SyncRpcOptions, SyncRpcRegistration } from "./sync-rpc-ports"

const empty = z.object({}).strict()
const approval = z.discriminatedUnion("action", [
  z.object({ action: z.literal("begin"), pendingId: z.string().min(1) }).strict(),
  z.object({ action: z.literal("confirm"), pendingId: z.string().min(1), code: z.string().regex(/^[0-9]{6}$/) }).strict(),
  z.object({ action: z.literal("decline"), pendingId: z.string().min(1) }).strict(),
])
const device = z.object({
  id: z.string(), name: z.string(), kind: z.enum(["desktop", "cli"]),
  platform: z.enum(["macos", "linux", "windows"]),
  createdAt: z.string().datetime({ offset: true }), lastSeenAt: z.string().datetime({ offset: true }),
  approximateLocation: z.string().optional(), current: z.boolean(), syncing: z.boolean(),
  revokedAt: z.string().datetime({ offset: true }).nullable(), syncPrincipal: z.string().nullable(),
})

export function registerSyncRpc(rpc: SyncRpcRegistration, options: SyncRpcOptions) {
  const coordinator = createSyncRpcCoordinator(options)
  for (const verb of ["enable", "pending", "approve", "status", "devices"] as const) {
    rpc.handle(`omo.memory.sync.${verb}`, async (data, context) => {
      if (!coordinator.check(context)) return { kind: "unavailable", reason: "A live trusted connection is required." }
      try {
        if (verb === "approve") {
          const parsed = approval.safeParse(data)
          if (!parsed.success) return { kind: "refused", reason: "Invalid approval request." }
          return await coordinator.approve(context, parsed.data)
        }
        if (!empty.safeParse(data).success) return { kind: "refused", reason: "This request takes no parameters." }
        switch (verb) {
          case "enable": return await coordinator.enable(context)
          case "status": return await coordinator.status(context)
          case "pending": return await coordinator.read(context, async (ports) => ({
            pending: (await ports.pairing.listPending()).map((row) => ({
              id: row.id, expiresAt: row.expires_at, answered: row.answer !== null, revealed: row.reveal !== null,
            })),
          }))
          case "devices": return await coordinator.read(context, async (ports) => ({ devices: z.array(device).parse(await ports.devices()) }))
        }
      } catch {
        return { kind: "unavailable", reason: "The sync operation could not complete." }
      }
    })
  }
  return coordinator
}
