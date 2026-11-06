/**
 * The one link format for a thread, built here and nowhere else: `omo-thread://v1/<thread_id>`. The
 * thread id is the session's durable id, which is also the desktop's thread id (one identity since
 * desktop #887), so a client opens the thread in its own environment and says so when it does not
 * hold that thread. The link carries the id only: never a path, a socket, or a token.
 */
export const THREAD_LINK_SCHEME = "omo-thread"
const PREFIX = `${THREAD_LINK_SCHEME}://v1/`
const FALLBACK_LABEL = "thread"

export function threadLinkUrl(threadId: string): string {
  return `${PREFIX}${encodeURIComponent(threadId)}`
}

/**
 * `[label](omo-thread://v1/<id>)`, ready to paste into a message. The label is a session name, which
 * users and peer agents set, so `\`, `[`, `]` (link syntax), `<`, `>` (autolinks and raw HTML), `&`
 * (entities) and `` ` `` (code spans) are escaped: no name can end the link early, render a second link
 * inside it, or pull it into a code span. Emphasis characters are left alone. Desktop's
 * `formatThreadLink` escapes the same set.
 */
export function threadLink(threadId: string, label: string | null | undefined): string {
  const text = label?.replace(/\s+/g, " ").trim() || FALLBACK_LABEL
  return `[${text.replace(/[\\[\]<>&`]/g, (char) => `\\${char}`)}](${threadLinkUrl(threadId)})`
}

/** The thread id a link names, or null for anything that is not a v1 thread link. */
export function parseThreadLinkUrl(url: string): { readonly threadId: string } | null {
  if (!url.startsWith(PREFIX)) return null
  const encoded = url.slice(PREFIX.length)
  // threadLinkUrl percent-encodes the id, so a raw `/`, `?` or `#` means a path, query or fragment
  // was added to the link: that is not a v1 thread link.
  if (encoded.length === 0 || /[/?#]/.test(encoded)) return null
  try {
    const threadId = decodeURIComponent(encoded)
    return threadId.length === 0 ? null : { threadId }
  } catch {
    return null
  }
}
