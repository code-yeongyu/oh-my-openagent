let serverAvailable: boolean | null = null
let serverCheckUrl: string | null = null

const SERVER_RUNNING_KEY = Symbol.for("oh-my-opencode:server-running-in-process")

export type ServerHealthState = {
	serverAvailable: boolean | null
	serverCheckUrl: string | null
	serverRunningInProcess: boolean
}

type IsServerRunningOptions = {
	fetchImplementation?: typeof fetch
	state?: ServerHealthState
}

function delay(milliseconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

export function markServerRunningInProcess(): void {
	;(globalThis as Record<symbol, boolean>)[SERVER_RUNNING_KEY] = true
}

function isMarkedRunningInProcess(): boolean {
	return (globalThis as Record<symbol, boolean>)[SERVER_RUNNING_KEY] === true
}

export function createServerHealthState(): ServerHealthState {
	return {
		serverAvailable: null,
		serverCheckUrl: null,
		serverRunningInProcess: false,
	}
}

	export const createServerHealthStateForTesting = createServerHealthState

export async function isServerRunning(serverUrl: string, options: IsServerRunningOptions = {}): Promise<boolean> {
	const fetchImplementation = options.fetchImplementation ?? fetch
	const state = options.state
	const markedRunning = state?.serverRunningInProcess ?? isMarkedRunningInProcess()
	if (markedRunning) {
		return true
	}

	const cachedUrl = state?.serverCheckUrl ?? serverCheckUrl
	const cachedAvailable = state?.serverAvailable ?? serverAvailable
	if (cachedUrl === serverUrl && cachedAvailable === true) {
		return true
	}

	const timeoutMs = 3000
	const maxAttempts = 2

	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		// opencode exposes `/health` (returns {"ok":true}); older builds used
		// `/global/health`. Probe both so the check works against either.
		const response = await probeServerHealth(fetchImplementation, serverUrl, timeoutMs)

		if (response) {
			if (state) {
				state.serverCheckUrl = serverUrl
				state.serverAvailable = true
			} else {
				serverCheckUrl = serverUrl
				serverAvailable = true
			}
			return true
		}

		if (attempt < maxAttempts) {
			await delay(250)
		}
	}

	return false
}

async function probeServerHealth(
	fetchImplementation: typeof fetch,
	serverUrl: string,
	timeoutMs: number,
): Promise<boolean> {
	// Each probe gets its own AbortController + full timeout budget, so a slow
	// `/health` response cannot starve the `/global/health` fallback.
	for (const path of ["/health", "/global/health"]) {
		const controller = new AbortController()
		const timeout = setTimeout(() => controller.abort(), timeoutMs)
		try {
			const url = new URL(path, serverUrl).toString()
			const response = await fetchImplementation(url, { signal: controller.signal }).catch(() => null)
			if (response?.ok) return true
		} finally {
			clearTimeout(timeout)
		}
	}
	return false
}

export function resetServerCheck(): void {
	serverAvailable = null
	serverCheckUrl = null
	delete (globalThis as Record<symbol, boolean>)[SERVER_RUNNING_KEY]
}
