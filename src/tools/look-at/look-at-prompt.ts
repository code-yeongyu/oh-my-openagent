export const READ_ENABLED = false

export function buildLookAtPrompt(goal: string, isBase64Input: boolean): string {
  const subjectNoun = isBase64Input ? "image" : "file"
  const sourceClause = READ_ENABLED
    ? "Use the Read tool on the provided file path to load its contents, then analyze it."
    : `The ${subjectNoun} is already attached to this message. Analyze it directly from the attachment. Do NOT attempt to use the Read tool. The Read tool is disabled for this invocation and the ${subjectNoun} cannot be loaded by path.`

  return `Analyze the attached ${subjectNoun} and extract the requested information.

${sourceClause}

Goal: ${goal}

Provide ONLY the extracted information that matches the goal.
Be thorough on what was requested, concise on everything else.
If the requested information is not found, clearly state what is missing.`
}
