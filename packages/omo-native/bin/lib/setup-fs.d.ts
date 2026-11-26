/** The file-system effects and named reads `omo setup`'s stages make; see setup-fs.js. */
export type SetupFs = {
  readonly read: (path: string) => string | undefined
  readonly mkdir: (path: string, options?: { recursive?: boolean; mode?: number }) => void
  readonly writeFile: (path: string, data: string, options?: { encoding?: BufferEncoding; mode?: number }) => void
  readonly copyFile: (from: string, to: string, options?: { exclusive?: boolean }) => void
  readonly copyTree: (from: string, to: string) => void
  readonly rename: (from: string, to: string) => void
  readonly remove: (path: string) => void
  readonly chmod: (path: string, mode: number) => void
  readonly mode: (path: string) => number
}

export const REAL_SETUP_FS: SetupFs
