export type ProviderListResponse = { data?: { connected?: string[] } }
export type ModelListResponse = {
	data?: Array<{ id?: string; provider?: string }>
}

export type ProviderListFunction = () => Promise<ProviderListResponse>
export type ModelListFunction = () => Promise<ModelListResponse>
