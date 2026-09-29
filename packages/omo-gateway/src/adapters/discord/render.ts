import { GATEWAY_REACTION_EMOJI, GATEWAY_REACTIONS, type GatewayReaction, type RichBody, type RichNode } from "../../adapter/contract"

const MARKDOWN = /[\\*_~|`>[\]()]/g

function escapeMarkdown(text: string): string {
  return text.replace(MARKDOWN, (char) => `\\${char}`)
}

function renderNode(node: RichNode): string {
  switch (node.t) {
    case "text":
      return escapeMarkdown(node.text)
    case "link":
      return `[${escapeMarkdown(node.label)}](<${node.url}>)`
    case "mention":
      return `<@${node.platform_user_id}>`
    case "channel":
      return `<#${node.chat_id}>`
  }
}

function isBold(node: RichNode): boolean {
  return (node.t === "text" || node.t === "link") && node.bold === true
}

function wrapBold(inner: string): string {
  const core = inner.trim()
  if (core === "") return inner
  const lead = inner.slice(0, inner.indexOf(core))
  return `${lead}**${core}**${inner.slice(lead.length + core.length)}`
}

/** Discord message content for a gateway body: markdown with masked links, real mentions, one `**` pair per bold run. */
export function renderContent(body: RichBody): string {
  let out = ""
  let run = ""
  for (const node of body) {
    if (isBold(node)) {
      run += renderNode(node)
      continue
    }
    out += wrapBold(run) + renderNode(node)
    run = ""
  }
  return out + wrapBold(run)
}

/** The user ids a body mentions: the only pings `allowed_mentions` lets through. */
export function mentionedUsers(body: RichBody): string[] {
  return [...new Set(body.flatMap((node) => (node.t === "mention" ? [node.platform_user_id] : [])))]
}

function isGatewayReaction(name: string): name is GatewayReaction {
  return (GATEWAY_REACTIONS as readonly string[]).includes(name)
}

/** The emoji Discord stores for a gateway reaction name, or the name itself (unicode or `name:id`). */
export function reactionEmoji(name: string): string {
  return isGatewayReaction(name) ? GATEWAY_REACTION_EMOJI[name] : name
}

/** The gateway name for a Discord emoji, or the emoji itself when no name maps to it. */
export function reactionName(emoji: { name: string | null; id: string | null }): string {
  if (emoji.id !== null) return `${emoji.name ?? ""}:${emoji.id}`
  const unicode = emoji.name ?? ""
  return GATEWAY_REACTIONS.find((name) => GATEWAY_REACTION_EMOJI[name] === unicode) ?? unicode
}
