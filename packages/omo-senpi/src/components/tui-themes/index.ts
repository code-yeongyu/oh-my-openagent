import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"

import type { ComponentContext, OmoSenpiComponent, SenpiExtensionAPI } from "../../extension/types"

export const TUI_THEMES_COMPONENT_NAME = "tui-themes"

/** Theme names this package ships; kept in sync with `plugin/themes/*.json` by `shipped-themes.test.ts`. */
export const BUNDLED_THEME_NAMES = ["omo-catppuccin", "omo-catppuccin-latte"] as const

export interface TuiThemesComponentOptions {
  /** Overrides the packaged themes root; tests point it at a fixture. */
  readonly themesDir?: string
}

/**
 * Contributes the package's TUI themes through `resources_discover` `themePaths`.
 *
 * The launcher always loads the plugin with `--extension <plugin>`, and senpi only folds a
 * package manifest's `themes/` directory in for packages declared under `settings.packages`. An
 * extension-contributed `themePaths` entry is discovered on every install path, so the omo themes
 * are selectable from `/settings` whether the plugin was installed locally or shipped inside the
 * published `omo-ai` payload.
 *
 * This component only publishes the themes; it never selects one. Picking a theme writes the user's
 * `settings.json`, and a plugin must not write user settings on startup. Selection stays with
 * `/settings`, the shell the engine already owns.
 */
export function createTuiThemesComponent(options: TuiThemesComponentOptions = {}): OmoSenpiComponent {
  return {
    name: TUI_THEMES_COMPONENT_NAME,
    register(pi: SenpiExtensionAPI, _ctx: ComponentContext): void {
      pi.on("resources_discover", () => {
        const themesDir = options.themesDir ?? resolveBundledThemesDir()
        if (themesDir === undefined || !existsSync(themesDir)) return undefined
        return { themePaths: [themesDir] }
      })
    },
  }
}

/**
 * Packaged themes win; the source-tree copy keeps dev runs working. From the bundled extension at
 * plugin/extensions/omo.js the first candidate resolves to plugin/themes; from this source file the
 * second resolves to the same packaged directory.
 */
export function resolveBundledThemesDir(importerUrl: string = import.meta.url): string | undefined {
  const candidates = [
    fileURLToPath(new URL("../themes", importerUrl)),
    fileURLToPath(new URL("../../../plugin/themes", importerUrl)),
  ]
  return candidates.find((candidate) => existsSync(candidate))
}
