import { createHash } from "node:crypto"

const BATCH_SIZE = 25
const REMARKS_REFRESH_MS = 30 * 60_000

export function parsePullRequest(value) {
  const match = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)#([1-9]\d*)$/.exec(value)
  if (match === null || !Number.isSafeInteger(Number(match[3]))) {
    throw new Error(`Expected owner/repo#number, got ${value}`)
  }
  return { owner: match[1], repo: match[2], number: Number(match[3]), key: value }
}

export function buildBatches(keys) {
  const refs = [...new Set(keys)].map(parsePullRequest)
  const batches = []
  for (let offset = 0; offset < refs.length; offset += BATCH_SIZE) {
    const batch = refs.slice(offset, offset + BATCH_SIZE)
    const fields = batch.map(({ owner, repo, number }, index) => `pr${index}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(repo)}) {
      pullRequest(number: ${number}) {
        url state isDraft mergeable headRefOid baseRefOid
        commits(last: 1) { nodes { commit { statusCheckRollup {
          state contexts { totalCount checkRunCountsByState { state count } statusContextCountsByState { state count } }
        } } } }
        comments(last: 1) { totalCount nodes { id updatedAt } }
        reviews(last: 1) { totalCount nodes { id submittedAt updatedAt state } }
        reviewThreads(last: 10) { totalCount nodes { id isResolved comments(last: 1) { totalCount nodes { id updatedAt } } } }
      }
    }`).join("\n")
    batches.push({ refs: batch, query: `query { rateLimit { cost remaining resetAt } ${fields} }` })
  }
  return batches
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

function hasRunningChecks(rollup) {
  const contexts = rollup?.contexts
  return contexts?.checkRunCountsByState?.some(({ state, count }) => count > 0 && ["QUEUED", "IN_PROGRESS", "PENDING", "WAITING"].includes(state)) === true
    || contexts?.statusContextCountsByState?.some(({ state, count }) => count > 0 && state === "PENDING") === true
    || rollup?.state === "PENDING"
}

/** A missing row never means unchanged. Detail reads, not fingerprints, own readiness. */
export function decodeBatch(batch, response, previous = {}, now = Date.now()) {
  const errors = response.errors ?? []
  const rateLimited = errors.some(({ type, message = "" }) => type === "RATE_LIMITED" || /rate limit/i.test(message))
  const rows = batch.refs.map((ref, index) => {
    const pr = response.data?.[`pr${index}`]?.pullRequest
    if (rateLimited) return { key: ref.key, result: "rate_limited", refreshStatus: false, refreshRemarks: false }
    if (pr === null || pr === undefined || typeof pr.state !== "string" || typeof pr.headRefOid !== "string"
      || pr.comments == null || pr.reviews == null || pr.reviewThreads == null
      || errors.some(({ path }) => path?.[0] === `pr${index}`)) {
      return { key: ref.key, result: "unreadable", refreshStatus: true, refreshRemarks: true }
    }
    const rollup = pr.commits?.nodes?.[0]?.commit?.statusCheckRollup ?? null
    const statusFingerprint = digest([pr.state, pr.isDraft, pr.mergeable, pr.headRefOid, pr.baseRefOid, rollup])
    const remarksFingerprint = digest([pr.comments, pr.reviews, pr.reviewThreads])
    const old = previous[ref.key]
    const lastRemarksReadAt = old?.lastRemarksReadAt
    const forcedRemarks = !Number.isFinite(lastRemarksReadAt) || lastRemarksReadAt > now || now - lastRemarksReadAt >= REMARKS_REFRESH_MS
    return {
      key: ref.key, url: pr.url, state: pr.state, result: "ok", statusFingerprint, remarksFingerprint,
      checksRunning: hasRunningChecks(rollup),
      refreshStatus: old?.statusFingerprint !== statusFingerprint || hasRunningChecks(rollup),
      refreshRemarks: old?.remarksFingerprint !== remarksFingerprint || forcedRemarks,
      // Only the caller can acknowledge that downstream activity was actually read.
      lastRemarksReadAt: lastRemarksReadAt ?? null,
    }
  })
  return { rateLimit: response.data?.rateLimit ?? null, errors, rows }
}

