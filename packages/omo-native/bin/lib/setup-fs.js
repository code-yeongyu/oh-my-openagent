import {
  chmodSync,
  constants,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"

/**
 * The file-system effects `omo setup`'s stages make (slice C1c, #14960): every write, copy, rename, removal and mode
 * change goes through one of these, so a caller that passes its own (the SDK's scenario runs) sees each operation. The
 * real one is the default everywhere; reads stay direct.
 */
export const REAL_SETUP_FS = {
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
