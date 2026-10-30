import { parseAgreementsLedger, sortAgreements } from "./format"
import { AGREEMENTS_PATH, type AgreementItem } from "./types"

const PREAMBLE =
  "Standing agreements with your person: [scope] [author] [broken xN] text. NEEDS-HUMAN means it was broken past the threshold: do not break it again; if the task requires it, stop and ask."

export function renderAgreementsSection(body: string): string {
  const { items } = parseAgreementsLedger(body)
  if (items.length === 0) return ""
  return [
    "<agreements>",
    `<projection>$MEMORY_DIR/${AGREEMENTS_PATH}</projection>`,
    PREAMBLE,
    ...sortAgreements(items).map(renderLine),
    "</agreements>",
  ].join("\n")
}

function renderLine(item: AgreementItem): string {
  const flag = item.status === "needs-human" ? " NEEDS-HUMAN:" : ""
  return `- [${item.scope}] [${item.by}] [broken x${item.n}]${flag} ${item.text}`
}
