import { classifyErrorType } from "./error-classifier"
import * as exhaustedProvidersCache from "../../shared/exhausted-providers-cache"

/**
 * Marks the provider of the failing session model as exhausted when the error
 * classifies as quota_exceeded. The persistent exhausted-providers cache then
 * filters that provider out of delegate-task model selection.
 */
export function markExhaustedProviderOnQuotaError(error: unknown, eventModel: string | undefined): void {
	if (classifyErrorType(error) !== "quota_exceeded") return
	if (!eventModel) return

	const providerID = eventModel.split("/")[0]
	if (!providerID) return

	exhaustedProvidersCache.markProviderExhausted(providerID, "quota_exceeded")
}
