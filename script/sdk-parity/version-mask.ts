import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import type { Outcome } from "./scenario-run"

// Design 7.4 (version mask): a release or an engine pin bump changes the version a CLI prints, and nothing else. Before
// the base-versus-head comparison each tree's outcome has ITS OWN declared versions replaced with fixed placeholders:
// the omo package version from that tree's packages/omo-native/package.json and the engine version from that tree's pin of
// @code-yeongyu/senpi there. Only those exact strings are replaced, never a pattern, so a version a tree does not declare
// stays in its output and fails the comparison, and any other difference still fails. The goldens stay unmasked.

export type DeclaredVersions = { readonly omo: string; readonly engine: string }

const MANIFEST = "packages/omo-native/package.json"
const ENGINE_PACKAGE = "@code-yeongyu/senpi"
const OMO_PLACEHOLDER = "<OMO_VERSION>"
const ENGINE_PLACEHOLDER = "<ENGINE_VERSION>"

// undefined only for a tree that predates the native package (an old merge base); that side is then compared unmasked.
export function readDeclaredVersions(tree: string): DeclaredVersions | undefined {
  if (!existsSync(join(tree, MANIFEST))) return undefined
  const manifest = JSON.parse(readFileSync(join(tree, MANIFEST), "utf8")) as {
    readonly version: string
    readonly dependencies: Readonly<Record<string, string>>
  }
  const engine = manifest.dependencies[ENGINE_PACKAGE]
  if (engine === undefined) throw new Error(`${MANIFEST} in ${tree} does not pin ${ENGINE_PACKAGE}`)
  return { omo: manifest.version, engine }
}

const masked = (outcome: Outcome, versions: DeclaredVersions): string =>
  [
    [versions.engine, ENGINE_PLACEHOLDER],
    [versions.omo, OMO_PLACEHOLDER],
  ]
    .toSorted(([a = ""], [b = ""]) => b.length - a.length)
    .reduce((text, [from = "", to = ""]) => text.split(from).join(to), JSON.stringify(outcome))

// Whether the two outcomes are equal once each tree's own declared versions are masked. An outcome that already carries
// a placeholder is never masked, so a tree cannot print the placeholder text to pass as the other tree's version.
export function equalUnderVersionMask(
  before: Outcome,
  after: Outcome,
  versions: { readonly base: DeclaredVersions; readonly head: DeclaredVersions },
): boolean {
  const raw = [JSON.stringify(before), JSON.stringify(after)]
  if (raw.some((text) => text.includes(OMO_PLACEHOLDER) || text.includes(ENGINE_PLACEHOLDER))) return false
  return masked(before, versions.base) === masked(after, versions.head)
}
