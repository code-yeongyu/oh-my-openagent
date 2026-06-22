import { createInjectedPathsStorage } from "../../shared/session-injected-paths";
import { README_INJECTOR_STORAGE } from "./constants";

export const {
  loadInjectedPaths,
  saveInjectedPaths,
  clearInjectedPaths,
} = createInjectedPathsStorage(README_INJECTOR_STORAGE);
