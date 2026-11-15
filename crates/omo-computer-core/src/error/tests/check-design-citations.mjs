// Checks design-reasons.tsv and design-exclusions.tsv against the pinned design.
//
//   bun crates/omo-computer-core/src/error/tests/check-design-citations.mjs --pin <design-pin dir> [--forms]
//
// 1. Every cited `file:line` exists (design/... and waves/... under the pin, crates/... under the
//    repository), its sha256 equals the recorded one, and the line contains the cited token.
//    An `interpretation:I-<n>` source claims no design line and carries sha256 `-`.
// 2. The pin is swept for every `Name{...}` refusal form (the 33 engine codes, the names the
//    interpretations map onto them, the layer failures, `refused{...}` and `COMPUTER_*{...}`);
//    every (name, token) it finds must be an inventory pair or an exclusion, and every exclusion
//    must still be found. An exclusion may not name a token the pin emits as a reason under that
//    name (a `reason:"<token>"` value or a `refused{<token>}`) unless its why says
//    `replaced by Code{reason}` (or a bare `Code`) and that pair is an inventory pair: a withdrawn
//    spelling the pin still quotes. Exit 1 names each failure.

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs"
import { join, dirname, relative } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, "../../../../..")
const args = process.argv.slice(2)
const pin = args[args.indexOf("--pin") + 1]
if (!args.includes("--pin") || !pin || !existsSync(pin)) {
  console.error("usage: check-design-citations.mjs --pin <design-pin dir> [--forms]")
  process.exit(2)
}

const CODES =
  "PermissionDenied CaptureFailed InputFailed BackgroundUnavailable WindowNotFound InvalidTarget InvalidKey InvalidCoordinateFrame StaleRef AxUnsupported AxFailed Timeout Closed Internal StopPathUnavailable Suspended ScreenLocked Cancelled CursorRestoreFailed FocusRestoreFailed TransactionFailed InputBusy ControlRequired CaptureUnavailable UserIntervened AxUnconfirmed SpaceUnsupported SpaceMoveDenied AmbiguousTarget CaptureConsentRequired ProtectedProcess SessionInactive ConsequentialAction".split(
    " ",
  )
const LAYERS =
  "PermissionRuleDenied MethodNotFound MalformedMessage MalformedReport HandCrashed HandOffline LinkDegraded TransportLost RemoteCommandsDisabled EntitlementRequired ProtocolMismatch FeatureUnavailable HandOutdated UnsupportedAction SafetyCheckDeclined Disabled SecureFocus LaunchContextRequired RunLimit RunFailed InvalidArguments".split(
    " ",
  )
// Names outside the closed 33, and the (code, reason) the interpretations key them under.
const PARENT = {
  SelfTarget: "ProtectedProcess",
  PresenceUnavailable: "ControlRequired",
  WindowImmovable: "InvalidTarget",
  WindowFrameUnavailable: "InvalidTarget",
  Unavailable: "Internal",
  AxUnavailable: "AxUnsupported",
  EngineCrashed: "HandCrashed",
  AbiMismatch: "ProtocolMismatch",
}
const BARE = {
  SelfTarget: "self_target",
  PresenceUnavailable: "no_presence_surface",
  WindowImmovable: "window_immovable",
  WindowFrameUnavailable: "window_frame_unavailable",
  EngineCrashed: "engine_exited",
  AbiMismatch: "abi_mismatch",
  AxUnavailable: "-",
}
const REFUSED = { secure_focus: ["SecureFocus", "-"] }

const sha = (text) => new Bun.CryptoHasher("sha256").update(text).digest("hex")
const tsv = (name) =>
  readFileSync(join(here, name), "utf8")
    .split("\n")
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) => line && !line.startsWith("#"))
    .slice(1)
    .map(({ line, number }) => ({ cells: line.split("\t"), number }))

function citedLine(source) {
  const match = /^((?:design|waves|crates)\/[^:]+):(\d+)$/.exec(source)
  if (!match) return { problem: `source ${source} is neither file:line nor interpretation:I-<n>` }
  const root = match[1].startsWith("crates/") ? repo : pin
  const path = join(root, match[1])
  if (!existsSync(path)) return { problem: `${match[1]} does not exist` }
  const text = readFileSync(path, "utf8").split("\n")[Number(match[2]) - 1]
  return text === undefined ? { problem: `${source} is past the end of the file` } : { text }
}

function checkCitation(where, source, recorded, token) {
  const interpretation = /^interpretation:I-(\d+)$/.exec(source)
  if (interpretation) {
    const n = Number(interpretation[1])
    return n >= 1 && n <= 20 && recorded === "-" ? [] : [`${where}: ${source} must be I-1..I-20 with sha256 "-"`]
  }
  const { problem, text } = citedLine(source)
  if (problem) return [`${where}: ${problem}`]
  const found = []
  if (sha(text) !== recorded)
    found.push(`${where}: ${source} sha256 ${sha(text)} differs from the recorded ${recorded}`)
  if (!text.includes(token)) found.push(`${where}: ${source} does not contain ${token}`)
  return found
}

