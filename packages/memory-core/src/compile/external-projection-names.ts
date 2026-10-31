import { redactSecretLikeMaterial } from "../sync/redact"

/** One file (or, after a directory merge, one name shared by `files` files) and its newest commit time. */
export interface NamedFile {
  readonly name: string
  readonly time: number
  readonly files: number
}

/** One listed entry of a directory line: a name, a date group, or a pattern standing for hint-free names. */
export interface ProjectionItem {
  readonly text: string
  /** Files the entry stands for. */
  readonly files: number
  /** Newest commit time among those files; items are listed newest first. */
  readonly time: number
}

/** How a listed name maps back to its file; the block opens with it when nothing is folded or grouped. */
export const NAME_NOTE = "Names drop \".md\" (a quoted name is exact)."

/** How a listed entry maps back to its file; the block opens with it when a line folds or groups names. */
export const NAME_LEGEND =
  "Names drop \".md\" (a quoted name is exact); {a, b}-20261027 is a-20261027 and b-20261027; "
  + "\"x … y (N files)\" and <id> stand for similar names: read the directory to list them."

const MARKDOWN = ".md"
const DATE = /^(?:19|20)\d{6}$/
const YEAR = /^(?:19|20)\d{2}$/
const MONTH = /^(?:0[1-9]|1[0-2])$/
// A token after a date that names no topic: a clock time with an optional real zone (0930, 093015z, 0330KST),
// a one- or two-digit sequence number, or a part (p3). Any other number (a ticket, a PR, an HTTP code) or a
// clock time with a word after it (1200fix) is the hint and keeps the name listed.
const HINT_FREE = /^(?:(?:[01]\d|2[0-3])[0-5]\d(?:[0-5]\d)?(?:z|utc|gmt|kst|jst|pst|pdt|est|edt|cet|cest|bst|ist)?|\d{1,2}|p\d+)$/i
const DATE_SUFFIX = /^(.+)-((?:19|20)\d{6})$/
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
const HEX_DIGEST = /^(?:[0-9a-f]{16,}|[0-9A-F]{16,})$/
// A digest flips between letters and digits often; a hex-letter word with a year (deadbeefcafe2026) flips once.
const MIN_HEX_FLIPS = 4
const MIXED_CASE_TOKEN = /^(?=.*[a-z])(?=.*[A-Z])[A-Za-z0-9]{12,}$/
const WORDS = /[A-Z]+(?=[A-Z][a-z])|[A-Z]?[a-z]+|[A-Z]+|\d+/g
const VOWEL = /[aeiouy]/i
// The most frequent English letter pairs; the words of a random token are mostly made of other pairs.
const COMMON_PAIRS: ReadonlySet<string> = new Set((
  "th he in er an re on at en nd ti es or te of ed is it al ar st to nt ng se ha as ou io le ve co "
  + "me de hi ri ro ic ne ea ra ce li ch ll be ma si om ur ca el ta la ns di fo ho pe ec pr no ct us "
  + "ac ot il tr ly nc et ut ss so rs un lo wa ge ie wh ee wi em ad ol rt po we na ul ni ts mo ow pa "
  + "im mi ai sh ir su id os iv ia am fi ci vi pl ig tu ev ld ry mp fe bl ab gh ty op wo sa ay ex ke "
  + "fr oo av ag if ap gr od bo sp rd do uc bu ei ov by rm ep tt oc fa ef cu rn sc gi da yo cr cl du "
  + "ga qu ue ff ba ey ls va um pp ua up lu go ht ru ug ds lt pi rc rr eg au ck ew mu br bi pt ak pu "
  + "ui rg ib tl ny ki rk ys ob mm fu ph og ms ye ud mb ip ub oi rl gu dr hr cc tw ft wn nu af hu nn "
  + "eo vo rv nf xp gn sm fl iz ok nl my gl aw sy oa"
).split(" "))
// Each bar is met by most random base62 tokens; the most id-like of 13,995 real identifiers misses one by 0.05 or more.
const MIN_NOISE = 0.25
const MIN_RARE_PAIRS = 0.3
const MIN_WORD_DENSITY = 0.4
const MIN_RUN = 3
const ID = "<id>"
const naturally = (a: string, b: string): number => a.localeCompare(b, "en", { numeric: true })
const newestFirst = (a: ProjectionItem, b: ProjectionItem): number => {
  const delta = b.time - a.time
  return delta !== 0 && !Number.isNaN(delta) ? delta : a.text.localeCompare(b.text)
}

/**
 * The names in `names` that are unmistakably machine ids, each judged on its own: a sibling never pulls a name in.
 * When unsure a name is shown, since the name is the hint.
 */
export function generatedIds(names: readonly string[]): ReadonlySet<string> {
  return new Set(names.filter((name) => UUID.test(name) || isHexDigest(name) || readsAsRandom(name)))
}

function isHexDigest(name: string): boolean {
  if (!HEX_DIGEST.test(name)) return false
  let flips = 0
  for (let index = 1; index < name.length; index++) {
    if (/\d/.test(name[index] ?? "") !== /\d/.test(name[index - 1] ?? "")) flips++
  }
  return flips >= MIN_HEX_FLIPS
}

/**
 * A mixed-case base62 token of 12+ characters that reads as random by all three measures of its camel-case words:
 * noise marks (a lone letter, a one- or two-digit chunk, a word with no vowel: two marks from four letters up) per
 * character, the share of uncommon letter pairs inside words, and words per character.
 */
