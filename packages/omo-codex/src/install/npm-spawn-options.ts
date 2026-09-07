// npm is npm.cmd on Windows, and Node's spawn does not apply PATHEXT without a shell, so
// spawnSync("npm", ...) dies there with "spawnSync npm ENOENT" and reports status null rather than a
// non-zero exit. script/npm-invocation.mjs holds the same branch for the repo scripts; the installer
// bundle cannot reach that module graph, so the shipped copy lives here.
export function npmSpawnOptions(platform: NodeJS.Platform = process.platform): { readonly shell?: true } {
  return platform === "win32" ? { shell: true } : {}
}
