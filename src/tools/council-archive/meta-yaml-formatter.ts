export interface MetaMember {
  task_id: string
  member: string
  member_slug: string
  task_output_path: string
  archive_file: string
  has_response: boolean
  response_complete: boolean
}

function quoteYamlValue(value: string): string {
  // Quote YAML values that contain special characters: :, #, ", ', etc.
  if (/[:#"'&*\[\]{}|>@`]/.test(value) || value.startsWith(" ") || value.endsWith(" ")) {
    return `"${value.replace(/"/g, '\\"')}"`
  }
  return value
}

export function formatMetaYaml(archiveName: string, createdAt: string, members: MetaMember[], question?: string, promptFile?: string): string {
  const lines: string[] = [
    `archive_name: ${archiveName}`,
    `created_at: ${createdAt}`,
  ]

  if (question) {
    lines.push(`question: |`)
    for (const qLine of question.split("\n")) {
      lines.push(`  ${qLine}`)
    }
  }

  if (promptFile) {
    lines.push(`prompt_file: ${promptFile}`)
  }

  lines.push("members:")

  for (const m of members) {
    lines.push(`  - task_id: ${quoteYamlValue(m.task_id)}`)
    lines.push(`    member: ${quoteYamlValue(m.member)}`)
    lines.push(`    member_slug: ${quoteYamlValue(m.member_slug)}`)
    lines.push(`    task_output_path: ${quoteYamlValue(m.task_output_path)}`)
    lines.push(`    archive_file: ${quoteYamlValue(m.archive_file)}`)
    lines.push(`    has_response: ${m.has_response}`)
    lines.push(`    response_complete: ${m.response_complete}`)
  }

  return lines.join("\n") + "\n"
}
