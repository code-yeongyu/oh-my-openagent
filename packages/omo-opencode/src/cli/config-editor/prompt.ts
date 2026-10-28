import * as p from "@clack/prompts"

export class EditorCancelled extends Error {}

export function displayText(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`)
}

export async function choose<T extends string | number>(message: string, options: p.Option<T>[], initialValue?: T): Promise<T> {
  const value = await p.select<T>({ message: displayText(message), options: options.map((option) => ({ ...option, ...(option.label === undefined ? {} : { label: displayText(option.label) }), ...(option.hint === undefined ? {} : { hint: displayText(option.hint) }) })) as p.Option<T>[], ...(initialValue === undefined ? {} : { initialValue }) })
  if (p.isCancel(value)) throw new EditorCancelled()
  return value
}

export async function input(message: string, initialValue?: string, validate?: (value: string) => string | undefined): Promise<string> {
  if (initialValue !== undefined && displayText(initialValue) !== initialValue) {
    throw new Error("This value contains terminal control characters. Edit it as JSON using Other configuration fields.")
  }
  const value = await p.text({
    message: displayText(message),
    ...(initialValue === undefined ? {} : { initialValue }),
    ...(validate === undefined ? {} : { validate: (text) => validate(text ?? "") }),
  })
  if (p.isCancel(value)) throw new EditorCancelled()
  return (value ?? "").trim()
}

export function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export function safeName(value: string): string | undefined {
  if (/[\u0000-\u001f\u007f-\u009f]/.test(value)) return "Names cannot contain terminal control characters."
  if (!value.trim()) return "Enter a name."
  if (["__proto__", "constructor", "prototype"].includes(value.trim())) return "This name is reserved."
  return undefined
}
