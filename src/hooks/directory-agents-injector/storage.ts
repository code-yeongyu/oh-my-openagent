import { createInjectedPathsStorage } from "../../shared/session-injected-paths";
import { AGENTS_INJECTOR_STORAGE } from "./constants";

export const {
  loadInjectedPaths,
  saveInjectedPaths,
  clearInjectedPaths,
} = createInjectedPathsStorage(AGENTS_INJECTOR_STORAGE);
