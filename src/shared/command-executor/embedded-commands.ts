export interface CommandMatch {
	fullMatch: string
	command: string
	start: number
	end: number
}

const COMMAND_PATTERN = /!`([^`]+)`/g

export function findEmbeddedCommands(text: string): CommandMatch[] {
	const matches: CommandMatch[] = []

	COMMAND_PATTERN.lastIndex = 0

	for (let match = COMMAND_PATTERN.exec(text); match !== null; match = COMMAND_PATTERN.exec(text)) {
		matches.push({
			fullMatch: match[0],
			command: match[1],
			start: match.index,
			end: match.index + match[0].length,
		})
	}

	return matches
}
