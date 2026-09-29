import { createHash } from "node:crypto"

export const MESSAGE_LIMIT = 1900

const KIND_ORDER = { blocked: 0, waiting: 1, working: 2, done: 3 }
const ACTIVE_KINDS = new Set(["blocked", "working"])

const LABELS = {
  en: {
    header: (running, blocked) => `🐾 OmOMeow · ${running} running${blocked > 0 ? ` (${blocked} blocked)` : ""}`,
    blocked: "waiting for input",
    waiting: "stopped, waiting",
    done: "done",
    latest: "latest",
    ago: (text) => `${text} ago`,
    more: (count) => `…and ${count} more`,
    minutes: (m) => `${m}m`,
    hours: (h, m) => (m === 0 ? `${h}h` : `${h}h ${m}m`),
  },
  ko: {
    header: (running, blocked) => `🐾 오모냥 · 진행 중 ${running}개${blocked > 0 ? ` (막힘 ${blocked})` : ""}`,
    blocked: "입력 기다리는 중",
    waiting: "멈춰서 기다리는 중",
    done: "끝남",
    latest: "최근",
    ago: (text) => `${text} 전`,
    more: (count) => `…외 ${count}개`,
    minutes: (m) => `${m}분`,
    hours: (h, m) => (m === 0 ? `${h}시간` : `${h}시간 ${m}분`),
  },
}

const ICONS = { blocked: "⚠️", waiting: "💤", working: "🔄", done: "✅" }

/** Parse `herdr tab list` output into the fields the nudge uses. */
export function parseHerdrTabs(output) {
  const parsed = JSON.parse(output)
  const tabs = parsed?.result?.tabs
  if (!Array.isArray(tabs)) throw new Error("herdr tab list returned no result.tabs array")
  return tabs
    .filter((tab) => typeof tab?.tab_id === "string")
    .map((tab) => ({
      tabId: tab.tab_id,
      label: typeof tab.label === "string" && tab.label.length > 0 ? tab.label : tab.tab_id,
      status: typeof tab.agent_status === "string" ? tab.agent_status : "unknown",
      workspaceId: tab.workspace_id ?? null,
    }))
}

/** Remember when each tab was first seen and when its status last changed; drop closed tabs. */
export function trackTabs(previous, tabs, now) {
  const tracked = {}
  for (const tab of tabs) {
    const before = previous?.[tab.tabId]
    if (before === undefined) tracked[tab.tabId] = { firstSeenAt: now, status: tab.status, statusSince: now }
    else if (before.status !== tab.status) tracked[tab.tabId] = { firstSeenAt: before.firstSeenAt, status: tab.status, statusSince: now }
    else tracked[tab.tabId] = before
  }
  return tracked
}

function kindOf(status, mapped) {
  if (status === "blocked") return "blocked"
  if (status === "working") return "working"
  if (!mapped) return null
  if (status === "idle") return "waiting"
  if (status === "done") return "done"
  return null
}

/**
 * One item per tab worth reporting: every working or blocked tab, plus idle/done tabs the skill
 * launched itself (in the session map), since those are tasks someone is waiting on.
 */
export function buildItems({ tabs, tracked, sessions }) {
  const items = []
  for (const tab of tabs) {
    const session = sessions[tab.tabId]
    const kind = kindOf(tab.status, session !== undefined)
    if (kind === null) continue
    const track = tracked[tab.tabId]
    const startedAt = Date.parse(session?.startedAt ?? "") || track?.firstSeenAt || null
    items.push({
      tabId: tab.tabId,
      label: tab.label,
      kind,
      title: session?.title ?? null,
      thread: session?.thread ?? null,
      progress: session?.progress ?? null,
      progressAt: Date.parse(session?.progressAt ?? "") || null,
      startedAt,
      statusSince: track?.statusSince ?? null,
      requester: session?.requester ?? null,
    })
  }
  return items.sort((left, right) => KIND_ORDER[left.kind] - KIND_ORDER[right.kind] || left.label.localeCompare(right.label))
}

