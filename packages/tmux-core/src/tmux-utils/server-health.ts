let serverAvailable: boolean | null = null
let serverCheckUrl: string | null = null

export type ServerHealthState = {
	serverAvailable: boolean | null
	serverCheckUrl: string | null
}

type IsServerRunningOptions = {
	fetchImplementation?: typeof fetch
	state?: ServerHealthState
}

function delay(milliseconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

export function createServerHealthState(): ServerHealthState {
	return {
		serverAvailable: null,
		serverCheckUrl: null,
	}
}

export const createServerHealthStateForTesting = createServerHealthState

export async function isServerRunning(serverUrl: string, options: IsServerRunningOptions = {}): Promise<boolean> {
	const fetchImplementation = options.fetchImplementation ?? fetch
	const state = options.state
	const cachedUrl = state?.serverCheckUrl ?? serverCheckUrl
	const cachedAvailable = state?.serverAvailable ?? serverAvailable
	if (cachedUrl === serverUrl && cachedAvailable === true) {
		return true
	}

	const healthUrl = new URL("/global/health", serverUrl).toString()
	const timeoutMs = 3000
	const maxAttempts = 2

	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		const controller = new AbortController()
		const timeout = setTimeout(() => controller.abort(), timeoutMs)

		try {
			const response = await fetchImplementation(healthUrl, {
				signal: controller.signal,
			}).catch(() => null)
			clearTimeout(timeout)

			if (response?.ok) {
				if (state) {
					state.serverCheckUrl = serverUrl
					state.serverAvailable = true
				} else {
					serverCheckUrl = serverUrl
					serverAvailable = true
				}
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
