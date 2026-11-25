import {
  chmodSync,
  constants,
  copyFileSync,
  cpSync,
  existsSync,
  readFileSync,
  mkdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"

/**
 * The file-system effects `omo setup`'s stages make (slice C1c, #14960): every write, copy, rename, removal and mode
 * change goes through one of these, so a caller that passes its own (the SDK's scenario runs) sees each operation. The
 * real one is the default everywhere.
 *
 * Reads: only the scan's reads of OpenCode's files go through `read`: its auth.json (setup-detect.js readAuthJson, from
 * detect) and its config files (setup-opencode-assets.js readDocuments, from the asset scan). Every other read is still
 * direct: the rest of setup-detect.js, setup-credentials.js, setup-opencode-assets.js (skills), setup-opencode-models.js,
 * setup-opencode-providers.js, setup-model-choices-import.js, setup-providers-import.js, setup-assets-import.js,
 * auth-store.js and category-coverage.js. So a trace observed through this port shows that these reads happen, never
 * that only these reads happen.
 */
export const REAL_SETUP_FS = {
  /** @param {string} path @returns {string | undefined} the file's text, undefined when it does not exist */
  read: (path) => (existsSync(path) ? readFileSync(path, "utf8") : undefined),
  /** @param {string} path @param {{ recursive?: boolean, mode?: number }} [options] */
  mkdir: (path, options) => mkdirSync(path, options),
  /** @param {string} path @param {string} data @param {{ encoding?: BufferEncoding, mode?: number }} [options] */
  writeFile: (path, data, options) => writeFileSync(path, data, options),
  /** @param {string} from @param {string} to @param {{ exclusive?: boolean }} [options] */
  copyFile: (from, to, options) =>
    options?.exclusive === true ? copyFileSync(from, to, constants.COPYFILE_EXCL) : copyFileSync(from, to),
  /** @param {string} from @param {string} to */
  copyTree: (from, to) => cpSync(from, to, { recursive: true, force: false }),
  /** @param {string} from @param {string} to */
  rename: (from, to) => renameSync(from, to),
  /** @param {string} path */
  remove: (path) => {
    if (existsSync(path)) unlinkSync(path)
  },
  /** @param {string} path @param {number} mode */
  chmod: (path, mode) => chmodSync(path, mode),
  /** @param {string} path @returns {number} */
  mode: (path) => statSync(path).mode & 0o7777,
}
