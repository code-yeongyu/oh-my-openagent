import { createHash } from "node:crypto";

export const PER_CALL_CEILING_USD = 0.25;
export const LANE_STATUSES = ["ok", "blocked_auth", "error", "missing_fixture", "skipped_cost_cap"];
export const QUERY_SPLITS = ["calibration", "holdout"];
const SECRET_KEY = /authorization|api[-_]?key|token|secret|cookie|bearer/i;
const STOPWORDS = new Set(["a", "an", "and", "the", "of", "to", "in", "on", "for", "is"]);

export function extractTweetIds(value) {
  const found = [];
  const walk = (v) => {
    if (typeof v === "string") {
      for (const match of v.matchAll(/(?:https?:\/\/[^/\s]+\/[^/\s]+\/status\/|\bstatus\/)(\d+)/gi)) found.push(match[1]);
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(value);
  return [...new Set(found)];
}

const setOf = (v) => new Set(v ?? []);
export function jaccard(a, b) {
  const x = setOf(a), y = setOf(b), union = new Set([...x, ...y]);
  return union.size ? [...x].filter((v) => y.has(v)).length / union.size : 1;
}
export function recall(lane, ref) {
  const x = setOf(lane), y = setOf(ref);
  if (!y.size) return x.size ? 0 : 1;
  if (!x.size) return 0;
  return [...y].filter((v) => x.has(v)).length / y.size;
}
export function aggregate(values) {
  const nums = values.filter((v) => typeof v === "number" && Number.isFinite(v)).sort((a, b) => a - b);
  if (!nums.length) return { mean: null, median: null, n: 0 };
  return { mean: nums.reduce((a, b) => a + b, 0) / nums.length, median: nums.length % 2 ? nums[(nums.length - 1) / 2] : (nums[nums.length / 2 - 1] + nums[nums.length / 2]) / 2, n: nums.length };
}
function canonical(v) {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])]));
  return v;
}
export function fixtureKey(input) { return createHash("sha256").update(JSON.stringify(canonical(input))).digest("hex"); }
export function estimateUsd(ticks) { return typeof ticks === "number" && Number.isFinite(ticks) ? ticks * 1e-10 : "COST_UNKNOWN"; }
export function costGuard({ spentUsd = 0, reservedUsd = 0, capUsd, perCallCeilingUsd = PER_CALL_CEILING_USD }) {
  const canSchedule = Number.isFinite(capUsd) && spentUsd + reservedUsd + perCallCeilingUsd <= capUsd;
  return { canSchedule, reason: canSchedule ? "ok" : "cap_exceeded" };
}
export function reconcileCost(state, ticks) {
  const actual = estimateUsd(ticks);
  if (actual === "COST_UNKNOWN") return { ...state, status: "cap_exceeded" };
  const next = { ...state, spentUsd: (state.spentUsd ?? 0) + actual };
  return next.spentUsd > state.capUsd ? { ...next, status: "cap_exceeded" } : next;
}
export function redactSecrets(value, sentinel) {
  if (Array.isArray(value)) return value.map((v) => redactSecrets(v, sentinel));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, SECRET_KEY.test(k) ? "<redacted>" : redactSecrets(v, sentinel)]));
  return typeof value === "string" && sentinel ? value.split(sentinel).join("<redacted>") : value;
}
function words(v) { return new Set(v.normalize("NFKC").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((x) => x && !STOPWORDS.has(x))); }
export function webOverlap(text, terms) { return jaccard(words(text), words(terms.join(" "))); }
export function validateQuerySet(json) {
  const queries = Array.isArray(json) ? json : json?.queries;
  if (!Array.isArray(queries)) return false;
  const ids = new Set();
  return queries.every((q) => q && typeof q.id === "string" && !ids.has(q.id) && ids.add(q.id) && QUERY_SPLITS.includes(q.split) && Number.isInteger(q.since_days_ago) && q.since_days_ago >= 1 && q.since_days_ago <= 30 && (q.until_days_ago === undefined || Number.isInteger(q.until_days_ago) && q.until_days_ago < q.since_days_ago) && Array.isArray(q.web_terms) && q.web_terms.length > 0);
}
export function materializeDates(query, runDate) {
  const base = new Date(`${runDate}T00:00:00Z`);
  const fmt = (d) => d.toISOString().slice(0, 10);
  const since = new Date(base); since.setUTCDate(since.getUTCDate() - query.since_days_ago);
  const to = new Date(base); to.setUTCDate(to.getUTCDate() - (query.until_days_ago ?? 0));
  return { since: fmt(since), to_date: fmt(to) };
}
