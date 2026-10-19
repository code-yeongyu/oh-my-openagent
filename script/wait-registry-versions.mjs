#!/usr/bin/env node
// Waits until every named package serves EXACTLY its version from the npm registry, read with no-cache
// so a cached 404 cannot hide a landed version, and fails once ONE shared deadline (probe time counted) passes.
// npm answers a publish with 202 "being processed": 5.1.38's oh-my-openagent printed
// "+ oh-my-openagent@5.1.38" at 10:09Z and was served only from 10:34Z, while the old check waited on
// omo-ai alone. Every published package is read back, all in one polling window.

const PROBE_TIMEOUT_MS = 15_000

/** Splits "name@version" (a scoped "@scope/name@version" too). */
export function parseSpec(spec) {
  const at = spec.lastIndexOf("@")
  if (at <= 0) throw new Error(`expected <name>@<version>, got "${spec}"`)
  return { name: spec.slice(0, at), version: spec.slice(at + 1) }
}

/** Returns the specs not yet served at their exact version, each with why. */
export async function pendingSpecs(specs, fetchImpl = fetch) {
  const pending = []
  for (const spec of specs) {
    const { name, version } = parseSpec(spec)
    const url = `https://registry.npmjs.org/${name}/${encodeURIComponent(version)}`
    let reason
    try {
      const response = await fetchImpl(url, {
        headers: { "Cache-Control": "no-cache", Accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      })
      if (response.status !== 200) reason = `HTTP ${response.status}`
      else {
        const served = (await response.json()).version
        if (served !== version) reason = `serves ${served ?? "no version"}`
      }
    } catch (error) {
      reason = `probe failed: ${error instanceof Error ? error.message : String(error)}`
    }
    if (reason !== undefined) pending.push({ spec, reason })
  }
  return pending
}

export async function waitForRegistryVersions({ specs, deadlineMs, delayMs, fetchImpl = fetch, now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), log = console.log }) {
  // ONE deadline shared by every package, probe time included: the step can never outrun it by more
  // than one probe round, so a missing package fails with its name instead of a job timeout.
  const start = now()
  let pending = specs.map((spec) => ({ spec, reason: "not probed" }))
  for (let round = 1; ; round++) {
    pending = await pendingSpecs(pending.map((p) => p.spec), fetchImpl)
    const elapsed = now() - start
    if (pending.length === 0) {
      log(`all ${specs.length} packages are served at their exact versions (round ${round}, ${Math.round(elapsed / 1000)} s)`)
      return { ok: true, pending: [] }
    }
    const remaining = deadlineMs - elapsed
    log(`waiting for ${pending.length} package(s) (round ${round}, ${Math.max(0, Math.round(remaining / 1000))} s left): ${pending.map((p) => `${p.spec} (${p.reason})`).join(", ")}`)
    if (remaining <= 0) return { ok: false, pending }
    await sleep(Math.min(delayMs, remaining))
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const specs = process.argv.slice(2)
  if (specs.length === 0) {
    console.error("usage: node script/wait-registry-versions.mjs <name@version...>")
    process.exit(2)
  }
  const deadlineMs = Number(process.env.REGISTRY_WAIT_DEADLINE_SECONDS ?? 3600) * 1000
  const delayMs = Number(process.env.REGISTRY_WAIT_DELAY_SECONDS ?? 15) * 1000
  const result = await waitForRegistryVersions({ specs, deadlineMs, delayMs })
  if (!result.ok) {
    console.log(`::error::npm never served: ${result.pending.map((p) => `${p.spec} (${p.reason})`).join(", ")}. publish printed success for each, so npm accepted and then dropped or held them; check https://www.npmjs.com/package/<name> before re-running.`)
    process.exit(1)
  }
}
