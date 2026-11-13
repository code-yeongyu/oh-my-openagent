import { GITHUB_REPOSITORY } from "./github"

/** The desktop app's report body is at most ~7000 URL characters; these caps leave room and stop abuse. */
export const SUPPORT_TITLE_MAX = 200
export const SUPPORT_BODY_MAX = 20_000
/** GitHub rejects very long `issues/new` URLs; stay well under the practical limit. */
export const GITHUB_ISSUE_URL_MAX = 7_000

export interface SupportReport {
  readonly title: string
  readonly body: string
}

type QueryValue = string | readonly string[] | undefined

/** `text.slice(0, end)` that never leaves half of a surrogate pair (an emoji) at the cut. */
export function sliceAtCodePoint(text: string, end: number): string {
  if (end >= text.length) return text
  const last = text.charCodeAt(end - 1)
  return text.slice(0, last >= 0xd800 && last <= 0xdbff ? end - 1 : end)
}

function first(value: QueryValue): string {
  if (value === undefined) return ""
  return typeof value === "string" ? value : (value[0] ?? "")
}

/** The report the desktop app's "Report a problem" passes as `?title=&body=`: untrusted text, trimmed and capped. */
export function readSupportQuery(query: {
  readonly title?: QueryValue
  readonly body?: QueryValue
}): SupportReport {
  return {
    title: sliceAtCodePoint(first(query.title).trim(), SUPPORT_TITLE_MAX),
    body: sliceAtCodePoint(first(query.body).trim(), SUPPORT_BODY_MAX),
  }
}

/** A new issue on the public repository with the report prefilled; a body too long for a URL is shortened and marked. */
export function githubIssueUrl(report: SupportReport): string {
  const url = new URL(`https://github.com/${GITHUB_REPOSITORY}/issues/new`)
  if (report.title) url.searchParams.set("title", report.title)
  if (!report.body) return url.href
  let body = report.body
  url.searchParams.set("body", body)
  while (url.href.length > GITHUB_ISSUE_URL_MAX && body.length > 0) {
    body = sliceAtCodePoint(body, Math.floor(body.length * 0.9)).trimEnd()
    url.searchParams.set("body", `${body}…`)
  }
  return url.href
}
