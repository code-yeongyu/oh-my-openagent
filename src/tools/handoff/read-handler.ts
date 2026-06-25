import { getHandoffFilePath, readHandoffFile } from "../../features/handoff"
import { validateHandoffYaml } from "../../features/handoff/validate"

/**
 * `handoff` tool — `action: "read"` handler.
 *
 * Loads `.matrixx/handoff.md` and returns its full content (YAML frontmatter
 * + markdown body) so the LLM can apply it as context for the new session.
 * Returns a clear `Error:` string if no active handoff exists.
 */
export function handleRead(directory: string): string {
  //#given - storage layer returns null when the file is missing
  const content = readHandoffFile(directory)
  if (content === null) {
    return `Error: No handoff found at ${getHandoffFilePath(directory)}`
  }

  //#when - sanity check that the file is actually a valid handoff document
  const validation = validateHandoffYaml(content)
  if (!validation.valid) {
    // Still return the raw content so the LLM can recover context, but flag
    // the validation issues as a leading warning. The caller (template code)
    // can choose to ignore the warning and parse the content anyway.
    const warning = `Warning: handoff at ${getHandoffFilePath(directory)} failed schema validation: ${validation.errors.join("; ")}\n\n`
    return warning + content
  }

  //#then - return the raw file content (frontmatter + body) verbatim
  return content
}