const failures = []
const inventory = tsv("design-reasons.tsv").map(({ cells, number }) => {
  const [refusal, kind, code, reason, computer, source, recorded] = cells
  failures.push(
    ...checkCitation(`design-reasons.tsv:${number} ${refusal}`, source, recorded, reason === "-" ? code : reason),
  )
  return { code, reason, computer }
})
const exclusions = tsv("design-exclusions.tsv").map(({ cells, number }) => {
  const [name, token, source, recorded, why] = cells
  if (!why) failures.push(`design-exclusions.tsv:${number}: no reason given`)
  failures.push(
    ...checkCitation(
      `design-exclusions.tsv:${number} ${name}{${token}}`,
      source,
      recorded,
      token === "<bare>" ? name : token,
    ),
  )
  return { key: `${name}\t${token}`, why: why ?? "" }
})

const pairs = new Set(inventory.map(({ code, reason }) => `${code}\t${reason}`))
const reasons = new Set(inventory.map(({ reason }) => reason))
const byComputer = new Set(inventory.map(({ computer, reason }) => `${computer}\t${reason}`))
function covered(name, token) {
  const reason = token === "<bare>" ? "-" : token
  if (name === "refused") return REFUSED[token] ? pairs.has(REFUSED[token].join("\t")) : reasons.has(token)
  if (name.startsWith("COMPUTER_")) return byComputer.has(`${name}\t${reason}`)
  if (PARENT[name]) return pairs.has(`${PARENT[name]}\t${token === "<bare>" ? (BARE[name] ?? "<none>") : reason}`)
  return pairs.has(`${name}\t${reason}`)
}

const names = [...CODES, ...LAYERS, ...Object.keys(PARENT), "refused"]
const form = new RegExp(`(?<![A-Za-z0-9_.])(${names.join("|")}|COMPUTER_[A-Z_]+)\\{([^{}]{0,400})\\}`, "g")
const files = []
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    statSync(path).isDirectory() ? walk(path) : path.endsWith(".md") && files.push(path)
  }
}
walk(pin)
const candidates = new Map()
// (name, token) pairs the pin writes as an emitted reason, not as a bare member.
const emitted = new Set()
const otherForms = new Map()
for (const path of files.sort()) {
  readFileSync(path, "utf8")
    .split("\n")
    .forEach((line, index) => {
      for (const match of line.matchAll(/(?<![A-Za-z0-9_])([A-Za-z_][A-Za-z0-9_.]*)\{/g)) {
        if (!names.includes(match[1]) && !match[1].startsWith("COMPUTER_"))
          otherForms.set(match[1], (otherForms.get(match[1]) ?? 0) + 1)
      }
      for (const match of line.matchAll(form)) {
        const tokens = new Set()
        for (const reason of match[2].matchAll(/reason\s*:\s*((?:"[^"]+"\s*\|?\s*)+)/g)) {
          for (const value of reason[1].matchAll(/"([^"]+)"/g)) {
            tokens.add(value[1])
            emitted.add(`${match[1]}\t${value[1]}`)
          }
        }
        const bare = match[2].replace(/[a-zA-Z_]+\s*:\s*(\{[^}]*\}|\[[^\]]*\]|"[^"]*"(\s*\|\s*"[^"]*")*|[^,}]*)/g, " ")
        for (const word of bare.split(/[\s,|/()]+/))
          if (/^[a-z][a-z0-9_-]*$/.test(word) || /^[A-Z][A-Z0-9_]+$/.test(word)) tokens.add(word)
        if (match[1] === "refused") for (const token of tokens) emitted.add(`refused\t${token}`)
        if (tokens.size === 0) tokens.add("<bare>")
        for (const token of tokens) {
          const key = `${match[1]}\t${token}`
          if (!candidates.has(key)) candidates.set(key, `${relative(pin, path)}:${index + 1}`)
        }
      }
    })
}
const excluded = new Set(exclusions.map(({ key }) => key))
const replacedBy = (why) => {
  const match = /replaced by ([A-Za-z]+)(?:\{([^}]+)\})?/.exec(why)
  return match ? pairs.has(`${match[1]}\t${match[2] ?? "-"}`) : false
}
for (const [key, first] of candidates) {
  const [name, token] = key.split("\t")
  if (!covered(name, token) && !excluded.has(key))
    failures.push(
      `unclassified design candidate ${name}{${token}} (first at ${first}): neither an inventory pair nor an exclusion`,
    )
}
for (const { key, why } of exclusions)
  if (emitted.has(key) && !replacedBy(why))
    failures.push(`exclusion ${key.replace("\t", "{")}} names a reason the pin emits: it needs a row, not an exclusion`)
for (const key of excluded)
  if (!candidates.has(key)) failures.push(`stale exclusion ${key.replace("\t", "{")}}: the pin no longer writes it`)

console.log(
  `pin: ${files.length} files; ${candidates.size} refusal candidates swept; ${inventory.length} inventory pairs; ${exclusions.length} exclusions`,
)
if (args.includes("--forms"))
  console.log(
    `other Name{ forms (not refusal forms, not checked): ${[...otherForms]
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => `${name}:${count}`)
      .join(" ")}`,
  )
for (const failure of failures) console.log(`FAIL ${failure}`)
console.log(failures.length === 0 ? "CITATIONS_OK" : `${failures.length} failures`)
process.exit(failures.length === 0 ? 0 : 1)
