/**
 * Resolves a connected browser's display identity from daemon data and report context.
 * When the daemon reports a Chromium-generic product name (e.g. "chrome"), this helper
 * inspects user agent signals, detected browser profiles, primary identification,
 * and candidates to properly identify Vivaldi (and other derivative browsers)
 * while preserving raw daemon product provenance (#10407).
 */
export function resolveConnectedBrowser(browser, report = {}) {
  const rawName = browser.browser_name || browser.name || "unknown"
  const rawVersion = browser.browser_version || browser.version || ""
  const daemonProduct = `${rawName} ${rawVersion}`.trim()

  const ua = String(browser.user_agent || browser.userAgent || "").toLowerCase()
  const vivaldiUaMatch = ua.match(/vivaldi\/([\d.]+)/i)
  if (vivaldiUaMatch) {
    return {
      instanceId: browser.instance_id || browser.instanceId,
      name: "vivaldi",
      version: vivaldiUaMatch[1] || rawVersion,
      daemonProduct,
    }
  }

  const explicitId = String(browser.id || browser.app_name || browser.appName || "").toLowerCase()
  if (explicitId.includes("vivaldi")) {
    return {
      instanceId: browser.instance_id || browser.instanceId,
      name: "vivaldi",
      version: rawVersion,
      daemonProduct,
    }
  }

  if (rawName === "chrome") {
    const isPrimaryVivaldi = report.primary?.id === "vivaldi"
    const hasVivaldiRegistered = Array.isArray(report.browsers) && report.browsers.some((b) => b.id === "vivaldi" && b.extensionRegistered)
    const hasVivaldiCandidate = Array.isArray(report.identification?.candidates) && report.identification.candidates.some((c) => c.id === "vivaldi")
    const isDefaultVivaldi = report.identification?.defaultBrowser === "vivaldi"

    if (isPrimaryVivaldi || (hasVivaldiRegistered && (hasVivaldiCandidate || isDefaultVivaldi))) {
      return {
        instanceId: browser.instance_id || browser.instanceId,
        name: "vivaldi",
        version: rawVersion,
        daemonProduct,
      }
    }
  }

  return {
    instanceId: browser.instance_id || browser.instanceId,
    name: rawName,
    version: rawVersion,
    daemonProduct,
  }
}
