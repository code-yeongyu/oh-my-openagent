import type { BtwSessionCatalog } from "./tui-session-catalog"

const SESSION_VALUE_PREFIX = "session:"
const NEW_VALUE_PREFIX = "new:"

export type BtwPickerOption = {
  title: string
  value: string
  description: string
  category: string
  disabled?: boolean
}

export type BtwPickerSelection =
  | {
      type: "session"
      sessionID: string
    }
  | {
      type: "new"
      parentSessionID: string
    }

function sessionValue(sessionID: string): string {
  return `${SESSION_VALUE_PREFIX}${sessionID}`
}

function sideSummary(title: string): string {
  const summary = title.replace(/^BTW\s*·\s*/, "").trim()
  return summary || "Untitled side"
}

export function parseBtwPickerValue(
  value: string,
): BtwPickerSelection | undefined {
  if (value.startsWith(SESSION_VALUE_PREFIX)) {
    const sessionID = value.slice(SESSION_VALUE_PREFIX.length)
    return sessionID
      ? {
          type: "session",
          sessionID,
        }
      : undefined
  }
  if (value.startsWith(NEW_VALUE_PREFIX)) {
    const parentSessionID = value.slice(NEW_VALUE_PREFIX.length)
    return parentSessionID
      ? {
          type: "new",
          parentSessionID,
        }
      : undefined
  }
  return undefined
}

export function buildBtwPickerOptions(
  catalog: BtwSessionCatalog,
  currentSessionID: string,
): {
  options: BtwPickerOption[]
  current: string
} {
  const mainTitle = catalog.main.title.trim() || "Untitled conversation"
  const options: BtwPickerOption[] = [
    {
      title: `Main · ${mainTitle}`,
      value: sessionValue(catalog.main.id),
      description: catalog.main.id,
      category: "Main conversation",
    },
    ...(catalog.sides.length === 0
      ? [
          {
            title: "No retained BTW sessions yet",
            value: "empty",
            description: "Choose New BTW to start one",
            category: "Retained BTW sessions",
            disabled: true,
          },
        ]
      : []),
    ...catalog.sides.map((side, index) => ({
      title: `BTW #${index + 1} · ${sideSummary(side.title)}`,
      value: sessionValue(side.id),
      description: side.id,
      category: "Retained BTW sessions",
    })),
    {
      title: "New BTW",
      value: `${NEW_VALUE_PREFIX}${catalog.main.id}`,
      description: "Start another retained side conversation",
      category: "Actions",
    },
  ]
  const current = options.some(
    (option) => option.value === sessionValue(currentSessionID),
  )
    ? sessionValue(currentSessionID)
    : sessionValue(catalog.main.id)
  return {
    options,
    current,
  }
}
