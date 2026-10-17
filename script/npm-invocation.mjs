// npm is npm.cmd on Windows, and Node's spawn does not apply PATHEXT without a shell, so
// execFileSync("npm", ...) dies with "spawnSync npm ENOENT" there. Every npm spawn in script/ takes
// its options from here so the platform branch lives in one place.
export function npmSpawnOptions(platform = process.platform) {
  return platform === "win32" ? { shell: true } : {}
}
