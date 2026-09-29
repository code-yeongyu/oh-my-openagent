// RichBody -> Slack message payload. Every post carries an explicit `rich_text` block: a user session
// token renders plain `text` as a rich_text block with `<url|label>` left literal, so links, bold,
// mentions and channels are sent as rich_text elements, and `text` is only the notification fallback.
// A bare URL inside a text node stays a text element: labeling links is the link_label gate's job.
import { GATEWAY_REACTION_EMOJI, GATEWAY_REACTIONS, type GatewayReaction, type RichBody, type RichNode } from "../../adapter/contract"

type Bold = { style?: { bold: true } }
export type RichElement =
  | ({ type: "text"; text: string } & Bold)
  | ({ type: "link"; url: string; text?: string } & Bold)
  | { type: "user"; user_id: string }
  | { type: "channel"; channel_id: string }

const bold = (node: { bold?: true }): Bold => (node.bold === true ? { style: { bold: true } } : {})

export function richElement(node: RichNode): RichElement {
  switch (node.t) {
    case "text":
      return { type: "text", text: node.text, ...bold(node) }
    case "link":
      return node.label === node.url ? { type: "link", url: node.url, ...bold(node) } : { type: "link", url: node.url, text: node.label, ...bold(node) }
    case "mention":
      return { type: "user", user_id: node.platform_user_id }
    case "channel":
      return { type: "channel", channel_id: node.chat_id }
  }
}

const escapeText = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

/** The notification fallback: labels for links, real `<@U>`/`<#C>` so notifications still resolve. */
export function fallbackText(body: RichBody): string {
  return body
    .map((node) => {
      switch (node.t) {
        case "text":
          return escapeText(node.text)
        case "link":
          return escapeText(node.label)
        case "mention":
          return `<@${node.platform_user_id}>`
        case "channel":
          return `<#${node.chat_id}>`
      }
    })
    .join("")
}

export function richBlocks(body: RichBody): readonly object[] {
  return [{ type: "rich_text", elements: [{ type: "rich_text_section", elements: body.map(richElement) }] }]
}

export function messagePayload(body: RichBody): { text: string; blocks: string } {
  return { text: fallbackText(body), blocks: JSON.stringify(richBlocks(body)) }
}

const SLACK_NAMES: Readonly<Record<GatewayReaction, string>> = {
  seen: "eyes",
  working: "hourglass_flowing_sand",
  done: "white_check_mark",
  failed: "x",
  waiting: "double_vertical_bar",
  question: "question",
  number_1: "one",
  number_2: "two",
  number_3: "three",
  number_4: "four",
  number_5: "five",
  number_6: "six",
  number_7: "seven",
  number_8: "eight",
  number_9: "nine",
}

function gatewayName(name: string): GatewayReaction | null {
  const byName = GATEWAY_REACTIONS.find((candidate) => candidate === name)
  return byName ?? GATEWAY_REACTIONS.find((candidate) => GATEWAY_REACTION_EMOJI[candidate] === name) ?? null
}

/** The Slack short name for a gateway reaction name, its unicode emoji, or a Slack name (`:x:` or `x`). */
export function slackReaction(name: string): string {
  const mapped = gatewayName(name)
  return mapped === null ? name.replace(/^:|:$/g, "") : SLACK_NAMES[mapped]
}

/** The gateway name for a Slack short name, or the Slack short name when no gateway name maps to it. */
export function reactionName(slack: string): string {
  return GATEWAY_REACTIONS.find((candidate) => SLACK_NAMES[candidate] === slack) ?? slack
}
