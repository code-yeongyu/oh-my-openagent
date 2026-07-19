export type ServerCredentials = {
	readonly password: string
	readonly username?: string
}

export function getServerCredentials(): ServerCredentials | undefined {
	const password = process.env.OPENCODE_SERVER_PASSWORD
	if (!password) {
		return undefined
	}

	const username = process.env.OPENCODE_SERVER_USERNAME
	if (username === undefined) {
		return { password }
	}
	return { password, username }
}
