export interface ProviderRoute {
  providerId: string
  baseUrl: string
  modelName: string
  priority: number
  weight: number  // 0-100, for load balancing
}

export interface ProviderConfig {
  id: string
  label: string
  baseUrl: string
  apiKeyEnv: string
  models: string[]
  maxConcurrency: number
  weight: number
}
