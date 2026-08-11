import type { IdleInjectionCoordinator } from "./idle-injection-coordinator"
import { installToolCaptureRegistry } from "./tool-capture-registry"
import { createToolkitPathProvisioning } from "./toolkit-path-provisioning"
import type { ComponentContext, ComponentLogger, OmoOmpComponent, OmpExtensionAPI } from "./types"

export interface ComposeOmoOmpExtensionOptions {
  logger?: ComponentLogger
}

const REQUIRED_CAPABILITIES = [
  "on",
  "registerFlag",
  "getFlag",
  "registerTool",
  "registerCommand",
  "sendMessage",
  "sendUserMessage",
] as const

type RequiredCapability = (typeof REQUIRED_CAPABILITIES)[number]

const defaultLogger: ComponentLogger = {
  info(message, details) {
    console.info(message, details)
  },
  warn(message, details) {
    console.warn(message, details)
  },
  error(message, details) {
    console.error(message, details)
  },
}

function getMissingCapabilities(pi: unknown): RequiredCapability[] {
  if (typeof pi !== "object" || pi === null) {
    return [...REQUIRED_CAPABILITIES]
  }

  return REQUIRED_CAPABILITIES.filter((capability) => typeof Reflect.get(pi, capability) !== "function")
}

function isOmpExtensionAPI(pi: unknown): pi is OmpExtensionAPI {
  return getMissingCapabilities(pi).length === 0
}

export function composeOmoOmpExtension(
  components: readonly OmoOmpComponent[],
  options: ComposeOmoOmpExtensionOptions = {},
): (pi: unknown) => Promise<void> {
  const logger = options.logger ?? defaultLogger
  const provisionToolkitPath = createToolkitPathProvisioning({ logger })

  return async (pi: unknown): Promise<void> => {
    // Provision the in-session toolkit PATH/env at activation, before any component registers,
    // so component spawns resolve omo-agent-toolkit without global bins. Never throws.
    provisionToolkitPath()

    const missing = getMissingCapabilities(pi)
    if (missing.length > 0 || !isOmpExtensionAPI(pi)) {
      logger.warn("omo-omp ExtensionAPI version mismatch; extension disabled", {
        expected: [...REQUIRED_CAPABILITIES],
        missing,
      })
      return
    }

    pi.registerFlag("omo-omp-disabled", {
      type: "boolean",
      default: false,
      description: "Disable all omo-omp components.",
    })

    for (const component of components) {
      pi.registerFlag(componentDisabledFlag(component.name), {
        type: "boolean",
        default: false,
        description: `Disable the omo-omp ${component.name} component.`,
      })
    }

    if (pi.getFlag("omo-omp-disabled") === true) {
      logger.info("omo-omp disabled by flag")
      return
    }

    // Install the capture registry and idle coordinator BEFORE the component loop so every component
    // (lsp registers earlier than task) has its tools captured and shares one injection arbiter.
    const captureRegistry = installToolCaptureRegistry(pi)
    // The 200ms batch window: every delivered notification (completions, team messages, the ulw
    // continuation) defers its flush through this timer, so everything that becomes ready within the
    // window collapses into ONE steer injection instead of N separate ones.
    const idleCoordinator = new IdleInjectionCoordinator(
      (message, options) =>
        pi.sendMessage(message, { triggerTurn: true, deliverAs: options.deliverAs }),
      { scheduleFlush: (flush) => void setTimeout(flush, 200) },
    )

    const ctx: ComponentContext = {
      logger,
      config: {
        getFlag(name) {
          return pi.getFlag(name)
        },
      },
      getCapturedTools: () => captureRegistry.getCapturedTools(),
      idleCoordinator,
    }

    for (const component of components) {
      if (pi.getFlag(componentDisabledFlag(component.name)) === true) {
        logger.info("omo-omp component disabled by flag", { component: component.name })
        continue
      }

      try {
        await component.register(pi, ctx)
      } catch (error) {
        logger.error("omo-omp component registration failed", { component: component.name, error })
      }
    }
  }
}

function componentDisabledFlag(name: string): string {
  return `omo-omp-${name}-disabled`
}
