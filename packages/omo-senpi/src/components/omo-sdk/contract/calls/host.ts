import { instantCall, valueCall } from "../call-spec"
import * as input from "../inputs/host"
import * as oc from "../inputs/opencode"
import type * as result from "../results/host"
import type * as ocResult from "../results/opencode"

// The config, daemon, diagnostics, install, boulder, worktrees and toolkit calls (first-party design 6.7, 6.11).
export const HOST_CALLS = {
  "config.status": valueCall<result.ConfigStatus>()(input.ConfigStatus),
  "config.migrate": valueCall<ocResult.ConfigMigrated>()(input.ConfigMigrate),
  "config.modelCapabilities.refresh": valueCall<ocResult.ModelCapabilitiesRefreshed>()(
    input.ConfigModelCapabilitiesRefresh,
  ),
  "daemon.run": valueCall<result.DaemonRun>()(input.DaemonRun),
  "daemon.ensure": valueCall<result.DaemonEnsure>()(input.DaemonEnsure),
  "daemon.warm": valueCall<result.WarmAnswer>()(input.DaemonWarm),
  "daemon.status": valueCall<result.DaemonStatus>()(input.DaemonStatus),
  "daemon.stop": valueCall<result.DaemonStop>()(input.DaemonStop),
  "daemon.stopAll": valueCall<result.DaemonStopAll>()(input.DaemonStopAll),
  "daemon.handoff": valueCall<result.DaemonHandoff>()(input.DaemonHandoff),
  "daemon.gc": valueCall<result.DaemonGc>()(input.DaemonGc),
  "daemon.rollbackPrepare": valueCall<result.DaemonRollbackPrepare>()(input.DaemonRollbackPrepare),
  "daemon.shardPath": instantCall<result.DaemonShardPath>()(input.DaemonShardPath),
  "diagnostics.run": valueCall<result.Diagnostics>()(input.DiagnosticsRun),
  "diagnostics.models": valueCall<result.Diagnostics>()(input.DiagnosticsModels),
  "diagnostics.fixReflectionLock": valueCall<result.FixReflectionLock>()(input.DiagnosticsFixReflectionLock),
  "diagnostics.reapStaleEngines": valueCall<result.ReapStaleEngines>()(input.DiagnosticsReapStaleEngines),
  "install.setup.detect": valueCall<result.SetupInventory>()(input.InstallSetupDetect),
  "install.setup.plan": valueCall<result.SetupPlan>()(input.InstallSetupPlan),
  "install.setup.apply": valueCall<result.SetupApplied>()(input.InstallSetupApply),
  "install.update": valueCall<result.InstallUpdate>()(input.InstallUpdate),
  "install.version": instantCall<result.InstallVersion>()(input.InstallVersion),
  "install.sdkRoot": instantCall<result.SdkRoot>()(input.InstallSdkRoot),
  "install.plugin": valueCall<ocResult.PluginInstalled>()(oc.InstallPlugin),
  "install.cleanup": valueCall<ocResult.Cleanup>()(oc.InstallCleanup),
  "install.localVersion": valueCall<ocResult.LocalVersion>()(oc.InstallLocalVersion),
  "boulder.status": valueCall<ocResult.BoulderStatus>()(oc.BoulderStatus),
  "worktrees.sweep": valueCall<ocResult.WorktreeSweep>()(oc.WorktreesSweep),
  "toolkit.help": instantCall<ocResult.ToolkitHelp>()(oc.ToolkitHelp),
} as const
