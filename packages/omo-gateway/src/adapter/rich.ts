import type { RichBody, RichNode } from "./contract"

// Gateway body markup, one alternative per capture group:
//   1 *bold*          bold span on one line; may wrap links, mentions and channels (never another *)
//   2,3 <url|label>   http(s) link with a label; `<url>` or an empty/blank label keeps the url as label
//   4,5 <@id|display> mention of a platform user
//   6,7 <#id|display> reference to a chat
// A label or display may not contain `<` or `>`; markup that does not fit a token stays literal text,
// and a bare URL outside <...> stays text (the link_label rule gate decides what to do with it).
const TOKEN =
  /\*((?:<[^<>]+>|[^*\n<])+)\*|<(https?:\/\/[^\s|<>]+)(?:\|([^<>]*))?>|<@([^\s|<>]+)(?:\|([^<>]*))?>|<#([^\s|<>]+)(?:\|([^<>]*))?>/g

function withBold(node: RichNode): RichNode {
  return node.t === "text" || node.t === "link" ? { ...node, bold: true } : node
}

function linkNode(url: string, label: string | undefined): RichNode {
  const trimmed = label?.trim() ?? ""
  return { t: "link", url, label: trimmed === "" ? url : trimmed }
}

function idNode(kind: "mention" | "channel", id: string, display: string | undefined): RichNode {
  const shown = display?.trim() ?? ""
  if (kind === "mention") return shown === "" ? { t: "mention", platform_user_id: id } : { t: "mention", platform_user_id: id, display: shown }
  return shown === "" ? { t: "channel", chat_id: id } : { t: "channel", chat_id: id, display: shown }
}

function pushText(nodes: RichNode[], text: string): void {
  if (text === "") return
  const last = nodes.at(-1)
  if (last?.t === "text" && last.bold === undefined) nodes[nodes.length - 1] = { t: "text", text: last.text + text }
  else nodes.push({ t: "text", text })
}

/** Parse gateway body markup (`*bold*`, `<url|label>`, `<@user>`, `<#chat>`) into a platform-neutral RichBody. */
export function parseRich(body: string): RichBody {
  const nodes: RichNode[] = []
  let last = 0
  for (const match of body.matchAll(TOKEN)) {
    const at = match.index
    pushText(nodes, body.slice(last, at))
    const [, bold, url, label, userId, userDisplay, chatId, chatDisplay] = match
    if (bold !== undefined) nodes.push(...parseRich(bold).map(withBold))
    else if (url !== undefined) nodes.push(linkNode(url, label))
    else if (userId !== undefined) nodes.push(idNode("mention", userId, userDisplay))
    else if (chatId !== undefined) nodes.push(idNode("channel", chatId, chatDisplay))
    last = at + match[0].length
  }
  pushText(nodes, body.slice(last))
  return nodes
}

/** Plain rendering of a body: labels for links, display (or id) for mentions and channels, no markers. */
export function plainText(body: RichBody): string {
  return body
    .map((node) => {
      switch (node.t) {
        case "text":
          return node.text
        case "link":
          return node.label
        case "mention":
          return `@${node.display ?? node.platform_user_id}`
        case "channel":
          return `#${node.display ?? node.chat_id}`
      }
    })
    .join("")
}
