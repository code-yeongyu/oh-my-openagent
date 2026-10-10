import type { ProviderConfig, ProviderRoute } from "./types"

export class MultiProviderRouter {
  private providers: ProviderConfig[] = []

  constructor(providers: ProviderConfig[] = []) {
    this.providers = providers
  }

  addProvider(config: ProviderConfig): void {
    this.providers.push(config)
  }

  getRoutesForModel(modelName: string): ProviderRoute[] {
    const routes: ProviderRoute[] = []
    for (let i = 0; i < this.providers.length; i++) {
      const p = this.providers[i]
      if (p.models.includes(modelName) || p.models.includes("*")) {
        routes.push({
          providerId: p.id,
          baseUrl: p.baseUrl,
          modelName,
          priority: routes.length,
          weight: p.weight,
        })
      }
    }
    return routes.sort((a, b) => a.priority - b.priority)
  }

  selectOptimalRoute(modelName: string): ProviderRoute | null {
    const routes = this.getRoutesForModel(modelName)
    if (routes.length === 0) return null

    const totalWeight = routes.reduce((s, r) => s + r.weight, 0)
    if (totalWeight === 0) return routes[0]

    let roll = Math.random() * totalWeight
    for (const route of routes) {
      roll -= route.weight
      if (roll <= 0) return route
    }
    return routes[routes.length - 1]
  }
}
