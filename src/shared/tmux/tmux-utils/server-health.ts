let serverAvailable: boolean | null = null
let serverCheckUrl: string | null = null

const SERVER_RUNNING_KEY = Symbol.for("oh-my-opencode:server-running-in-process")

function delay(milliseconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

export function markServerRunningInProcess(): void {
	;(globalThis as Record<symbol, boolean>)[SERVER_RUNNING_KEY] = true
}

function isMarkedRunningInProcess(): boolean {
	return (globalThis as Record<symbol, boolean>)[SERVER_RUNNING_KEY] === true
}

export async function isServerRunning(serverUrl: string): Promise<boolean> {
	if (isMarkedRunningInProcess()) {
		return true
	}

	if (serverCheckUrl === serverUrl && serverAvailable === true) {
		return true
	}

	const healthUrl = new URL("/global/health", serverUrl).toString()
	const timeoutMs = 3000
	const maxAttempts = 2

	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		const controller = new AbortController()
		const timeout = setTimeout(() => controller.abort(), timeoutMs)

		try {
			const response = await fetch(healthUrl, {
				signal: controller.signal,
			}).catch(() => null)
			clearTimeout(timeout)

			if (response?.ok) {
				serverCheckUrl = serverUrl
				serverAvailable = true
				return true
			}
		} finally {
			clearTimeout(timeout)
		}

		if (attempt < maxAttempts) {
			await delay(250)
		}
	}

	return false
}

export function resetServerCheck(): void {
	serverAvailable = null
	serverCheckUrl = null
}
