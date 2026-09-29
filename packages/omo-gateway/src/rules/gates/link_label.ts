import { defaultGithubTitles, type GithubTitleResolver } from "./github-titles"
import { rewriteTexts } from "./text"
import { OK, type OutboundGate } from "./types"

// Tokens the body renderer (src/adapter/rich.ts) turns into links, mentions and channels. A URL
// outside them renders as raw text, which this gate never lets through.
const TOKEN_RE = /<(https?:\/\/[^\s|<>]+)(?:\|([^<>]*))?>|<[@#][^\s|<>]+(?:\|[^<>]*)?>/g
const BARE_URL_RE = /\bhttps?:\/\/[^\s<>|]+/gi
const GITHUB_REF_RE = /^https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/(?:issues|pull)\/(\d+)(?:[/?#]\S*)?$/i
const TRAILING_PUNCT = /[.,;:!?'"]$/
const MAX_TITLE = 80

class UnlabeledUrl extends Error {}

function trimUrl(raw: string): string {
  let url = raw
  for (;;) {
    if (TRAILING_PUNCT.test(url)) url = url.slice(0, -1)
    else if (url.endsWith(")") && count(url, "(") < count(url, ")")) url = url.slice(0, -1)
    else if (url.endsWith("]") && count(url, "[") < count(url, "]")) url = url.slice(0, -1)
    else return url
  }
}

function count(text: string, char: string): number {
  return text.split(char).length - 1
}

function githubRef(url: string): { owner: string; repo: string; number: number } | null {
  const match = GITHUB_REF_RE.exec(url)
  if (match === null) return null
  const [, owner, repo, number] = match
  if (owner === undefined || repo === undefined || number === undefined) return null
  return { owner, repo, number: Number(number) }
}

function cleanTitle(title: string): string {
  const flat = title.replace(/\s+/g, " ").replace(/</g, "\u2039").replace(/>/g, "\u203A").trim()
  return flat.length > MAX_TITLE ? `${flat.slice(0, MAX_TITLE - 3)}...` : flat
}

async function labeledGithub(url: string, github: GithubTitleResolver): Promise<string> {
  const ref = githubRef(url)
  if (ref === null) throw new UnlabeledUrl(url)
  let title: string
  try {
    title = await github.title(ref.owner, ref.repo, ref.number)
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error)
    throw new Error(`cannot label ${url}: the GitHub title lookup failed (${why}); write <${url}|label> yourself`)
  }
  return `<${url}|${ref.repo} #${ref.number} ${cleanTitle(title)}>`
}

function needsLabel(url: string, label: string | undefined): boolean {
  const shown = label?.trim() ?? ""
  if (shown === "" || shown === url || /^https?:\/\//i.test(shown)) return true
  const ref = githubRef(url)
  return ref !== null && !shown.includes(`#${ref.number}`)
}

async function relabel(text: string, github: GithubTitleResolver): Promise<string> {
  let out = ""
  let last = 0
  for (const token of text.matchAll(TOKEN_RE)) {
    out += await relabelBare(text.slice(last, token.index), github)
    const [whole, url, label] = token
    out += url !== undefined && needsLabel(url, label) ? await labeledGithub(url, github) : whole
    last = token.index + whole.length
  }
  return out + (await relabelBare(text.slice(last), github))
}

async function relabelBare(segment: string, github: GithubTitleResolver): Promise<string> {
  let out = ""
  let last = 0
  for (const match of segment.matchAll(BARE_URL_RE)) {
    const url = trimUrl(match[0])
    out += segment.slice(last, match.index) + (await labeledGithub(url, github))
    last = match.index + url.length
  }
  return out + segment.slice(last)
}

export const gate: OutboundGate = {
  id: "link_label",
  phase: "outbound",
  async run(intent, _params, ctx) {
    const github = ctx.github ?? defaultGithubTitles()
    try {
      const repaired = await rewriteTexts(intent, (text) => relabel(text, github))
      return repaired === null ? OK : { repair: repaired, note: "labeled GitHub links with repo, number and title" }
    } catch (error) {
      if (error instanceof UnlabeledUrl) return { refuse: `links need a label: write <${error.message}|label> instead of the bare URL` }
      return { refuse: error instanceof Error ? error.message : String(error) }
    }
  },
}
