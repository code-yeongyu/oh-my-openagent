import { boundedServiceFloor } from "@oh-my-opencode/memory-core/sync-account-ports"
import { z } from "zod"
import { createSyncRpcCoordinator } from "./sync-rpc-coordinator"
import { syncErrorFields } from "./sync-rpc-operation"
import type { SyncRpcContext, SyncRpcOptions, SyncRpcRegistration } from "./sync-rpc-ports"

const empty = z.object({}).strict()
const enableRequest = z.object({ method: z.enum(["passkey", "phrase"]).optional() }).strict()
const acknowledgeRequest = z
  .object({
    notice: z.literal("phrase_void"),
    purpose: z.enum(["genesis", "enroll", "rotate"]),
    credentialId: z.string().min(1).optional(),
  })
  .strict()
const FEATURES = ["enable-method", "phrase-genesis", "acknowledge", "disable"] as const
const WITHOUT_PHRASE = FEATURES.filter((f) => f !== "phrase-genesis")

/** One fresh floor read through the signed-in account's own chain; anything but "on" withholds the feature. */
const phraseGenesisOffered = async (
  coordinator: ReturnType<typeof createSyncRpcCoordinator>,
  context: SyncRpcContext | undefined,
  options: SyncRpcOptions,
): Promise<boolean> => {
  const gate = options.phraseGate
  if (gate?.enabled !== true || gate.serviceFloor === undefined || context === undefined) return false
  // The creation gate's own bounded, shape-checked read, so a hung service cannot hold features and the bounds never drift.
  const answer = await coordinator.read(context, (ports) => boundedServiceFloor(gate, ports.chain))
  return answer === "on"
}
const approval = z.discriminatedUnion("action", [
  z.object({ action: z.literal("begin"), pendingId: z.string().min(1) }).strict(),
  z
    .object({ action: z.literal("confirm"), pendingId: z.string().min(1), code: z.string().regex(/^[0-9]{6}$/) })
    .strict(),
  z.object({ action: z.literal("decline"), pendingId: z.string().min(1) }).strict(),
])
const device = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(["desktop", "cli"]),
  platform: z.enum(["macos", "linux", "windows"]),
  createdAt: z.string().datetime({ offset: true }),
  lastSeenAt: z.string().datetime({ offset: true }),
  approximateLocation: z.string().optional(),
  current: z.boolean(),
  syncing: z.boolean(),
  revokedAt: z.string().datetime({ offset: true }).nullable(),
  syncPrincipal: z.string().nullable(),
})

export function registerSyncRpc(rpc: SyncRpcRegistration, options: SyncRpcOptions) {
  const coordinator = createSyncRpcCoordinator(options)
  for (const verb of [
    "enable",
    "pending",
    "approve",
    "status",
    "devices",
    "features",
    "acknowledge",
    "disable",
  ] as const) {
    rpc.handle(`omo.memory.sync.${verb}`, async (data, context) => {
      if (!coordinator.check(context)) return { kind: "unavailable", reason: "A live trusted connection is required." }
      try {
        if (verb === "approve") {
          const parsed = approval.safeParse(data)
          if (!parsed.success) return { kind: "refused", reason: "Invalid approval request." }
          return await coordinator.approve(context, parsed.data)
        }
        if (verb === "enable") {
          const parsed = enableRequest.safeParse(data)
          if (!parsed.success) return { kind: "refused", reason: "Invalid enable request." }
          const { method } = parsed.data
          return await coordinator.enable(context, method === undefined ? {} : { method })
        }
        if (verb === "acknowledge") {
          const parsed = acknowledgeRequest.safeParse(data)
          if (!parsed.success) return { kind: "refused", reason: "Invalid acknowledge request." }
          const { credentialId, ...rest } = parsed.data
          return await coordinator.acknowledge(context, credentialId === undefined ? rest : { ...rest, credentialId })
        }
        if (!empty.safeParse(data).success) return { kind: "refused", reason: "This request takes no parameters." }
        switch (verb) {
          case "features":
            // Phrase genesis is listed only while the service accepts phrase keys for this account (#14432).
            return { features: (await phraseGenesisOffered(coordinator, context, options)) ? FEATURES : WITHOUT_PHRASE }
          case "status":
            return await coordinator.status(context)
          case "disable":
            return await coordinator.disable(context)
          case "pending":
            return await coordinator.read(context, async (ports) => ({
              pending: (await ports.pairing.listPending()).map((row) => ({
                id: row.id,
                expiresAt: row.expires_at,
                answered: row.answer !== null,
                revealed: row.reveal !== null,
              })),
            }))
          case "devices":
            return await coordinator.read(context, async (ports) => ({
              devices: z.array(device).parse(await ports.devices()),
            }))
        }
      } catch (error) {
        options.warn?.(`memory sync ${verb} unavailable`, {
          path: verb,
          code: "handler_failed",
          ...syncErrorFields(error),
        })
        return { kind: "unavailable", reason: "The sync operation could not complete.", code: "handler_failed" }
      }
    })
  }
  return coordinator
}
