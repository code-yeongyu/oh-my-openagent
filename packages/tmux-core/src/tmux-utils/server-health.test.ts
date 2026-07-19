import { describe, expect, it } from "bun:test"

import {
	createServerHealthStateForTesting,
	isServerRunning,
	resetServerCheck,
} from "./server-health"

type FetchCall = readonly [input: RequestInfo | URL, init: RequestInit | undefined]

type Deferred<T> = {
	readonly promise: Promise<T>
	resolve(value: T): void
}

function createDeferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise
	})
	return { promise, resolve }
}

function createFetchRecorder(
	responseFactory: (call: FetchCall, index: number) => Promise<Response>,
): typeof fetch & { readonly calls: FetchCall[] } {
	const calls: FetchCall[] = []
	const implementation = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		const call = [input, init] as const
		calls.push(call)
		return responseFactory(call, calls.length - 1)
	}
	return Object.assign(implementation, { calls }) as typeof fetch & { readonly calls: FetchCall[] }
}

describe("isServerRunning request policy", () => {
	async function runStaleSuccessScenario(useInjectedState: boolean): Promise<void> {
		const state = useInjectedState ? createServerHealthStateForTesting() : undefined
		const firstResponse = createDeferred<Response>()
		const observedTokens: Array<string | null> = []
		let firstPolicyContacts = 0
		const fetchImplementation = createFetchRecorder(async ([, init]) => {
			const token = new Headers(init?.headers).get("authorization")
			observedTokens.push(token)
			if (token === "Bearer first-policy-fixture") {
				firstPolicyContacts += 1
				if (firstPolicyContacts === 1) return firstResponse.promise
				return new Response(null, { status: 200 })
			}
			return new Response(null, { status: 401 })
		})
		const serverUrl = "http://127.0.0.1:4321"

		if (!useInjectedState) resetServerCheck()
		try {
			const firstCheck = isServerRunning(serverUrl, {
				fetchImplementation,
				headers: { Authorization: "Bearer first-policy-fixture" },
				state,
			})
			const rotatedCheck = isServerRunning(serverUrl, {
				fetchImplementation,
				headers: { Authorization: "Bearer rotated-policy-fixture" },
				state,
			})
			const rotatedResult = await rotatedCheck
			firstResponse.resolve(new Response(null, { status: 200 }))
			const firstResult = await firstCheck

			expect([firstResult, rotatedResult]).toEqual([false, false])
			expect(state?.serverAvailable).not.toBe(true)
			expect(observedTokens).toEqual([
				"Bearer first-policy-fixture",
				"Bearer rotated-policy-fixture",
				"Bearer rotated-policy-fixture",
			])

			const recheckedFirst = await isServerRunning(serverUrl, {
				fetchImplementation,
				headers: { Authorization: "Bearer first-policy-fixture" },
				state,
			})
			expect(recheckedFirst).toBe(true)
			expect(observedTokens).toEqual([
				"Bearer first-policy-fixture",
				"Bearer rotated-policy-fixture",
				"Bearer rotated-policy-fixture",
				"Bearer first-policy-fixture",
			])
		} finally {
			firstResponse.resolve(new Response(null, { status: 500 }))
			if (!useInjectedState) resetServerCheck()
		}
	}

	it("#given custom headers #when health is checked #then it sends them and requests redirect rejection by default", async () => {
		// given
		const fetchImplementation = createFetchRecorder(async () => new Response(null, { status: 200 }))
		const headers = {
			"X-Client-Id": "client-fixture",
			"X-Request-Token": "token-fixture",
		}

		// when
		const result = await isServerRunning("http://127.0.0.1:4321/api?source=test", {
			fetchImplementation,
			headers,
			state: createServerHealthStateForTesting(),
		})

		// then
		expect(result).toBe(true)
		expect(fetchImplementation.calls).toHaveLength(1)
		const [input, init] = fetchImplementation.calls[0] ?? []
		expect(input?.toString()).toBe("http://127.0.0.1:4321/global/health")
		expect(new Headers(init?.headers)).toEqual(new Headers(headers))
		expect(init?.redirect).toBe("error")
	})

	it("#given equivalent URLs and canonical headers #when health succeeds #then the normalized request policy is cached", async () => {
		// given
		const state = createServerHealthStateForTesting()
		const fetchImplementation = createFetchRecorder(async () => new Response(null, { status: 200 }))

		// when
		await isServerRunning("http://127.0.0.1:4321/first?one=1", {
			fetchImplementation,
			headers: [["X-Zeta", "last"], ["X-Alpha", "first"]],
			state,
		})
		await isServerRunning("http://127.0.0.1:4321/second?two=2", {
			fetchImplementation,
			headers: { "x-alpha": "first", "x-zeta": "last" },
			state,
		})

		// then
		expect(fetchImplementation.calls).toHaveLength(1)
		expect(state.serverCheckUrl).toBe("http://127.0.0.1:4321/global/health")
	})

	it("#given a cached anonymous success #when request credentials rotate #then each request policy is probed", async () => {
		// given
		const state = createServerHealthStateForTesting()
		const observedTokens: Array<string | null> = []
		const fetchImplementation = createFetchRecorder(async ([, init]) => {
			observedTokens.push(new Headers(init?.headers).get("authorization"))
			return new Response(null, { status: 200 })
		})
		const serverUrl = "http://127.0.0.1:4321"

		// when
		const anonymousResult = await isServerRunning(serverUrl, { fetchImplementation, state })
		const firstCredentialResult = await isServerRunning(serverUrl, {
			fetchImplementation,
			headers: { Authorization: "Bearer first-credential-fixture" },
			state,
		})
		const rotatedCredentialResult = await isServerRunning(serverUrl, {
			fetchImplementation,
			headers: { Authorization: "Bearer rotated-credential-fixture" },
			state,
		})

		// then
		expect([anonymousResult, firstCredentialResult, rotatedCredentialResult]).toEqual([true, true, true])
		expect(observedTokens).toEqual([
			null,
			"Bearer first-credential-fixture",
			"Bearer rotated-credential-fixture",
		])
	})

	it("#given an injected state and a stale in-flight success #when a rotated policy fails #then the stale result cannot authorize a caller", async () => {
		await runStaleSuccessScenario(true)
	})

	it("#given global state and a stale in-flight success #when a rotated policy fails #then the stale result cannot authorize a caller", async () => {
		await runStaleSuccessScenario(false)
	})

	it("#given a policy is waiting to retry #when another policy becomes current #then the stale policy does not retry", async () => {
		// given
		const state = createServerHealthStateForTesting()
		const observedTokens: Array<string | null> = []
		let firstPolicyContacts = 0
		const fetchImplementation = createFetchRecorder(async ([, init]) => {
			const token = new Headers(init?.headers).get("authorization")
			observedTokens.push(token)
			if (token === "Bearer first-policy-fixture") {
				firstPolicyContacts += 1
				return new Response(null, { status: firstPolicyContacts === 1 ? 503 : 200 })
			}
			return new Response(null, { status: 200 })
		})

		// when
		const firstCheck = isServerRunning("http://127.0.0.1:4321", {
			fetchImplementation,
			headers: { Authorization: "Bearer first-policy-fixture" },
			state,
		})
		await new Promise((resolve) => setTimeout(resolve, 10))
		const rotatedResult = await isServerRunning("http://127.0.0.1:4321", {
			fetchImplementation,
			headers: { Authorization: "Bearer rotated-policy-fixture" },
			state,
		})
		const firstResult = await firstCheck

		// then
		expect([firstResult, rotatedResult]).toEqual([false, true])
		expect(observedTokens).toEqual([
			"Bearer first-policy-fixture",
			"Bearer rotated-policy-fixture",
		])
	})

	it("#given an ABA policy sequence #when the first policy becomes current again #then authority follows semantic identity", async () => {
		// given
		const state = createServerHealthStateForTesting()
		const firstAResponse = createDeferred<Response>()
		const bResponse = createDeferred<Response>()
		const secondAResponse = createDeferred<Response>()
		const observedTokens: Array<string | null> = []
		let aContacts = 0
		const fetchImplementation = createFetchRecorder(async ([, init]) => {
			const token = new Headers(init?.headers).get("authorization")
			observedTokens.push(token)
			if (token === "Bearer policy-a-fixture") {
				aContacts += 1
				return aContacts === 1 ? firstAResponse.promise : secondAResponse.promise
			}
			return bResponse.promise
		})

		// when
		const firstA = isServerRunning("http://127.0.0.1:4321", {
			fetchImplementation,
			headers: { Authorization: "Bearer policy-a-fixture" },
			state,
		})
		const policyB = isServerRunning("http://127.0.0.1:4321", {
			fetchImplementation,
			headers: { Authorization: "Bearer policy-b-fixture" },
			state,
		})
		const secondA = isServerRunning("http://127.0.0.1:4321", {
			fetchImplementation,
			headers: { Authorization: "Bearer policy-a-fixture" },
			state,
		})
		firstAResponse.resolve(new Response(null, { status: 200 }))
		secondAResponse.resolve(new Response(null, { status: 200 }))
		bResponse.resolve(new Response(null, { status: 200 }))
		const results = await Promise.all([firstA, policyB, secondA])

		// then
		expect(results).toEqual([true, false, true])
		expect(observedTokens).toEqual([
			"Bearer policy-a-fixture",
			"Bearer policy-b-fixture",
			"Bearer policy-a-fixture",
		])
		expect(state.serverAvailable).toBe(true)
	})

	it("#given a successful manual-redirect policy #when redirect mode changes #then the cache is isolated", async () => {
		// given
		const state = createServerHealthStateForTesting()
		const redirects: Array<RequestInit["redirect"]> = []
		const fetchImplementation = createFetchRecorder(async ([, init]) => {
			redirects.push(init?.redirect)
			return new Response(null, { status: 200 })
		})

		// when
		await isServerRunning("http://127.0.0.1:4321", { fetchImplementation, redirect: "manual", state })
		await isServerRunning("http://127.0.0.1:4321/path", { fetchImplementation, redirect: "error", state })
		await isServerRunning("http://127.0.0.1:4321/other", { fetchImplementation, state })

		// then
		expect(redirects).toEqual(["manual", "error"])
	})

	it("#given secret-bearing headers #when a successful policy is cached #then serialized state contains only an opaque identity", async () => {
		// given
		const state = createServerHealthStateForTesting()
		const secret = "state-secret-fixture"
		const fetchImplementation = createFetchRecorder(async () => new Response(null, { status: 200 }))

		// when
		await isServerRunning("http://127.0.0.1:4321", {
			fetchImplementation,
			headers: { "X-Secret": secret },
			state,
		})

		// then
		const serializedState = JSON.stringify(state)
		expect(serializedState).not.toContain(secret)
		expect(state.serverCheckPolicyId).toMatch(/^[a-f0-9]{64}$/)
	})

	it("#given failed health responses #when the same policy is retried later #then failures are not cached", async () => {
		// given
		const state = createServerHealthStateForTesting()
		const fetchImplementation = createFetchRecorder(async () => new Response(null, { status: 503 }))

		// when
		const first = await isServerRunning("http://127.0.0.1:4321", { fetchImplementation, state })
		const second = await isServerRunning("http://127.0.0.1:4321", { fetchImplementation, state })

		// then
		expect([first, second]).toEqual([false, false])
		expect(fetchImplementation.calls).toHaveLength(4)
	})

	it("#given a redirecting source #when default health is checked #then the request rejects redirects without forwarding authorization", async () => {
		// given
		let targetContacts = 0
		const sourceCalls: FetchCall[] = []
		const fetchImplementation = createFetchRecorder(async (call) => {
			const [input, init] = call
			if (new URL(input.toString()).pathname === "/redirect-target") {
				targetContacts += 1
				return new Response(null, { status: 200 })
			}

			sourceCalls.push(call)
			if (init?.redirect === "error") {
				throw new TypeError("redirect rejected")
			}

			return new Response(null, {
				status: 302,
				headers: { Location: "http://127.0.0.1:4321/redirect-target" },
			})
		})

		// when
		const result = await isServerRunning("http://127.0.0.1:4321/source", {
			fetchImplementation,
			state: createServerHealthStateForTesting(),
		})

		// then
		expect(result).toBe(false)
		expect(sourceCalls).toHaveLength(2)
		expect(sourceCalls.every(([, init]) => init?.redirect === "error")).toBe(true)
		expect(sourceCalls.every(([, init]) => new Headers(init?.headers).get("authorization") === null)).toBe(true)
		expect(targetContacts).toBe(0)
	})

})
