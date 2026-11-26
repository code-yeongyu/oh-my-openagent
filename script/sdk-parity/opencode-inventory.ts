import type { Command } from "commander"

// Inventory (2) of design section 7.1: the OpenCode edition's Commander program walked at run time. Every command,
// alias, option (root options included) and hidden route is one route; the registry must name each, and nothing else.
// login, logout and whoami are registered in two shapes (accounts open, accounts closed with hidden routes), so both
// shapes are walked from the service-auth program factory and the main program's copy is not counted twice.

export type CommanderRoute = {
  readonly route: readonly string[]
  readonly hidden: boolean
  readonly flags: readonly string[]
}

const isHidden = (command: Command): boolean => Reflect.get(command, "_hidden") === true

function walkCommander(command: Command, prefix: readonly string[] = []): CommanderRoute[] {
  const routes: CommanderRoute[] = []
  for (const child of command.commands) {
    const hidden = isHidden(child)
    for (const name of [child.name(), ...child.aliases()]) {
      const route = [...prefix, name]
      const flags = child.options.flatMap((option) => [option.short, option.long].filter((flag) => flag !== undefined))
      routes.push({ route, hidden, flags: flags.toSorted() })
      routes.push(...walkCommander(child, route))
    }
  }
  return routes
}

function rootFlags(command: Command): string[] {
  return command.options
    .flatMap((option) => [option.short, option.long].filter((flag) => flag !== undefined))
    .toSorted()
}

const SERVICE_AUTH = new Set(["login", "logout", "whoami"])

export type OpencodeInventory = { readonly routes: readonly CommanderRoute[]; readonly root: readonly string[] }

export async function opencodeInventory(): Promise<OpencodeInventory> {
  const { cliProgram } = await import("../../packages/omo-opencode/src/cli/cli-program")
  const { serviceAuthProgram } = await import("../../packages/omo-opencode/src/cli/service-auth/commands")
  const main = walkCommander(cliProgram).filter((route) => !SERVICE_AUTH.has(route.route[0] ?? ""))
  const auth = [true, false].flatMap((open) => walkCommander(serviceAuthProgram(open)))
  const merged = new Map<string, CommanderRoute>()
  for (const route of [...main, ...auth]) {
    const key = route.route.join(" ")
    const previous = merged.get(key)
    merged.set(key, {
      route: route.route,
      hidden: (previous?.hidden ?? true) && route.hidden,
      flags: [...new Set([...(previous?.flags ?? []), ...route.flags])].toSorted(),
    })
  }
  return {
    routes: [...merged.values()].toSorted((a, b) => a.route.join(" ").localeCompare(b.route.join(" "))),
    root: rootFlags(cliProgram),
  }
}
