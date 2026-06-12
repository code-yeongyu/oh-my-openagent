import type { LookAtFilePart } from "./look-at-input-preparer"

export const READ_ENABLED = false

function sanitizeFilename(filename: string): string {
  const basename = filename.split("/").pop() ?? filename
  return basename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100)
}

export function buildLookAtPrompt(goal: string, fileParts: LookAtFilePart[]): string {
  const isPlural = fileParts.length > 1
  const subjectNoun = isPlural ? "files/images" : "file/image"
  const pronoun = isPlural ? "them" : "it"
  const labels = isPlural
    ? `\n\nAttached files/images:\n${fileParts
      .map((filePart, index) => `File ${index + 1}: ${sanitizeFilename(filePart.filename)}`)
      .join("\n")}`
    : ""
  const sourceClause = READ_ENABLED
    ? "Use the Read tool on the provided file path to load its contents, then analyze it."
    : `The attached ${subjectNoun} ${isPlural ? "are" : "is"} already included in this message. Analyze ${pronoun} directly from the attachment. Do NOT attempt to load by path — the ${subjectNoun} cannot be loaded by path.`

  return `Analyze ${isPlural ? "these files/images" : "this file/image"} and extract the requested information.${labels}

${sourceClause}

Goal: ${goal}

Provide ONLY the extracted information that matches the goal.
Be thorough on what was requested, concise on everything else.
If the requested information is not found, clearly state what is missing.`
}