export function recipientKey(recipient) {
  return `${recipient.platform}:${recipient.bot ?? ""}:${recipient.target}`
}

/** Elapsed times are left out on purpose: a nudge that differs only by clock time is a repeat. */
export function fingerprintItems(items) {
  const material = items
    .map((item) => [item.tabId, item.kind, item.title ?? "", item.progress ?? ""])
    .sort((left, right) => left[0].localeCompare(right[0]))
  return createHash("sha256").update(JSON.stringify(material)).digest("hex")
}

/**
 * Decide who gets a nudge. A recipient gets one only when at least one of their tasks is working or
 * blocked AND the set of tasks, states, titles, or progress notes differs from their last nudge.
 */
export function planNudge({ items, owner, sent }) {
  const groups = new Map()
  const unroutable = []
  for (const item of items) {
    const recipient = item.requester ?? owner
    if (!recipient) {
      unroutable.push(item.tabId)
      continue
    }
    const key = recipientKey(recipient)
    if (!groups.has(key)) groups.set(key, { key, recipient, items: [] })
    groups.get(key).items.push(item)
  }
  const deliveries = []
  const skipped = []
  for (const group of groups.values()) {
    if (!group.items.some((item) => ACTIVE_KINDS.has(item.kind))) {
      skipped.push({ recipient: group.key, reason: "nothing_running" })
      continue
    }
    const fingerprint = fingerprintItems(group.items)
    if (sent?.[group.key]?.fingerprint === fingerprint) {
      skipped.push({ recipient: group.key, reason: "unchanged" })
      continue
    }
    deliveries.push({ ...group, fingerprint })
  }
  const reason = deliveries.length > 0 ? null : items.some((item) => ACTIVE_KINDS.has(item.kind)) ? "unchanged" : "nothing_running"
  return { deliveries, skipped, unroutable, reason }
}

export function formatDuration(ms, language = "en") {
  const labels = LABELS[language] ?? LABELS.en
  const minutes = Math.max(0, Math.floor(ms / 60000))
  if (minutes < 60) return labels.minutes(minutes)
  return labels.hours(Math.floor(minutes / 60), minutes % 60)
}

function formatItem(item, now, labels, language) {
  const name = item.title ? `${item.label} — ${item.title}` : item.label
  const parts = [`${ICONS[item.kind]} ${name}`]
  if (item.kind === "blocked") {
    const since = item.statusSince === null ? "" : ` ${formatDuration(now - item.statusSince, language)}`
    parts.push(`${labels.blocked}${since}`)
  } else if (item.kind === "waiting") parts.push(labels.waiting)
  else if (item.kind === "done") parts.push(labels.done)
  if (item.startedAt !== null) parts.push(formatDuration(now - item.startedAt, language))
  const lines = [parts.join(" · ")]
  if (item.progress) {
    const age = item.progressAt === null ? "" : ` (${labels.ago(formatDuration(now - item.progressAt, language))})`
    lines.push(`   ${labels.latest}: ${item.progress}${age}`)
  }
  if (item.thread) lines.push(`   ${item.thread}`)
  return lines.join("\n")
}

/** One short overview message; blocked first; cut to the platform-safe length with a count of the rest. */
export function formatNudge(items, { now, language = "en" }) {
  const labels = LABELS[language] ?? LABELS.en
  const running = items.filter((item) => ACTIVE_KINDS.has(item.kind)).length
  const blocked = items.filter((item) => item.kind === "blocked").length
  let text = labels.header(running, blocked)
  for (const [index, item] of items.entries()) {
    const block = formatItem(item, now, labels, language)
    const remaining = items.length - index - 1
    const reserve = remaining > 0 ? labels.more(remaining).length + 1 : 0
    if (text.length + 1 + block.length + reserve > MESSAGE_LIMIT) {
      text += `\n${labels.more(items.length - index)}`
      break
    }
    text += `\n${block}`
  }
  return text
}
