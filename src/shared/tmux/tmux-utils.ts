export {
  isInsideTmux,
  getCurrentPaneId,
  isTmuxPaneControlAvailable,
} from "./tmux-utils/environment"
export type { SplitDirection } from "./tmux-utils/environment"

export {
  resolveMultiplexerRuntime,
  resolveMultiplexerFromProbes,
  createDisabledMultiplexerRuntime,
  setResolvedMultiplexerRuntime,
  getResolvedMultiplexerRuntime,
  resetResolvedMultiplexerRuntimeForTesting,
} from "./tmux-utils/multiplexer-runtime"
export type {
  MultiplexerMode,
  PaneBackend,
  NotificationBackend,
  ResolvedTmuxRuntime,
  ResolvedCmuxRuntime,
  ResolvedMultiplexer,
  ResolveMultiplexerRuntimeOptions,
} from "./tmux-utils/multiplexer-runtime"

export { isServerRunning, resetServerCheck, markServerRunningInProcess } from "./tmux-utils/server-health"

export { getPaneDimensions } from "./tmux-utils/pane-dimensions"
export type { PaneDimensions } from "./tmux-utils/pane-dimensions"

export { spawnTmuxPane } from "./tmux-utils/pane-spawn"
export { closeTmuxPane } from "./tmux-utils/pane-close"
export { replaceTmuxPane } from "./tmux-utils/pane-replace"

export { applyLayout, enforceMainPaneWidth } from "./tmux-utils/layout"
