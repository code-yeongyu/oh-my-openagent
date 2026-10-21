import { existsSync } from "node:fs"
import { join } from "node:path"

import { canonicalAgentDir, runtimeHome } from "./agent-dir.js"

/**
 * The plain-prose answer to "what is omo actually enforcing on this machine".
 *
 * Ten security controls land as independent PRs, and none of them writes this surface. Every
 * section below is declared once, printed once, and carries the PR that turns its pending marker
 * into live state. A contributor implementing one of those PRs replaces a single `describe` with a
 * reader of the feature's own data source; the heading, the setting line and the ordering stay.
 *
 * The command reads state and never writes it, and it never throws: an unreadable home is reported,
 * not raised, because a diagnostics surface that dies on one bad directory is not a diagnostics
 * surface.
 */

const INDENT = "  "

/** The literal every not-yet-shipped section reports. Cross-PR protocol, so it is a constant. */
export const PENDING_PREFIX = "feature pending: see "

/**
 * One section per security control, in the order a reader meets them: what omo may read, what it
 * sends, what it asks, what it stores, what it installed, and what a contributor must disclose.
 */
export const SECURITY_EXPLAIN_SECTIONS = [
  {
    id: "file-ref-allowlist-roots",
    setting: "security.file_ref_allowlist_roots (default ~/.config/opencode)",
    pr: "PR-A",
    describe: pendingReader("PR-A"),
  },
  {
    id: "telemetry",
    setting: "telemetry.enabled, OMO_SEND_ANONYMOUS_TELEMETRY, OMO_DISABLE_POSTHOG",
    pr: "PR-B",
    describe: pendingReader("PR-B"),
  },
  {
    id: "tool-permission-profile",
    setting: "tools.<name>.permission = allow | ask | deny",
    pr: "PR-C",
    describe: pendingReader("PR-C"),
  },
  {
    id: "server-consent",
    setting: "security.server_consent_opt_out = server | kind | source",
    pr: "PR-D",
    describe: pendingReader("PR-D"),
  },
  {
    id: "auth-at-rest",
    setting: "security.auth_at_rest = plain | passphrase | ssh-key",
    pr: "PR-E",
    describe: pendingReader("PR-E"),
  },
  {
    id: "plugin-payload-sha256",
    setting: "plugin/.omo-payload.sha256 (on disk versus recomputed)",
    pr: "PR-F",
    describe: pendingReader("PR-F"),
  },
  {
    id: "omo-home-mode",
    setting: "~/.omo mode 0700 (migration log line)",
    pr: "PR-H",
    describe: pendingReader("PR-H"),
  },
  {
    id: "ai-assist-disclosure",
    setting: "pull request AI-assisted checkbox",
    pr: "PR-I",
    describe: pendingReader("PR-I"),
  },
]

/**
 * @typedef {{ home: string, env: Readonly<Record<string, string | undefined>>, agentDir: string, omoHome: string }} SecurityExplainContext
 * @typedef {{ id: string, setting: string, pr: string, describe: (context: SecurityExplainContext) => string[] }} SecurityExplainSection
 */

/** A section whose feature is on the roadmap and not in this build. */
function pendingReader(pr) {
  return () => [`${INDENT}${PENDING_PREFIX}${pr}`]
}

function presence(path) {
  return existsSync(path) ? "present" : "absent"
}

function sectionLines(section, context) {
  let body
  try {
    body = section.describe(context)
  } catch (error) {
    // A reader that cannot answer still owes the user a line, and the heading has to stay in place
    // so the section count does not silently shrink.
    body = [`${INDENT}state unavailable: ${error instanceof Error ? error.message : String(error)}`]
  }
  return [section.id, `${INDENT}setting: ${section.setting}`, ...body]
}

/**
 * Prints the effective state of every security control omo ships, as prose lines.
 *
 * @param {{ home?: string, env?: Readonly<Record<string, string | undefined>>, agentDir?: string }} [overrides]
 * @returns {string[]}
 */
export function runSecurityExplain(overrides = {}) {
  const env = overrides.env ?? process.env
  const home = overrides.home ?? runtimeHome(env)
  const agentDir = overrides.agentDir ?? canonicalAgentDir(env, home)
  const omoHome = join(home, ".omo")
  /** @type {SecurityExplainContext} */
  const context = { home, env, agentDir, omoHome }

  const pending = SECURITY_EXPLAIN_SECTIONS.filter((section) => section.describe(context).some((line) => line.includes(PENDING_PREFIX)))

  return [
    "omo security explain",
    `${INDENT}omo home: ${omoHome} (${presence(omoHome)})`,
    `${INDENT}agent dir: ${agentDir} (${presence(agentDir)})`,
    `${INDENT}sections: ${SECURITY_EXPLAIN_SECTIONS.length} (${SECURITY_EXPLAIN_SECTIONS.length - pending.length} live, ${pending.length} pending)`,
    "",
    ...SECURITY_EXPLAIN_SECTIONS.flatMap((section) => [...sectionLines(section, context), ""]),
  ]
}