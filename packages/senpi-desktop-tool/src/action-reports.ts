import type { EngineMethod } from "@oh-my-opencode/senpi-desktop-protocol"
import type { ActionReport } from "@oh-my-opencode/senpi-desktop-sdk"
import type { ComputerCallHost } from "@oh-my-opencode/senpi-desktop-service"
import type { ComputerHandle } from "./activation"

/** Engine methods whose reply is `null` or an `ActionReport` (`ax.typeText`: the reply's `report` member). */
const EXEC_REPLY_METHODS: ReadonlySet<EngineMethod> = new Set<EngineMethod>([
  "click",
  "moveMouse",
  "drag",
  "scroll",
  "typeText",
  "keyChord",
  "holdKeys",
  "holdMouse",
  "raiseWindow",
  "menus.select",
  "clipboard.write",
  "ax.perform",
  "ax.setValue",
  "ax.focus",
  "ax.click",
  "ax.typeText",
])

/** The SDK report of an engine that replied `null`: sent, unverified, never safe to resend (SDK `legacyReport`). */
const LEGACY_REPORT: ActionReport = {
  disposition: { delivery: "delivered_unverified", retry: "unsafe" },
  delivered: null,
  effect: "unverifiable",
  route: null,
  hit: null,
  focusRestoration: "not_confirmed",
  openedSurfaces: [],
  nextCall: null,
  note: null,
  warning: null,
  auditIds: [],
  timings: null,
  legacy: true,
}

/** An engine `ActionReport` as the wire carries it: the four required members, the rest optional. */
type EngineReport = Pick<ActionReport, "disposition" | "effect" | "focusRestoration" | "auditIds"> &
  Partial<Pick<ActionReport, "delivered" | "route" | "openedSurfaces" | "nextCall" | "note" | "warning">> & {
    readonly hit?: { readonly role: NonNullable<ActionReport["hit"]>["role"]; readonly label?: string | null } | null
  }

/**
 * An exec reply in the SDK's `ActionReport` shape, member for member as the SDK maps it. Nothing has checked the
 * reply yet: `reportingService` sits under the facade and records each reply as the engine sent it, before the
 * facade validates it (`expectResult` with `isExecResult`). A malformed reply is recorded here and only then fails
 * that check, and even a reply that passes it carries `effect`, `route` and `focusRestoration` checked only as strings,
 * not as members of the SDK's unions.
 */
function actionReportOf(reply: unknown): ActionReport {
  if (reply === null || reply === undefined) return LEGACY_REPORT
  const report = reply as EngineReport
  return {
    disposition: report.disposition,
    delivered: report.delivered ?? null,
    effect: report.effect,
    route: report.route ?? null,
    hit: report.hit == null ? null : { role: report.hit.role, label: report.hit.label ?? null },
    focusRestoration: report.focusRestoration,
    openedSurfaces: report.openedSurfaces ?? [],
    nextCall: report.nextCall ?? null,
    note: report.note ?? null,
    warning: report.warning ?? null,
    auditIds: report.auditIds,
    timings: null,
    legacy: false,
  }
}

/** The call's engine channel, recording the report of every input action it carries. */
export function reportingService(
  service: ComputerHandle["service"],
  reports: ActionReport[],
): ComputerCallHost["service"] {
  return {
    call: async (method, params, options) => {
      const reply = await service.call(method, params, options)
      if (EXEC_REPLY_METHODS.has(method)) {
        reports.push(actionReportOf(method === "ax.typeText" ? Reflect.get(Object(reply), "report") : reply))
      }
      return reply
    },
    onAudit: (listener) => service.onAudit(listener),
    revokeControl: () => service.revokeControl(),
    reportError: (error) => service.reportError(error),
  }
}
