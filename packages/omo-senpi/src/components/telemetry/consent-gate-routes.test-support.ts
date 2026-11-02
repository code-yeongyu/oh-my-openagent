import { scanWriterSites, siteKey, type WriterSite } from "./consent-gate-sites.test-support"

// How an event-emitting call site reaches the one consent gate, `isOmoNativeTelemetryEnabled` (#10226 H1).
// The reviewed table declares a route per call; the audit then checks the route against the source as it
// is now, so a send path that stops reading the gate fails even though its reason text still reads well.
export type GateRoute =
  /** The site's own guards read the gate. */
  | { readonly kind: "gate" }
  /** The site hands the event to the component fan-in, whose own guards must read the gate. */
  | { readonly kind: "fan-in" }
  /** The site sends through the session client, which is created only after the gate. */
  | { readonly kind: "session-client" }
  /** The site's function runs only from callers that are themselves emission sites on a gated route. */
  | { readonly kind: "callers"; readonly fn: string }
  /** The site sits in an exported component no production source outside its file refers to. */
  | { readonly kind: "unregistered"; readonly exports: readonly string[] }

export type RoutedSite = Pick<WriterSite, "file" | "fn" | "call"> & { readonly route?: GateRoute }
type SourceFile = { readonly name: string; readonly source: string }

const EMITTERS = new Set(["captureEvent", "capture", "recordDailyActive", "recordSenpiDailyActive"])
/** A guard reads the gate when it calls the gate itself or the component's consent read built on it. */
const GATE_READ = /\bisOmoNativeTelemetryEnabled\(|\bisConsented\b/u
const FAN_IN = { file: "omo-native-component.ts", fn: "createOmoNativeTelemetryComponent>captureEvent", call: "state.capture(name)" }
const SESSION_CLIENT = { file: "omo-native-session.ts", fn: "createOmoNativeSessionComponent>register>captureSessionStart", call: "createEventTelemetryClient(" }

const calleeOf = (call: string): string => call.slice(0, call.indexOf("(")).split(".").at(-1) ?? ""
const routeKey = (site: Pick<WriterSite, "file" | "fn" | "call">): string => `${site.file}: ${site.fn} | ${site.call}`
const gated = (site: WriterSite | undefined): boolean => site !== undefined && GATE_READ.test(site.guard)

export const isEmitterSite = (site: Pick<WriterSite, "call">): boolean => EMITTERS.has(calleeOf(site.call))

/**
 * Every event-emitting site, checked against its declared route. `registrations` are the production
 * sources outside this directory, read only by the `unregistered` route.
 */
export function findGateBypasses(
  files: readonly SourceFile[],
  routed: readonly RoutedSite[],
  registrations: readonly SourceFile[] = [],
): readonly string[] {
  const sites = files.flatMap((file) => scanWriterSites(file.name, file.source))
  const routes = new Map(routed.flatMap((entry) => (entry.route === undefined ? [] : [[routeKey(entry), entry.route] as const])))
  const find = (target: typeof FAN_IN): WriterSite | undefined =>
    sites.find((site) => site.file === target.file && site.fn === target.fn && site.call.startsWith(target.call))

  const passes = (site: WriterSite, seen: ReadonlySet<string>): string | undefined => {
    const route = routes.get(routeKey(site))
    if (route === undefined) return "declares no route to the consent gate"
    switch (route.kind) {
      case "gate":
        return gated(site) ? undefined : "its guards do not read the consent gate"
      case "fan-in":
        return gated(find(FAN_IN)) ? undefined : "the fan-in it relies on does not read the consent gate"
      case "session-client":
        return gated(find(SESSION_CLIENT)) ? undefined : "the session client it relies on is not created behind the consent gate"
      case "callers": {
        const callers = sites.filter((caller) => calleeOf(caller.call) === route.fn && !seen.has(siteKey(caller)))
        if (callers.length === 0) return `no emission site calls ${route.fn}`
        const failing = callers.find((caller) => passes(caller, new Set([...seen, siteKey(site)])) !== undefined)
        return failing === undefined ? undefined : `its caller ${failing.file}: ${siteKey(failing)} bypasses the consent gate`
      }
      case "unregistered": {
        const pattern = new RegExp(`\\b(?:${route.exports.join("|")})\\b`, "u")
        const user = registrations.find((file) => file.name !== site.file && pattern.test(file.source))
        return user === undefined ? undefined : `${user.name} registers it`
      }
    }
  }

  return sites.filter(isEmitterSite).flatMap((site) => {
    const failure = passes(site, new Set())
    return failure === undefined ? [] : [`bypass ${site.file}: ${siteKey(site)} (${failure})`]
  })
}