function readsAsRandom(name: string): boolean {
  if (!MIXED_CASE_TOKEN.test(name)) return false
  const words = name.match(WORDS) ?? []
  let marks = 0
  let pairs = 0
  let rare = 0
  for (const word of words) {
    if (/^\d+$/.test(word)) {
      marks += word.length <= 2 ? 1 : 0
      continue
    }
    if (word.length === 1) marks += 1
    else if (!VOWEL.test(word)) marks += word.length >= 4 ? 2 : 1
    const lower = word.toLowerCase()
    for (let index = 1; index < lower.length; index++) {
      pairs++
      if (!COMMON_PAIRS.has(lower.slice(index - 1, index + 1))) rare++
    }
  }
  return marks / name.length >= MIN_NOISE && pairs > 0 && rare / pairs >= MIN_RARE_PAIRS && words.length / name.length >= MIN_WORD_DENSITY
}

/** `a.md` lists as `a`; any other file keeps its exact name in quotes. Secret-like text is masked first. */
function displayName(name: string): string {
  const safe = redactSecretLikeMaterial(name)
  return safe.endsWith(MARKDOWN) ? safe.slice(0, -MARKDOWN.length) : `"${safe}"`
}

/**
 * One directory's files as listed items, newest first. Hint-free runs (a shared prefix plus only a date, month chunk,
 * clock time or part; or generated ids) of at least three fold into one pattern when that is shorter than the list.
 * The other markdown names sharing a `-YYYYMMDD` suffix are grouped as `{a, b}-YYYYMMDD`.
 */
export function directoryItems(files: readonly NamedFile[]): ProjectionItem[] {
  const merged = mergeByName(files)
  const ids = generatedIds(merged.filter(isMarkdown).map((file) => stem(file.name)))
  const runs = new Map<string, NamedFile[]>()
  const plain: NamedFile[] = []
  for (const file of merged) {
    const key = runKey(file.name, ids)
    const run = key === undefined ? undefined : runs.get(key)
    if (key === undefined) plain.push(file)
    else if (run) run.push(file)
    else runs.set(key, [file])
  }
  const items: ProjectionItem[] = []
  for (const [key, members] of runs) {
    const folded = foldRun(key, members)
    if (folded) items.push(folded)
    else plain.push(...members)
  }
  items.push(...dateGroups(plain))
  return items.sort(newestFirst)
}

function mergeByName(files: readonly NamedFile[]): NamedFile[] {
  const byName = new Map<string, NamedFile>()
  for (const file of files) {
    const name = redactSecretLikeMaterial(file.name)
    const seen = byName.get(name)
    byName.set(name, seen
      ? { name, time: Math.max(seen.time, file.time), files: seen.files + file.files }
      : { ...file, name })
  }
  return [...byName.values()]
}

const isMarkdown = (file: NamedFile): boolean => file.name.endsWith(MARKDOWN)
const stem = (name: string): string => name.slice(0, -MARKDOWN.length)
const item = (file: NamedFile): ProjectionItem => ({ text: displayName(file.name), files: file.files, time: file.time })
const newest = (files: readonly { readonly time: number }[]): number => Math.max(...files.map((file) => file.time))
const count = (files: readonly { readonly files: number }[]): number => files.reduce((sum, file) => sum + file.files, 0)

/** What a hint-free name shares with its run (`<id>`, or the words before its date), or `undefined` for a hinted name. */
function runKey(name: string, ids: ReadonlySet<string>): string | undefined {
  if (!name.endsWith(MARKDOWN)) return undefined
  if (ids.has(stem(name))) return ID
  const tokens = stem(name).split("-")
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index] ?? ""
    const dateLength = DATE.test(token) ? 1 : YEAR.test(token) && MONTH.test(tokens[index + 1] ?? "") ? 2 : 0
    if (dateLength === 0) continue
    const tail = tokens.slice(index + dateLength)
    if (!tail.every((part) => HINT_FREE.test(part) || DATE.test(part))) return undefined
    return `${tokens.slice(0, index).join("-")}-`
  }
  return undefined
}

function foldRun(key: string, members: readonly NamedFile[]): ProjectionItem | undefined {
  if (members.length < MIN_RUN) return undefined
  const files = count(members)
  const names = members.map((member) => displayName(member.name)).sort(naturally)
  const text = key === ID ? `${ID} (${files} files)` : `${names[0]} … ${names[names.length - 1]} (${files} files)`
  const listed = Buffer.byteLength(names.join(", "))
  return Buffer.byteLength(text) < listed ? { text, files, time: newest(members) } : undefined
}

function dateGroups(files: readonly NamedFile[]): ProjectionItem[] {
  const groups = new Map<string, NamedFile[]>()
  const items: ProjectionItem[] = []
  for (const file of files) {
    const match = isMarkdown(file) && !/[{}]|, /.test(file.name) ? DATE_SUFFIX.exec(stem(file.name)) : null
    const date = match?.[2]
    if (date === undefined) {
      items.push(item(file))
      continue
    }
    const group = groups.get(date)
    if (group) group.push(file)
    else groups.set(date, [file])
  }
  for (const [date, members] of groups) {
    if (members.length < 2) {
      items.push(...members.map(item))
      continue
    }
    const listed = members.map(item).sort(newestFirst).map((entry) => entry.text.slice(0, -date.length - 1))
    items.push({ text: `{${listed.join(", ")}}-${date}`, files: count(members), time: newest(members) })
  }
  return items
}
