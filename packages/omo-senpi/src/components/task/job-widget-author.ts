import type { OmoConfig } from "@oh-my-opencode/omo-config-core"
import { resolveCategory, type SenpiModelPort, type SenpiModelRegistryPort } from "@oh-my-opencode/senpi-task"

import type { JobWidgetAuthorContext, JobWidgetHostApi } from "./job-widget-host"

const JOB_WIDGET_AUTHOR_CATEGORY = "quick"

export function resolveJobWidgetAuthorModel(
  omoConfig: OmoConfig,
  registry: SenpiModelRegistryPort<SenpiModelPort>,
): SenpiModelPort | undefined {
  const resolution = resolveCategory(JOB_WIDGET_AUTHOR_CATEGORY, omoConfig, registry)
  return resolution.kind === "resolved" ? resolution.spec.model : undefined
}

type AuthorConfig = { readonly cwd: string; readonly omoConfig: OmoConfig }

type AuthorRoute = { readonly configs: AuthorConfig[]; withdraw: (() => void) | undefined }

// senpi keeps ONE author route per host while a shared daemon runs many sessions, each with the
// omo.json of its own project. Every registered session adds its config to its host's route; the route
// answers with the config of the session asking (matched by cwd) and leaves a session it does not know to
// senpi's fallback, the session model. The route is withdrawn when the last session on that host releases
// it. State is keyed by host (one per loaded senpi module, see readJobWidgetHost), so a second host never
// inherits or skips another host's route.
const routes = new WeakMap<JobWidgetHostApi, AuthorRoute>()

function routeAuthor(configs: readonly AuthorConfig[], ctx: JobWidgetAuthorContext): SenpiModelPort | undefined {
  const config = configs.findLast((entry) => entry.cwd === ctx.cwd)
  return config === undefined ? undefined : resolveJobWidgetAuthorModel(config.omoConfig, ctx.modelRegistry)
}

export function installJobWidgetAuthor(host: JobWidgetHostApi, cwd: string, omoConfig: OmoConfig): () => void {
  const setAuthorResolver = host.setAuthorResolver
  if (setAuthorResolver === undefined) return () => {}
  let route = routes.get(host)
  if (route === undefined) {
    route = { configs: [], withdraw: undefined }
    routes.set(host, route)
  }
  const config: AuthorConfig = { cwd, omoConfig }
  route.configs.push(config)
  const configs = route.configs
  route.withdraw ??= setAuthorResolver((ctx) => routeAuthor(configs, ctx))
  let released = false
  const owned = route
  return () => {
    if (released) return
    released = true
    owned.configs.splice(owned.configs.indexOf(config), 1)
    if (owned.configs.length > 0) return
    owned.withdraw?.()
    owned.withdraw = undefined
  }
}
