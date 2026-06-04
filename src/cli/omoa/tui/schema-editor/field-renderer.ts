import * as p from "@clack/prompts"
import color from "picocolors"

export interface FieldRenderResult {
  value: unknown
  cancelled: boolean
}

export async function renderField(
  fieldName: string,
  fieldDef: { key: string; label: string; type: string; hint: string },
  currentValue: unknown,
): Promise<FieldRenderResult> {
  switch (fieldDef.type) {
    case "boolean":
      return renderBoolean(fieldDef.label, currentValue as boolean | undefined)
    case "number":
      return renderNumber(fieldDef.label, currentValue as number | undefined, fieldDef.hint)
    case "enum":
      return renderEnum(fieldDef.label, currentValue as string | undefined, fieldDef.hint)
    case "object":
      return renderObject(fieldDef.label, currentValue as Record<string, unknown> | undefined, fieldDef.hint)
    case "record":
      return renderRecord(fieldDef.label, currentValue as Record<string, unknown> | undefined)
    case "array":
      return renderArray(fieldDef.label, currentValue as string[] | undefined)
    case "string":
    default:
      return renderString(fieldDef.label, currentValue as string | undefined)
  }
}

async function renderString(label: string, current: string | undefined): Promise<FieldRenderResult> {
  const value = await p.text({
    message: `Enter ${label}:`,
    initialValue: current ?? "",
  })

  if (p.isCancel(value)) return { value: undefined, cancelled: true }

  const trimmed = (value as string).trim()
  if (trimmed === "" && current === undefined) return { value: undefined, cancelled: true }
  if (trimmed === "") return { value: "__sentinel_clear__", cancelled: false }
  return { value: trimmed, cancelled: false }
}

async function renderBoolean(label: string, current: boolean | undefined): Promise<FieldRenderResult> {
  const value = await p.select({
    message: `Set ${label}:`,
    options: [
      { value: "true", label: "true", hint: current === true ? "current" : undefined },
      { value: "false", label: "false", hint: current === false ? "current" : undefined },
      { value: "__sentinel_clear__", label: color.red("Clear"), hint: current === undefined ? "current" : undefined },
    ],
  })

  if (p.isCancel(value)) return { value: undefined, cancelled: true }
  if (value === "__sentinel_clear__") return { value: "__sentinel_clear__", cancelled: false }
  return { value: value === "true", cancelled: false }
}

async function renderNumber(label: string, current: number | undefined, hint: string): Promise<FieldRenderResult> {
  const value = await p.text({
    message: `Enter ${label} ${color.dim(`(${hint})`)}:`,
    initialValue: current !== undefined ? String(current) : "",
  })

  if (p.isCancel(value)) return { value: undefined, cancelled: true }

  const trimmed = (value as string).trim()
  if (trimmed === "") return { value: "__sentinel_clear__", cancelled: false }
  const parsed = Number(trimmed)
  if (isNaN(parsed)) {
    p.log.warn("Invalid number.")
    return { value: undefined, cancelled: true }
  }
  return { value: parsed, cancelled: false }
}

async function renderEnum(label: string, current: string | undefined, hint: string): Promise<FieldRenderResult> {
  const options = hint.split("/").map((v) => ({
    value: v,
    label: v,
    hint: current === v ? "current" : undefined,
  }))

  options.push({ value: "__sentinel_clear__", label: color.red("Clear"), hint: undefined })

  const value = await p.select({
    message: `Select ${label}:`,
    options,
  })

  if (p.isCancel(value)) return { value: undefined, cancelled: true }
  if (value === "__sentinel_clear__") return { value: "__sentinel_clear__", cancelled: false }
  return { value, cancelled: false }
}

async function renderObject(label: string, current: Record<string, unknown> | undefined, hint: string): Promise<FieldRenderResult> {
  console.log(`  ${color.dim(`Editing ${label}: ${hint}`)}`)
  console.log(`  ${color.dim(`Current: ${current ? JSON.stringify(current) : "not set"}`)}`)

  const action = await p.select({
    message: `${label} - edit as JSON or clear:`,
    options: [
      { value: "edit", label: "Edit JSON", hint: "enter JSON object" },
      { value: "__sentinel_clear__", label: color.red("Clear"), hint: current === undefined ? "already clear" : undefined },
      { value: "cancel", label: "Cancel" },
    ],
  })

  if (p.isCancel(action) || action === "cancel") return { value: undefined, cancelled: true }
  if (action === "__sentinel_clear__") return { value: "__sentinel_clear__", cancelled: false }

  const jsonStr = await p.text({
    message: `Enter JSON for ${label}:`,
    initialValue: current ? JSON.stringify(current, null, 0) : "{}",
  })

  if (p.isCancel(jsonStr)) return { value: undefined, cancelled: true }

  try {
    const parsed = JSON.parse(jsonStr as string)
    return { value: parsed, cancelled: false }
  } catch {
    p.log.warn("Invalid JSON.")
    return { value: undefined, cancelled: true }
  }
}

async function renderRecord(label: string, current: Record<string, unknown> | undefined): Promise<FieldRenderResult> {
  return renderObject(label, current, "key-value map")
}

async function renderArray(label: string, current: string[] | undefined): Promise<FieldRenderResult> {
  const value = await p.text({
    message: `Enter ${label} (comma-separated):`,
    initialValue: current ? current.join(", ") : "",
  })

  if (p.isCancel(value)) return { value: undefined, cancelled: true }

  const trimmed = (value as string).trim()
  if (trimmed === "") return { value: "__sentinel_clear__", cancelled: false }
  const items = trimmed.split(",").map((s) => s.trim()).filter(Boolean)
  return { value: items, cancelled: false }
}
