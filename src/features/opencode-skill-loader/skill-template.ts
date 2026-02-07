export function wrapSkillTemplate(baseDir: string, body: string): string {
  return `<skill-instruction>
Base directory for this skill: ${baseDir}/
File references (@path) in this skill are relative to this directory.

${body.trim()}
</skill-instruction>

<user-request>
$ARGUMENTS
</user-request>`
}

