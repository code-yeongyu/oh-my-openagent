import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { markExhaustedProviderOnQuotaError } from "./quota-provider-marker"
import * as exhaustedProvidersCache from "../../shared/exhausted-providers-cache"

describe("markExhaustedProviderOnQuotaError", () => {
	let markSpy: ReturnType<typeof spyOn> | undefined

	afterEach(() => {
		markSpy?.mockRestore()
	})

	describe("#given a quota_exceeded error", () => {
		test("#then marks the provider extracted from the event model", () => {
			markSpy = spyOn(exhaustedProvidersCache, "markProviderExhausted")

			markExhaustedProviderOnQuotaError(new Error("out of credits"), "kimi-for-coding/kimi-k3")

			expect(markSpy).toHaveBeenCalledWith("kimi-for-coding", "quota_exceeded")
		})
	})

	describe("#given a non-quota error", () => {
		test("#then does not mark any provider", () => {
			markSpy = spyOn(exhaustedProvidersCache, "markProviderExhausted")

			markExhaustedProviderOnQuotaError(new Error("connection error"), "kimi-for-coding/kimi-k3")

			expect(markSpy).not.toHaveBeenCalled()
		})
	})

	describe("#given a quota error without model info", () => {
		test("#then does not mark any provider", () => {
			markSpy = spyOn(exhaustedProvidersCache, "markProviderExhausted")

			markExhaustedProviderOnQuotaError(new Error("out of credits"), undefined)

			expect(markSpy).not.toHaveBeenCalled()
		})
	})
})
