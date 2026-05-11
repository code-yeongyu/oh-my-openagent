export * from "./types"
export {
  getSessionAliasStoragePath,
  readAliasFile,
  writeAliasFileAtomic,
  mutateAliasFile,
  acquireFileLock,
} from "./storage"
export {
  createAlias,
  deleteAlias,
  listAliases,
  getAliasEntry,
  resolveSessionIdentifier,
  validateAliasName,
  validateSessionId,
  validateNote,
  normalizeAlias,
} from "./manager"
export type {
  CreateAliasInput,
  CreateAliasResult,
  DeleteAliasResult,
  ManagerOptions,
} from "./manager"
