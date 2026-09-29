import type { RichBody, RichNode } from "../../adapter/contract"

function escapeText(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
}

function escapeAttribute(value: string): string {
  return escapeText(value).replaceAll('"', "&quot;")
}

function renderNode(node: RichNode): string {
  switch (node.t) {
    case "text":
      return node.bold ? `<b>${escapeText(node.text)}</b>` : escapeText(node.text)
    case "link": {
      const anchor = `<a href="${escapeAttribute(node.url)}">${escapeText(node.label)}</a>`
      return node.bold ? `<b>${anchor}</b>` : anchor
    }
    case "mention": {
      const shown = escapeText(`@${node.display ?? node.platform_user_id}`)
      return /^\d+$/.test(node.platform_user_id) ? `<a href="tg://user?id=${node.platform_user_id}">${shown}</a>` : shown
    }
    case "channel":
      return escapeText(`#${node.display ?? node.chat_id}`)
  }
}

export function renderTelegramHtml(body: RichBody): string {
  return body.map(renderNode).join("")
}

const MAX_DRAFT_ID = 2_147_483_647

/** sendMessageDraft needs a non-zero integer id: a numeric draft_id is used as is, any other string maps to a stable FNV-1a hash. */
export function telegramDraftId(draft_id: string): number {
  if (/^[1-9]\d{0,9}$/.test(draft_id) && Number(draft_id) <= MAX_DRAFT_ID) return Number(draft_id)
  let hash = 0x811c9dc5
  for (const char of draft_id) hash = Math.imul(hash ^ (char.codePointAt(0) ?? 0), 0x01000193) >>> 0
  return (hash % (MAX_DRAFT_ID - 1)) + 1
}
