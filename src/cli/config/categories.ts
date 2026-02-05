import * as p from "@clack/prompts"
import color from "picocolors"
import type { CategoryConfig } from "../../config/schema"
import type { ConfigEditorState } from "./types"
import { AVAILABLE_MODELS } from "./types"

type MutableCategories = Record<string, CategoryConfig>

function getCategories(state: ConfigEditorState): MutableCategories {
  return (state.config.categories ?? {}) as MutableCategories
}

function formatCategoryStatus(state: ConfigEditorState, categoryName: string): string {
  const categories = getCategories(state)
  const category = categories[categoryName]
  if (!category) {
    return color.dim("not configured")
  }

  const parts: string[] = []

  if (category.model) {
    parts.push(`model: ${color.cyan(category.model)}`)
  }

  if (category.description) {
    parts.push(`desc: ${color.dim(category.description.slice(0, 30))}${category.description.length > 30 ? "..." : ""}`)
  }

  if (parts.length === 0) {
    return color.dim("no settings")
  }

  return parts.join(" | ")
}

async function editCategory(
  state: ConfigEditorState,
  categoryName: string
): Promise<boolean> {
  const categories = getCategories(state)
  const category = categories[categoryName] ?? {}

  const field = await p.select({
    message: `Editing category "${categoryName}" - Select field:`,
    options: [
      { value: "model", label: "Model", hint: category.model ? `current: ${category.model}` : "not set" },
      { value: "description", label: "Description", hint: category.description ? `current: ${category.description.slice(0, 20)}...` : "not set" },
      { value: "back", label: "Back to category list" },
    ],
  })

  if (p.isCancel(field) || field === "back") {
    return false
  }

  if (field === "model") {
    const model = await p.select({
      message: `Select model for category "${categoryName}":`,
      options: [
        ...AVAILABLE_MODELS.map((m) => ({ value: m, label: m })),
        { value: "__custom__", label: "Custom model..." },
        { value: "__clear__", label: "Clear model" },
      ],
      initialValue: category.model,
    })

    if (p.isCancel(model)) return false

    let finalModel: string | undefined
    if (model === "__clear__") {
      finalModel = undefined
    } else if (model === "__custom__") {
      const custom = await p.text({
        message: "Enter custom model name:",
        initialValue: category.model ?? "",
      })
      if (p.isCancel(custom)) return false
      finalModel = custom
    } else {
      finalModel = model
    }

    if (!state.config.categories) state.config.categories = {}
    const categoriesMutable = state.config.categories as MutableCategories
    if (!categoriesMutable[categoryName]) categoriesMutable[categoryName] = {}
    categoriesMutable[categoryName].model = finalModel
    state.modified = true

    p.log.success(`Updated model for category "${categoryName}" to ${finalModel ?? "(none)"}`)
  }

  if (field === "description") {
    const description = await p.text({
      message: `Enter description for category "${categoryName}":`,
      initialValue: category.description ?? "",
      placeholder: "e.g., Agents for UI/UX work",
    })

    if (p.isCancel(description)) return false

    const finalDescription = description.trim() || undefined

    if (!state.config.categories) state.config.categories = {}
    const categoriesMutable = state.config.categories as MutableCategories
    if (!categoriesMutable[categoryName]) categoriesMutable[categoryName] = {}
    categoriesMutable[categoryName].description = finalDescription
    state.modified = true

    p.log.success(`Updated description for category "${categoryName}"`)
  }

  return true
}

export async function editCategories(state: ConfigEditorState): Promise<void> {
  while (true) {
    const categories = getCategories(state)
    const categoryNames = Object.keys(categories)

    const options = [
      ...categoryNames.map((name) => ({
        value: name,
        label: `${name.padEnd(20)} ${formatCategoryStatus(state, name)}`,
      })),
      { value: "__new__", label: color.cyan("+ Create new category") },
      { value: "__back__", label: color.dim("← Back to main menu") },
    ]

    const selected = await p.select({
      message: "Select a category to edit (or create new):",
      options,
    })

    if (p.isCancel(selected) || selected === "__back__") {
      return
    }

    if (selected === "__new__") {
      const newName = await p.text({
        message: "Enter new category name:",
        validate: (value) => {
          if (!value.trim()) return "Category name is required"
          if (categoryNames.includes(value.trim())) return "Category already exists"
          return undefined
        },
      })

      if (p.isCancel(newName)) continue

      const trimmedName = newName.trim()

      if (!state.config.categories) state.config.categories = {}
      const categoriesMutable = state.config.categories as MutableCategories
      categoriesMutable[trimmedName] = {}
      state.modified = true

      p.log.success(`Created category "${trimmedName}"`)

      const shouldContinue = await editCategory(state, trimmedName)
      if (!shouldContinue) continue
    } else {
      const shouldContinue = await editCategory(state, selected as string)
      if (!shouldContinue) continue
    }
  }
}
