import { createHmac, randomBytes } from "node:crypto"

let serverAvailable: boolean | null = null
let serverCheckUrl: string | null = null
let serverCheckPolicyId: string | null = null

const REQUEST_POLICY_HMAC_KEY = randomBytes(32)

type RequestHeaders = RequestInit["headers"]
type RedirectMode = NonNullable<RequestInit["redirect"]>

export type ServerHealthState = {
	serverAvailable: boolean | null
	serverCheckUrl: string | null
	serverCheckPolicyId?: string | null
}

export type IsServerRunningOptions = {
	headers?: RequestHeaders
	redirect?: RedirectMode
	fetchImplementation?: typeof fetch
	state?: ServerHealthState
}

function delay(milliseconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function canonicalizeHeaders(headers: RequestHeaders): ReadonlyArray<readonly [string, string]> {
	const entries: Array<readonly [string, string]> = []
	new Headers(headers).forEach((value, name) => entries.push([name, value]))
	return entries.sort(([leftName, leftValue], [rightName, rightValue]) => {
		if (leftName !== rightName) return leftName < rightName ? -1 : 1
		return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0
	})
}

function createRequestPolicyId(headers: RequestHeaders, redirect: RedirectMode): string {
	const canonicalPolicy = JSON.stringify({
		headers: canonicalizeHeaders(headers),
		redirect,
	})
	return createHmac("sha256", REQUEST_POLICY_HMAC_KEY).update(canonicalPolicy, "utf8").digest("hex")
}

export function createServerHealthState(): ServerHealthState {
	return {
		serverAvailable: null,
		serverCheckUrl: null,
		serverCheckPolicyId: null,
	}
}

export const createServerHealthStateForTesting = createServerHealthState

export async function isServerRunning(serverUrl: string, options: IsServerRunningOptions = {}): Promise<boolean> {
	const fetchImplementation = options.fetchImplementation ?? fetch
	const healthUrl = new URL("/global/health", serverUrl).toString()
	const redirect = options.redirect ?? "error"
	const requestPolicyId = createRequestPolicyId(options.headers, redirect)
	const cachedUrl = options.state ? options.state.serverCheckUrl : serverCheckUrl
	const cachedAvailable = options.state ? options.state.serverAvailable : serverAvailable
	const cachedPolicyId = options.state ? options.state.serverCheckPolicyId : serverCheckPolicyId
	if (cachedUrl === healthUrl && cachedPolicyId === requestPolicyId && cachedAvailable === true) {
		return true
	}

	if (options.state) {
		options.state.serverCheckUrl = healthUrl
		options.state.serverCheckPolicyId = requestPolicyId
		options.state.serverAvailable = false
	} else {
		serverCheckUrl = healthUrl
		serverCheckPolicyId = requestPolicyId
		serverAvailable = false
	}

	const timeoutMs = 3000
	const maxAttempts = 2

	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		const controller = new AbortController()
		const timeout = setTimeout(() => controller.abort(), timeoutMs)

		try {
			const response = await fetchImplementation(healthUrl, {
				headers: options.headers,
				redirect,
				signal: controller.signal,
			}).catch(() => null)

			if (response?.ok) {
				if (options.state) {
					if (
						options.state.serverCheckUrl === healthUrl &&
						options.state.serverCheckPolicyId === requestPolicyId
					) {
						options.state.serverAvailable = true
					}
				} else if (serverCheckUrl === healthUrl && serverCheckPolicyId === requestPolicyId) {
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
	serverCheckPolicyId = null
}
