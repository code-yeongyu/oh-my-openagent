export function injectConstraints(basePrompt: string, constraints: string): string {
  if (!constraints || constraints.trim() === "") {
    return basePrompt
  }

  if (basePrompt.includes("<global-constraints>")) {
    return basePrompt
  }

  const constraintsBlock = `<global-constraints>
## Global Project Constraints (NON-NEGOTIABLE)

The following constraints were extracted from the project and MUST be respected in your sub-plan:

${constraints}
</global-constraints>`

  return `${constraintsBlock}

${basePrompt}`
}
