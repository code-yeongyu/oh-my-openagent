/**
 * The release-state PR, recognised by what ONLY publish.yml writes (#10709): the branch
 * `release/v<version>-source-state`, the title `release: v<version>` and a body that starts with
 * `Automated release-state PR for v<version>.`, all naming the same version. A `release/*` branch alone,
 * or the release account alone, is not enough.
 */
const TITLE = /^release: v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/

export type ReleasePrFacts = { readonly branch: string; readonly title: string; readonly body: string }

export function isReleaseStatePr(facts: ReleasePrFacts): boolean {
  const version = TITLE.exec(facts.title)?.[1]
  if (version === undefined) return false
  return facts.branch === `release/v${version}-source-state` && facts.body.startsWith(`Automated release-state PR for v${version}.`)
}
