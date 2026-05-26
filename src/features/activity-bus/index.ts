export * from "./types";
import { ActivityBus, createActivityBus } from "./activity-bus";
export { ActivityBus, createActivityBus };

let globalActivityBus: ActivityBus | null = null

export function getGlobalActivityBus(): ActivityBus {
  if (!globalActivityBus) {
    globalActivityBus = createActivityBus()
  }
  return globalActivityBus
}

export function setGlobalActivityBus(bus: ActivityBus): void {
  globalActivityBus = bus
}
