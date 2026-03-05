export interface ToolHeader {
  icon: string
  title: string
  description?: string
}

export function formatToolHeader(toolName: string, input: Record<string, unknown>): ToolHeader {
  if (toolName === "glob") {
    const pattern = str(input.pattern)
    const root = str(input.path)
    return {
      icon: "✱",
      title: pattern ? `Glob "${pattern}"` : "Glob",
      description: root ? `in ${root}` : undefined,
    }
  }

  if (toolName === "grep") {
    const pattern = str(input.pattern)
    const root = str(input.path)
    return {
      icon: "✱",
      title: pattern ? `Grep "${pattern}"` : "Grep",
      description: root ? `in ${root}` : undefined,
    }
  }

  if (toolName === "list") {
    const path = str(input.path)
    return {
      icon: "→",
      title: path ? `List ${path}` : "List",
    }
  }

  if (toolName === "read") {
    const filePath = str(input.filePath)
    return {
      icon: "→",
      title: filePath ? `Read ${filePath}` : "Read",
      description: formatKeyValues(input, ["filePath"]),
    }
  }

  if (toolName === "write") {
    const filePath = str(input.filePath)
    return {
      icon: "←",
      title: filePath ? `Write ${filePath}` : "Write",
    }
  }

  if (toolName === "edit") {
    const filePath = str(input.filePath)
    return {
      icon: "←",
      title: filePath ? `Edit ${filePath}` : "Edit",
      description: formatKeyValues(input, ["filePath", "oldString", "newString"]),
    }
  }

  if (toolName === "webfetch") {
    const url = str(input.url)
    return {
      icon: "%",
      title: url ? `WebFetch ${url}` : "WebFetch",
      description: formatKeyValues(input, ["url"]),
    }
  }

  if (toolName === "websearch_web_search_exa") {
    const query = str(input.query)
    return {
      icon: "◈",
      title: query ? `Web Search "${query}"` : "Web Search",
    }
  }

  if (toolName === "grep_app_searchGitHub") {
    const query = str(input.query)
    return {
      icon: "◇",
      title: query ? `Code Search "${query}"` : "Code Search",
    }
  }

  if (toolName === "task") {
    const desc = str(input.description)
    const subagent = str(input.subagent_type)
    return {
      icon: "#",
      title: desc || (subagent ? `${subagent} Task` : "Task"),
      description: subagent ? `agent=${subagent}` : undefined,
    }
  }

  if (toolName === "bash") {
    const command = str(input.command)
    return {
      icon: "$",
      title: command || "bash",
      description: formatKeyValues(input, ["command"]),
    }
  }

  if (toolName === "skill") {
    const name = str(input.name)
    return {
      icon: "→",
      title: name ? `Skill "${name}"` : "Skill",
    }
  }

  if (toolName === "todowrite") {
    return {
      icon: "#",
      title: "Todos",
    }
  }

  return {
    icon: "⚙",
    title: toolName,
    description: formatKeyValues(input, []),
  }
}

function formatKeyValues(input: Record<string, unknown>, exclude: string[]): string | undefined {
  const entries = Object.entries(input).filter(([key, value]) => {
    if (exclude.includes(key)) return false
    return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
  })
  if (!entries.length) return undefined

  return entries
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(" ")
}

function str(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed.length ? trimmed : undefined
}
