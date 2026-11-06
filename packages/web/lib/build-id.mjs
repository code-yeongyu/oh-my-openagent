/**
 * The Next build id names `/_next/static/<id>/`, the directory holding `_buildManifest.js`, `_ssgManifest.js` and
 * `_clientMiddlewareManifest.js`. The asset-retention guard treats every `/_next/static/` path as content-addressed,
 * so one id must always name one set of bytes: the id is the commit being built. Next's `deploymentId` is not used,
 * because with it Next gives every build the same constant id, and those files then change bytes under one path.
 */
const COMMIT = /^[0-9a-f]{40}$/

export function resolveBuildId(env) {
  const sha = env.GITHUB_SHA ?? ""
  if (sha !== "") {
    if (!COMMIT.test(sha)) throw new Error(`GITHUB_SHA is not a full commit sha: ${sha}`)
    return sha
  }
  if (env.CI === "true") {
    throw new Error(
      "GITHUB_SHA is required in CI: it is the build id that names /_next/static/<id>/",
    )
  }
  // A local build outside CI: Next picks a random id, which is never deployed.
  return null
}

export function staticBuildDirectory(buildId) {
  return `/_next/static/${buildId}/`
}
