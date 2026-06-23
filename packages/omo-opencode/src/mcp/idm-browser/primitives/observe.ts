import type { Page } from "playwright-core"

export type ObservableElement = {
  role: string
  name: string
  selector: string
  text?: string
  href?: string
  isInteractive: boolean
}

type EvaluatedElement = {
  tag: string
  role: string
  name: string
  text: string
  href: string
  type: string
  ariaLabel: string
  placeholder: string
  testId: string
  id: string
  classList: string
  isInteractive: boolean
}

export async function observeAXTree(page: Page, query?: string): Promise<ObservableElement[]> {
  const raw = await page.evaluate(() => {
    const interactiveTags = new Set(["A", "BUTTON", "INPUT", "TEXTAREA", "SELECT"])
    const interactiveRoles = new Set([
      "button", "link", "textbox", "checkbox", "radio",
      "combobox", "menuitem", "tab", "switch", "searchbox",
    ])

    const out: EvaluatedElement[] = []
    const all = document.querySelectorAll<HTMLElement>(
      "a, button, input, textarea, select, [role], [aria-label], [data-testid], [contenteditable=\"true\"]",
    )

    for (const el of Array.from(all)) {
      const tag = el.tagName
      const explicitRole = el.getAttribute("role") ?? ""
      const role = explicitRole || implicitRole(tag, el)
      const name =
        el.getAttribute("aria-label") ??
        el.getAttribute("alt") ??
        el.getAttribute("title") ??
        (tag === "INPUT" ? el.getAttribute("placeholder") ?? "" : "") ??
        ""
      const text = (el.innerText ?? "").trim().slice(0, 200)
      const href = el.getAttribute("href") ?? ""
      const inputType = el.getAttribute("type") ?? ""
      const placeholder = el.getAttribute("placeholder") ?? ""
      const testId = el.getAttribute("data-testid") ?? ""
      const id = el.id ?? ""
      const classList = Array.from(el.classList).slice(0, 3).join(" ")
      const isInteractive =
        interactiveTags.has(tag) ||
        interactiveRoles.has(role) ||
        el.isContentEditable ||
        el.tabIndex >= 0

      out.push({
        tag, role, name: name || text.slice(0, 80),
        text, href, type: inputType,
        ariaLabel: el.getAttribute("aria-label") ?? "",
        placeholder, testId, id, classList, isInteractive,
      })
    }

    return out

    function implicitRole(t: string, el: HTMLElement): string {
      if (t === "A" && el.getAttribute("href")) return "link"
      if (t === "BUTTON") return "button"
      if (t === "INPUT") {
        const it = el.getAttribute("type") ?? "text"
        if (it === "checkbox") return "checkbox"
        if (it === "radio") return "radio"
        if (it === "submit" || it === "button") return "button"
        return "textbox"
      }
      if (t === "TEXTAREA") return "textbox"
      if (t === "SELECT") return "combobox"
      return ""
    }
  })

  const elements: ObservableElement[] = (raw as EvaluatedElement[]).map(buildElement)

  if (!query) return elements

  const lower = query.toLowerCase()
  return elements.filter(el =>
    el.name.toLowerCase().includes(lower) ||
    el.text?.toLowerCase().includes(lower) ||
    el.role.toLowerCase().includes(lower)
  )
}

function buildElement(raw: EvaluatedElement): ObservableElement {
  return {
    role: raw.role || raw.tag.toLowerCase(),
    name: raw.name || raw.placeholder || raw.testId || raw.id || "",
    selector: buildSelector(raw),
    text: raw.text || undefined,
    href: raw.href || undefined,
    isInteractive: raw.isInteractive,
  }
}

function buildSelector(raw: EvaluatedElement): string {
  if (raw.testId) return `[data-testid="${raw.testId}"]`
  if (raw.id) return `#${raw.id}`
  if (raw.ariaLabel) return `[aria-label="${raw.ariaLabel}"]`
  if (raw.role === "link" && raw.name) return `a:has-text("${raw.name}")`
  if (raw.role === "button" && raw.name) return `button:has-text("${raw.name}")`
  if ((raw.role === "textbox" || raw.tag === "INPUT" || raw.tag === "TEXTAREA") && raw.placeholder) {
    return `[placeholder="${raw.placeholder}"]`
  }
  return raw.tag.toLowerCase()
}
