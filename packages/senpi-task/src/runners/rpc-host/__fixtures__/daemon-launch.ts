import { join, resolve } from "node:path"
import type { DaemonLaunchSpec } from "../launch-spec"

/**
 * The ONE expectation fixture for `daemonLaunchOptions`.
 *
 * `omo daemon run` (packages/omo-native) and a child-triggered `ensureTaskDaemon` must produce a
 * byte-identical daemon launch, so both test suites import THIS module instead of writing their own
 * expected argv. A change here is a change to the daemon's launch contract and fails both suites.
 *
 * The spec below mirrors `packages/omo-senpi/plugin/daemon-launch-spec.json`; the launch-spec suite
 * proves the shipped file parses, this fixture proves what the shipped shape turns into.
 */
const SPEC_DIR = resolve("/opt/omo/plugin")

export const DAEMON_LAUNCH_SPEC_FIXTURE: DaemonLaunchSpec = {
  spec_version: 1,
  core: {
    session_runtime: "in-process",
    multi_session: true,
    extensions: [".", "./extensions/omo-member.js"],
  },
  tunables: { idleExitMs: 900_000, coldStart: "transient" },
  env: { OMO_NATIVE: "1" },
}

/**
 * A parent env carrying every name the daemon must NOT inherit, plus an idle-eviction window
 * SHORTER than the daemon's idle-exit window (so the raise is exercised rather than assumed).
 */
export const DAEMON_LAUNCH_PARENT_ENV_FIXTURE: Readonly<Record<string, string | undefined>> = {
  PATH: "/usr/bin",
  // A value the daemon's env must NOT carry: the spec is the whole producer, never a parent copy.
  ANTHROPIC_API_KEY: "fixture-not-a-real-key",
  OMO_SENPI_TASK_RPC_CHILD: "1",
  OMO_SENPI_TASK_DEPTH: "1",
  OMO_SENPI_TASK_ROOT_SESSION_ID: "root-session",
  SENPI_CODING_AGENT_SESSION_DIR: "/tmp/parent-session",
  SENPI_TASK_MEMBER: "11111111-1111-4111-8111-111111111111::builder",
  SENPI_TASK_MEMBER_TASK_ID: "t-1",
  SENPI_TASK_TEAM_CONFIG: "{}",
  OMO_WORKPOOL_STATE_DIR: "/tmp/workpool",
  OMO_WORKPOOL_TASK_ID: "t-2",
  SENPI_RPC_SESSION_IDLE_EVICTION_MS: "60000",
}

export const DAEMON_LAUNCH_FIXTURE = {
  specPath: join(SPEC_DIR, "daemon-launch-spec.json"),
  spec: DAEMON_LAUNCH_SPEC_FIXTURE,
  parentEnv: DAEMON_LAUNCH_PARENT_ENV_FIXTURE,
  idleExitMs: 900_000,
  expected: {
    hostArgs: [
      "--session-runtime",
      "in-process",
      "--extension",
      SPEC_DIR,
      "--extension",
      join(SPEC_DIR, "extensions", "omo-member.js"),
    ],
    env: {
      OMO_NATIVE: "1",
      OMO_SENPI_TASK_RPC_CHILD: null,
      OMO_SENPI_TASK_DEPTH: null,
      OMO_SENPI_TASK_ROOT_SESSION_ID: null,
      SENPI_CODING_AGENT_SESSION_DIR: null,
      SENPI_TASK_MEMBER: null,
      SENPI_TASK_MEMBER_TASK_ID: null,
      SENPI_TASK_TEAM_CONFIG: null,
      OMO_WORKPOOL_STATE_DIR: null,
      OMO_WORKPOOL_TASK_ID: null,
      SENPI_RPC_SESSION_IDLE_EVICTION_MS: "900000",
    },
    policy: { coldStart: "transient", idleExitMs: 900_000 },
    upgrade: "if-engine-differs",
  },
} as const
