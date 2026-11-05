/*!
# License

OmO Device Service End-User License Agreement
SPDX-License-Identifier: LicenseRef-OmO-Device-Service-EULA

This repository and every artifact built from it (the OmO device service, also called the
relay daemon, in source or binary form) are proprietary work:

1. **Proprietary work**: all code, documentation, and other material in this repository,
   Copyright (c) 2026 Yeongyu Kim, proprietary — all rights reserved (see the End-User
   License below).
2. All third party components incorporated into this software are licensed under the original
   license provided by the owner of the applicable component.
3. The public `omo-ai` package is not covered by this agreement. It remains under its own
   Sustainable Use License and only downloads the closed artifact described here; nothing in
   this agreement changes that package's license. Notwithstanding anything else in this
   agreement, the compiled bunshin-ts and bunshin-ts-relay client libraries built from this
   software may be distributed with this agreement attached, as built or bundled into the build
   output of the omo-ai and omo-senpi packages, inside those packages and their source
   repositories; this permission covers only those copies and grants no other right.

## End-User License (proprietary)

Copyright (c) 2026 Yeongyu Kim. All rights reserved.

You may install and run the binary artifact of this software only as delivered to you by an
official OmO installer or downloaded from get.omo.dev, and only together with OmO.

Redistribution is permitted only inside official OmO installers and through get.omo.dev.
No other license is granted. Without the prior written permission of the copyright holder you
may not:

1. copy, publish, distribute, sublicense, sell, or otherwise redistribute the software or any
   artifact built from it separately from an official OmO installer or get.omo.dev;
2. modify, merge, adapt, translate, or create derivative works of the software; or
3. reverse engineer, decompile, disassemble, or otherwise attempt to derive the source code,
   protocols, or keys of the software, except to the extent applicable law expressly permits
   it notwithstanding this limitation.

Access to the source code, where granted, is provided solely for preparing contributions to
the Project (the omo-device-service software and its binaries distributed by Yeongyu Kim).
Contributions are governed by the Contributor License Agreement (CLA.md).

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED. IN NO EVENT
SHALL THE COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES, OR OTHER LIABILITY ARISING FROM
THE SOFTWARE OR ITS USE.
*/

// ../protocol/src/machine-lookup.ts
class MachineNotFoundError extends Error {
  lookup;
  constructor(lookup) {
    super(`machine not found: ${lookup}`);
    this.name = "MachineNotFoundError";
    this.lookup = lookup;
  }
}

class AmbiguousMachineLookupError extends Error {
  lookup;
  matches;
  constructor(lookup, matches) {
    super(`ambiguous machine lookup: ${lookup}`);
    this.name = "AmbiguousMachineLookupError";
    this.lookup = lookup;
    this.matches = matches;
  }
}

class CapabilityUnavailableError extends Error {
  machineId;
  capability;
  constructor(machineId, capability) {
    super(`capability unavailable on machine ${machineId}: ${capability}`);
    this.name = "CapabilityUnavailableError";
    this.machineId = machineId;
    this.capability = capability;
  }
}
// src/bunshin-nodes.ts
var attachBunshinMachinesAsNodes = async (options) => {
  const attached = [];
  const prefix = options.nodeIdPrefix ?? "bunshin:";
  for (const machine of await options.client.listMachines()) {
    const id = `${prefix}${machine.id}`;
    const node = new BunshinMachineNode(id, machine.id, options.client);
    await options.registry.attach(id, node);
    attached.push({ id, machineId: machine.id, alias: machine.alias, node });
  }
  return attached;
};

class BunshinMachineNode {
  id;
  machineId;
  client;
  constructor(id, machineId, client) {
    this.id = id;
    this.machineId = machineId;
    this.client = client;
  }
  async connect() {}
  async close() {}
  async listTools() {
    const tools = await this.client.listTools(this.machineId);
    return tools.map((tool) => descriptorFor(this.id, tool));
  }
  async invokeTool(name, args, signal) {
    const machine = await this.client.getMachine(this.machineId);
    return machine.invoke(name, args, signal === undefined ? undefined : { signal });
  }
}
var descriptorFor = (node, tool) => ({
  name: tool.name,
  description: tool.description ?? tool.capability,
  parameters: tool.inputSchema,
  node
});
// src/client-errors.ts
class MachineHubConnectError extends Error {
  constructor(message, cause) {
    super(`machine hub connect failed: ${message}`, cause === undefined ? undefined : { cause });
    this.name = "MachineHubConnectError";
  }
}

class TreeTransferUnsupportedError extends Error {
  code = "tree_transfer_unsupported";
  constructor(machineId) {
    super(`tree_transfer_unsupported: machine ${machineId} does not advertise tree-transfer`);
    this.name = "TreeTransferUnsupportedError";
  }
}

class LedgerMismatchError extends Error {
  taskId;
  stepName;
  opSeq;
  expectedOpId;
  actualOpId;
  constructor(details) {
    super(`ledger mismatch for task ${details.taskId} step "${details.stepName}" at opSeq ${details.opSeq}: ` + `journal recorded ${details.expectedOpId}, re-drive produced ${details.actualOpId}`);
    this.name = "LedgerMismatchError";
    this.taskId = details.taskId;
    this.stepName = details.stepName;
    this.opSeq = details.opSeq;
    this.expectedOpId = details.expectedOpId;
    this.actualOpId = details.actualOpId;
  }
}

class TaskContextRequiredError extends Error {
  constructor() {
    super("step() requires a task context; call machine.withTask(taskId) first");
    this.name = "TaskContextRequiredError";
  }
}
// src/hub-transport-error.ts
class HubTransportError extends Error {
  code;
  requestId;
  detail;
  result;
  constructor(code, message, requestId = "", detail, result) {
    super(`hub transport error [${code}]: ${message}`);
    this.name = "HubTransportError";
    this.code = code;
    this.requestId = requestId;
    this.detail = detail;
    this.result = result;
  }
}

class TerminalWaitDeadlineError extends HubTransportError {
}

// ../protocol/src/capability.ts
import { Type as Type2 } from "@sinclair/typebox";

// ../protocol/src/schema-primitives.ts
import { Type } from "@sinclair/typebox";
var protocolVersion = "0.0.0";
var IdSchema = Type.String({ minLength: 1 });
var OperationSchema = Type.String({ minLength: 1 });
var TimestampSchema = Type.String({ minLength: 1 });
var NonNegativeIntegerSchema = Type.Integer({ minimum: 0 });
var PositiveIntegerSchema = Type.Integer({ minimum: 1 });
var StringRecordSchema = Type.Record(Type.String(), Type.String());
var SchemaId = {
  capabilityManifest: "https://bunshin.local/schema/capability-manifest.json",
  disconnected: "https://bunshin.local/schema/disconnected.json",
  doctorReport: "https://bunshin.local/schema/doctor-report.json",
  execCommandRequest: "https://bunshin.local/schema/exec-command-request.json",
  resumable: "https://bunshin.local/schema/resumable.json",
  shellRequest: "https://bunshin.local/schema/shell-request.json",
  shellResult: "https://bunshin.local/schema/shell-result.json",
  terminalHandle: "https://bunshin.local/schema/terminal-handle.json",
  terminalMessage: "https://bunshin.local/schema/terminal-message.json",
  waitForCommandRequest: "https://bunshin.local/schema/wait-for-command-request.json",
  writeStdinRequest: "https://bunshin.local/schema/write-stdin-request.json"
};

// ../protocol/src/capability.ts
var CapabilityTransportSchema = Type2.Union([
  Type2.Literal("built-in"),
  Type2.Literal("sidecar"),
  Type2.Literal("native")
]);
var NonEmptyRecordKeySchema = Type2.String({ pattern: ".+" });
var JsonSchemaObjectSchema = Type2.Record(NonEmptyRecordKeySchema, Type2.Unknown(), { additionalProperties: false });
var CapabilityEntrySchema = Type2.Object({
  name: Type2.String({ minLength: 1 }),
  version: Type2.String({ minLength: 1 }),
  transport: CapabilityTransportSchema,
  ops: Type2.Array(OperationSchema),
  description: Type2.Optional(Type2.String()),
  schema: Type2.Optional(JsonSchemaObjectSchema),
  schemas: Type2.Optional(Type2.Record(NonEmptyRecordKeySchema, JsonSchemaObjectSchema, { additionalProperties: false }))
});
var BridgeDestinationSchema = Type2.String({
  minLength: 1,
  maxLength: 512,
  pattern: "^[!-+,.-~][!-~]*$"
});
var SshHostKeyFingerprintSchema = Type2.String({
  minLength: 50,
  maxLength: 50,
  pattern: "^SHA256:[A-Za-z0-9+/]{43}$"
});
var SshHostKeyFingerprintsSchema = Type2.Array(SshHostKeyFingerprintSchema, { maxItems: 8, uniqueItems: true });
var BridgeSourcesSchema = Type2.Array(Type2.Union([Type2.Literal("ssh_config"), Type2.Literal("tailscale"), Type2.Literal("manual")]), { maxItems: 3, uniqueItems: true });
var BridgeTierSchema = Type2.Union([Type2.Literal(0), Type2.Literal(1)]);
var BridgeErrorCodeSchema = Type2.Union([
  Type2.Literal("bridge_disabled"),
  Type2.Literal("bridge_target_unknown"),
  Type2.Literal("bridge_target_unreachable"),
  Type2.Literal("bridge_auth_denied"),
  Type2.Literal("bridge_hostkey_mismatch"),
  Type2.Literal("bridge_tier_unsupported"),
  Type2.Literal("bridge_cycle"),
  Type2.Literal("bridge_timeout")
]);
var BridgeTargetSchema = Type2.Object({
  target: BridgeDestinationSchema,
  discovered: Type2.Boolean(),
  addresses: Type2.Array(Type2.Object({
    host: Type2.String({ minLength: 1, maxLength: 253, pattern: "^[!-~]+$" }),
    port: Type2.Integer({ minimum: 1, maximum: 65535 }),
    user: Type2.String({ minLength: 1, maxLength: 64, pattern: "^[!-~]+$" })
  }, { additionalProperties: false }), { maxItems: 8, uniqueItems: true }),
  hostKeyFp: SshHostKeyFingerprintsSchema,
  probe: Type2.Object({
    state: Type2.Union([
      Type2.Literal("unknown"),
      Type2.Literal("reachable"),
      Type2.Literal("unreachable"),
      Type2.Literal("attention"),
      Type2.Literal("disabled")
    ]),
    rttMs: Type2.Union([Type2.Integer({ minimum: 0, maximum: 500 }), Type2.Null()]),
    at: Type2.Union([Type2.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }), Type2.Null()]),
    reason: Type2.Union([
      BridgeErrorCodeSchema,
      Type2.Literal("hostkey_unpinned"),
      Type2.Literal("protocol_mismatch"),
      Type2.Literal("probe_budget_exhausted"),
      Type2.Literal("identity_conflict"),
      Type2.Null()
    ])
  }, { additionalProperties: false }),
  tier: Type2.Union([BridgeTierSchema, Type2.Null()])
}, { additionalProperties: false, title: "BridgeTarget" });
var BridgeManifestSchema = Type2.Object({
  enabled: Type2.Boolean(),
  sources: BridgeSourcesSchema,
  targets: Type2.Array(BridgeTargetSchema, { maxItems: 64, uniqueItems: true })
}, { additionalProperties: false, title: "BridgeManifest" });
var CapabilityManifestSchema = Type2.Object({
  machineId: IdSchema,
  protocolVersion: Type2.Literal(protocolVersion),
  protocolFeatures: Type2.Optional(Type2.Array(Type2.String({ minLength: 1 }))),
  build: Type2.Optional(Type2.Object({
    version: Type2.String({ minLength: 1 }),
    binarySha256: Type2.String({ pattern: "^[0-9a-f]{64}$" }),
    onDiskSha256: Type2.Optional(Type2.String({ pattern: "^[0-9a-f]{64}$" })),
    installPath: Type2.Optional(Type2.String())
  }, { additionalProperties: false })),
  host: Type2.Optional(Type2.Object({ load1: Type2.Number(), cores: Type2.Integer() }, { additionalProperties: false })),
  bridge: Type2.Optional(BridgeManifestSchema),
  sshHostKeyFingerprints: Type2.Optional(SshHostKeyFingerprintsSchema),
  capabilities: Type2.Array(CapabilityEntrySchema),
  effects: Type2.Optional(Type2.Record(NonEmptyRecordKeySchema, Type2.Union([Type2.Literal("read"), Type2.Literal("mutate")]), {
    additionalProperties: false
  }))
}, { $id: SchemaId.capabilityManifest, title: "CapabilityManifest" });
var ConstraintSchema = Type2.Union([
  Type2.Object({ kind: Type2.Literal("any") }, { additionalProperties: false }),
  Type2.Object({ kind: Type2.Literal("exact"), value: Type2.Unknown() }, { additionalProperties: false }),
  Type2.Object({ kind: Type2.Literal("prefix"), prefix: Type2.String({ minLength: 1 }) }, { additionalProperties: false }),
  Type2.Object({ kind: Type2.Literal("oneOf"), values: Type2.Array(Type2.Unknown(), { minItems: 1 }) }, { additionalProperties: false }),
  Type2.Object({ kind: Type2.Literal("range"), min: Type2.Number(), max: Type2.Number() }, { additionalProperties: false })
]);
var CapabilityTokenSchema = Type2.Object({
  ver: Type2.Literal(1),
  issuer: Type2.String({ minLength: 1 }),
  accountId: Type2.String({ minLength: 1 }),
  machineId: IdSchema,
  taskId: Type2.Optional(Type2.String({ minLength: 1 })),
  allowedOps: Type2.Array(OperationSchema),
  pathJail: Type2.String({ minLength: 1 }),
  argConstraints: Type2.Record(NonEmptyRecordKeySchema, ConstraintSchema, { additionalProperties: false }),
  notBefore: Type2.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  expiry: Type2.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  nonce: Type2.String({ minLength: 1 }),
  sig: Type2.String({ minLength: 1 })
});
var ReleaseFileSchema = Type2.Object({
  path: Type2.String({ minLength: 1 }),
  contentsBase64: Type2.String()
}, { additionalProperties: false });
var ReleaseHealthCheckSchema = Type2.Object({
  command: Type2.String({ minLength: 1 }),
  timeoutMs: Type2.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER })
}, { additionalProperties: false });
var ReleaseRequestSchema = Type2.Object({
  deployRoot: Type2.String({ minLength: 1 }),
  files: Type2.Array(ReleaseFileSchema, { minItems: 1 }),
  healthCheck: Type2.Optional(ReleaseHealthCheckSchema),
  retention: Type2.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER })
}, { additionalProperties: false });
var ReleaseOutcomeSchema = Type2.Union([
  Type2.Object({
    status: Type2.Literal("promoted"),
    sha: Type2.String({ minLength: 1 }),
    previous: Type2.Union([Type2.String({ minLength: 1 }), Type2.Null()]),
    pruned: Type2.Array(Type2.String({ minLength: 1 }))
  }, { additionalProperties: false }),
  Type2.Object({
    status: Type2.Literal("rolled_back"),
    attemptedSha: Type2.String({ minLength: 1 }),
    restored: Type2.Union([Type2.String({ minLength: 1 }), Type2.Null()]),
    reason: Type2.Union([
      Type2.Object({ kind: Type2.Literal("health_check_failed"), exitCode: Type2.Integer() }, { additionalProperties: false }),
      Type2.Object({ kind: Type2.Literal("health_check_timed_out") }, { additionalProperties: false })
    ])
  }, { additionalProperties: false })
]);
var Sha256HexSchema = Type2.String({ pattern: "^[0-9a-f]{64}$" });
var ArtifactSizeSchema = Type2.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
var ArtifactUrlSchema = Type2.String({ minLength: 1 });
var ArtifactPutRequestSchema = Type2.Object({ sha256: Sha256HexSchema, size: ArtifactSizeSchema }, { additionalProperties: false, title: "ArtifactPutRequest" });
var ArtifactPutResultSchema = Type2.Object({ uploadUrl: ArtifactUrlSchema, sha256: Sha256HexSchema }, { additionalProperties: false, title: "ArtifactPutResult" });
var ArtifactGetRequestSchema = Type2.Object({ sha256: Sha256HexSchema }, { additionalProperties: false, title: "ArtifactGetRequest" });
var ArtifactGetResultSchema = Type2.Object({ downloadUrl: ArtifactUrlSchema, sha256: Sha256HexSchema }, { additionalProperties: false, title: "ArtifactGetResult" });
var ArtifactRefSchema = Type2.Object({ kind: Type2.Literal("artifact"), sha256: Sha256HexSchema, size: ArtifactSizeSchema, url: ArtifactUrlSchema }, { additionalProperties: false, title: "ArtifactRef" });
// ../protocol/src/doctor.ts
import { Type as Type3 } from "@sinclair/typebox";
var DoctorStatusSchema = Type3.Union([Type3.Literal("ok"), Type3.Literal("warn"), Type3.Literal("error")]);
var CpuReportSchema = Type3.Object({
  cores: NonNegativeIntegerSchema,
  model: Type3.String()
});
var DiskReportSchema = Type3.Object({
  mount: Type3.String({ minLength: 1 }),
  total: NonNegativeIntegerSchema,
  free: NonNegativeIntegerSchema
});
var NetIfaceReportSchema = Type3.Object({
  name: Type3.String({ minLength: 1 }),
  addresses: Type3.Array(Type3.String())
});
var PermissionReportSchema = Type3.Object({
  name: Type3.String({ minLength: 1 }),
  granted: Type3.Boolean(),
  details: Type3.Optional(Type3.String())
});
var ReachabilityStatusSchema = Type3.Union([
  Type3.Literal("reachable"),
  Type3.Literal("unreachable"),
  Type3.Literal("unknown")
]);
var ReachabilityProbeSchema = Type3.Object({
  status: Type3.Optional(ReachabilityStatusSchema),
  target: Type3.Optional(Type3.String()),
  roundTripMs: Type3.Optional(Type3.Number({ minimum: 0 })),
  checkedAtMs: Type3.Optional(NonNegativeIntegerSchema),
  errorCode: Type3.Optional(Type3.String()),
  details: Type3.Optional(Type3.String())
});
var NetworkReportSchema = Type3.Object({
  outboundInternet: Type3.Optional(ReachabilityProbeSchema),
  externallyObservedAddress: Type3.Optional(Type3.Object({
    address: Type3.Optional(Type3.String()),
    family: Type3.Optional(Type3.Union([Type3.Literal("ipv4"), Type3.Literal("ipv6")])),
    port: Type3.Optional(Type3.Integer({ minimum: 1, maximum: 65535 })),
    observedAtMs: Type3.Optional(NonNegativeIntegerSchema)
  })),
  hub: Type3.Optional(ReachabilityProbeSchema),
  artifactStore: Type3.Optional(Type3.Object({
    status: Type3.Optional(ReachabilityStatusSchema),
    brokerRoundTripMs: Type3.Optional(Type3.Number({ minimum: 0 })),
    putReachable: Type3.Optional(Type3.Boolean()),
    getReachable: Type3.Optional(Type3.Boolean()),
    checkedAtMs: Type3.Optional(NonNegativeIntegerSchema),
    errorCode: Type3.Optional(Type3.String()),
    details: Type3.Optional(Type3.String())
  })),
  transferPairs: Type3.Optional(Type3.Array(Type3.Object({
    sourceMachineId: Type3.Optional(Type3.String({ minLength: 1 })),
    destinationMachineId: Type3.Optional(Type3.String({ minLength: 1 })),
    tier: Type3.Optional(Type3.Union([
      Type3.Literal("tailnet_direct"),
      Type3.Literal("public_direct"),
      Type3.Literal("artifact_store"),
      Type3.Literal("unavailable")
    ])),
    candidateId: Type3.Optional(Type3.String()),
    roundTripMs: Type3.Optional(Type3.Number({ minimum: 0 })),
    checkedAtMs: Type3.Optional(NonNegativeIntegerSchema),
    reasonCode: Type3.Optional(Type3.String()),
    details: Type3.Optional(Type3.String())
  })))
});
var DoctorReportSchema = Type3.Object({
  status: DoctorStatusSchema,
  os: Type3.String({ minLength: 1 }),
  arch: Type3.String({ minLength: 1 }),
  kernel: Type3.String({ minLength: 1 }),
  shell: Type3.String({ minLength: 1 }),
  gitBash: Type3.Optional(Type3.String()),
  sandboxAvailable: Type3.Boolean(),
  capabilities: Type3.Array(Type3.String({ minLength: 1 })),
  cpu: CpuReportSchema,
  memTotal: NonNegativeIntegerSchema,
  memFree: NonNegativeIntegerSchema,
  load: Type3.Tuple([Type3.Number(), Type3.Number(), Type3.Number()]),
  disk: Type3.Array(DiskReportSchema),
  netIfaces: Type3.Array(NetIfaceReportSchema),
  permissions: Type3.Array(PermissionReportSchema),
  network: Type3.Optional(NetworkReportSchema)
}, { $id: SchemaId.doctorReport, title: "DoctorReport" });
// ../protocol/src/envelopes.ts
import { Type as Type7 } from "@sinclair/typebox";

// ../protocol/src/mesh.ts
import { Type as Type6 } from "@sinclair/typebox";

// ../protocol/src/error-plane.ts
import { Type as Type4 } from "@sinclair/typebox";
var errorSchemaId = (name) => `https://bunshin.local/schema/${name}.json`;
var ERROR_FRAMES_FEATURE = "error_frames:v2";
var ERROR_FRAME_VERSION = 2;
var ERROR_FRAME_KIND = "protocol.error";
var PROTOCOL_ERROR_CODES = [
  "invoke_deadline",
  "op_failed",
  "budget_exceeded",
  "malformed_frame",
  "wrong_kind",
  "agent_busy_refresh",
  "persistence_failed",
  "machine_offline_skipped"
];
var ProtocolErrorCodeSchema = Type4.Union(PROTOCOL_ERROR_CODES.map((code) => Type4.Literal(code)));
var ProtocolErrorDispositionSchema = Type4.Union([Type4.Literal("terminal"), Type4.Literal("redeliverable")]);
var ProtocolErrorPayloadSchema = Type4.Object({
  code: ProtocolErrorCodeSchema,
  message: Type4.String(),
  disposition: ProtocolErrorDispositionSchema,
  machineId: Type4.Optional(Type4.String({ minLength: 1 }))
}, {
  $id: errorSchemaId("protocol-error-payload"),
  title: "ProtocolErrorPayload",
  additionalProperties: false
});
var ProtocolErrorFrameSchema = Type4.Object({
  kind: Type4.Literal(ERROR_FRAME_KIND),
  id: Type4.String({ minLength: 1 }),
  v: Type4.Literal(ERROR_FRAME_VERSION),
  error: ProtocolErrorPayloadSchema
}, { $id: errorSchemaId("protocol-error"), title: "ProtocolErrorFrame" });

// ../protocol/src/terminal.ts
import { Type as Type5 } from "@sinclair/typebox";
var ShellRequestSchema = Type5.Object({
  kind: Type5.Literal("shell"),
  command: Type5.String({ minLength: 1 }),
  cwd: Type5.Optional(Type5.String({ minLength: 1 })),
  env: Type5.Optional(StringRecordSchema),
  timeoutMs: Type5.Optional(PositiveIntegerSchema)
}, { $id: SchemaId.shellRequest, title: "ShellRequest" });
var ShellResultSchema = Type5.Object({
  exitCode: Type5.Integer(),
  stdout: Type5.String(),
  stderr: Type5.String(),
  signal: Type5.Optional(Type5.String()),
  timeout: Type5.Optional(Type5.Union([Type5.Literal("deadline"), Type5.Literal("exit-unconfirmed")])),
  startedAtMs: Type5.Optional(Type5.Integer()),
  durationMs: Type5.Optional(Type5.Integer())
}, { $id: SchemaId.shellResult, title: "ShellResult" });
var ExecCommandRequestSchema = Type5.Object({
  kind: Type5.Literal("exec-command"),
  command: Type5.String({ minLength: 1 }),
  args: Type5.Optional(Type5.Array(Type5.String())),
  cwd: Type5.Optional(Type5.String({ minLength: 1 })),
  env: Type5.Optional(StringRecordSchema),
  yieldTimeMs: Type5.Optional(NonNegativeIntegerSchema),
  lifecycleVersion: Type5.Optional(Type5.Literal(1))
}, { $id: SchemaId.execCommandRequest, title: "ExecCommandRequest" });
var CommandStateSchema = Type5.Union([
  Type5.Literal("starting"),
  Type5.Literal("running"),
  Type5.Literal("waiting_input"),
  Type5.Literal("exited"),
  Type5.Literal("killed"),
  Type5.Literal("lost")
], { $id: "https://bunshin.local/schema/command-state.json", title: "CommandState" });
var TerminalLifecycleSchema = Type5.Union([
  Type5.Object({
    state: Type5.Union([Type5.Literal("starting"), Type5.Literal("running"), Type5.Literal("waiting_input")]),
    stdinOpen: Type5.Boolean(),
    outputClosed: Type5.Boolean()
  }, { additionalProperties: false }),
  Type5.Object({
    state: Type5.Literal("exited"),
    exitCode: Type5.Integer(),
    stdinOpen: Type5.Literal(false),
    outputClosed: Type5.Boolean()
  }, { additionalProperties: false }),
  Type5.Object({ state: Type5.Literal("killed"), stdinOpen: Type5.Literal(false), outputClosed: Type5.Boolean() }, { additionalProperties: false }),
  Type5.Object({
    state: Type5.Literal("lost"),
    reason: Type5.Union([
      Type5.Literal("unknown_handle"),
      Type5.Literal("agent_restarted"),
      Type5.Literal("exit_status_unavailable")
    ]),
    stdinOpen: Type5.Literal(false),
    outputClosed: Type5.Boolean()
  }, { additionalProperties: false })
], { $id: "https://bunshin.local/schema/terminal-lifecycle.json", title: "TerminalLifecycle" });
var StdinEffectSchema = Type5.Object({ acceptedBytes: Type5.Integer(), observed: Type5.Boolean() }, { $id: "https://bunshin.local/schema/stdin-effect.json", title: "StdinEffect", additionalProperties: false });
var WriteStdinRequestSchema = Type5.Object({
  kind: Type5.Literal("write-stdin"),
  handleId: IdSchema,
  data: Type5.String(),
  yieldTimeMs: Type5.Optional(NonNegativeIntegerSchema),
  expectActivityMs: Type5.Optional(Type5.Integer({ minimum: 250, maximum: 1e4 })),
  lifecycleVersion: Type5.Optional(Type5.Literal(1))
}, { $id: SchemaId.writeStdinRequest, title: "WriteStdinRequest" });
var WaitForCommandRequestSchema = Type5.Object({
  kind: Type5.Literal("wait-for-command"),
  handleId: IdSchema,
  yieldTimeMs: Type5.Optional(NonNegativeIntegerSchema),
  lifecycleVersion: Type5.Optional(Type5.Literal(1)),
  until: Type5.Optional(Type5.Array(CommandStateSchema))
}, { $id: SchemaId.waitForCommandRequest, title: "WaitForCommandRequest" });
var TerminalHandleSchema = Type5.Object({
  kind: Type5.Literal("terminal-handle"),
  handleId: IdSchema,
  pid: PositiveIntegerSchema,
  state: Type5.Union([Type5.Literal("running"), Type5.Literal("exited")]),
  exitCode: Type5.Optional(NonNegativeIntegerSchema)
}, { $id: SchemaId.terminalHandle, title: "TerminalHandle" });
var DisconnectedSchema = Type5.Object({
  kind: Type5.Literal("disconnected"),
  handleId: Type5.Optional(IdSchema),
  reason: Type5.Union([Type5.Literal("network"), Type5.Literal("machine-dead"), Type5.Literal("process-exited")]),
  resumable: Type5.Boolean(),
  message: Type5.Optional(Type5.String()),
  resumableId: Type5.Optional(IdSchema),
  lastSeq: Type5.Optional(NonNegativeIntegerSchema)
}, { $id: SchemaId.disconnected, title: "Disconnected" });
var ResumableSchema = Type5.Object({
  kind: Type5.Literal("resumable"),
  handleId: IdSchema,
  retainedUntil: TimestampSchema
}, { $id: SchemaId.resumable, title: "Resumable" });
var TerminalMessageSchema = Type5.Union([
  ShellRequestSchema,
  ExecCommandRequestSchema,
  WriteStdinRequestSchema,
  WaitForCommandRequestSchema,
  TerminalHandleSchema,
  DisconnectedSchema,
  ResumableSchema
], { $id: SchemaId.terminalMessage, title: "TerminalMessage" });

// ../protocol/src/mesh.ts
var meshSchemaId = (name) => `https://bunshin.local/schema/${name}.json`;
var AGENT_MAX_YIELD_MS = 1e4;
var HUB_PENDING_RESPONSE_TIMEOUT_MS = 30000;
var SDK_MAX_DEADLINE_MS = 30000;
var DURABLE_INVOKE_INFLIGHT_RETENTION_MS = 120000;
var DURABLE_INVOKE_RESULT_RETENTION_MS = 120000;
var DURABLE_INVOKE_INLINE_MAX_BYTES = 65536;
var DURABLE_RESULT_ENVELOPE_FEATURE = "durable-result-envelope-v1";
var LONG_SHELL_BUDGET_MS = 3600000;
var DURABLE_INVOKE_MAX_BUDGET_MS = 3660000;
var HEARTBEAT_MS = 30000;
var PONG_TIMEOUT_MS = 1e4;
var ARTIFACT_OFFLOAD_THRESHOLD_BYTES = 1048576;
var TERMINAL_YIELD_MIN_MS = 250;
var TERMINAL_MAX_YIELD_MS = 1e4;
var TRANSFER_CANDIDATE_TTL_MS = 90000;
var TRANSFER_TICKET_TTL_MS = 60000;
var TRANSFER_PROBE_TIMEOUT_MS = 500;
var TRANSFER_MAX_STREAM_MS = 900000;
var TRANSFER_IDLE_TIMEOUT_MS = 30000;
var TRANSFER_REDEEM_TIMEOUT_MS = 5000;
var TREE_TRANSFER_BUDGET_MS = 600000;
var TREE_ARCHIVE_MAX_BYTES = 268435456;
var TREE_ARCHIVE_FORMATS = ["tar+gzip"];
var PROTOCOL_FEATURES = [
  "durable-invoke-v1",
  "artifact-write",
  "transfer-ticket",
  "network-report",
  "transfer-probe",
  "protocol-rev-2",
  ERROR_FRAMES_FEATURE,
  DURABLE_RESULT_ENVELOPE_FEATURE,
  "terminal-lifecycle:v1",
  "machine-key-refresh:v1",
  "agent-health:v1",
  "fleet-events:v1",
  "ssh-bridge:v1"
];
var DurableResultArtifactSchema = Type6.Composite([ArtifactRefSchema, Type6.Object({ envelope: Type6.Literal(DURABLE_RESULT_ENVELOPE_FEATURE) })], { additionalProperties: false });
var DurableResultEnvelopeSchema = Type6.Object({ bodyArtifact: DurableResultArtifactSchema }, { $id: meshSchemaId("durable-result-envelope"), additionalProperties: false, title: "DurableResultEnvelope" });
var integer = Type6.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
var positiveInteger = Type6.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER });
var strings = Type6.Record(Type6.String(), Type6.String());
var doctorArgs = Type6.Object({
  transferPairs: Type6.Optional(Type6.Array(Type6.Object({
    sourceMachineId: Type6.String({ minLength: 1 }),
    destinationMachineId: Type6.String({ minLength: 1 })
  }, { additionalProperties: false }), { maxItems: 32 }))
}, { additionalProperties: false });
var kind = Type6.Union(["file", "directory", "symlink", "other"].map((value) => Type6.Literal(value)));
var terminalResult = Type6.Object({
  handleId: Type6.String({ minLength: 1 }),
  output: Type6.String(),
  state: Type6.String({ minLength: 1 }),
  lifecycle: Type6.Optional(TerminalLifecycleSchema),
  stdinEffect: Type6.Optional(StdinEffectSchema),
  lastSeq: integer,
  truncated: Type6.Boolean(),
  omittedBytes: integer,
  totalBytes: integer,
  exitCode: Type6.Optional(Type6.Integer()),
  startedAtMs: Type6.Optional(Type6.Integer()),
  elapsedMs: Type6.Optional(Type6.Integer())
});
var terminalIdentity = {
  handle_id: Type6.String({ minLength: 1 }),
  yield_ms: Type6.Optional(Type6.Integer({ minimum: TERMINAL_YIELD_MIN_MS, maximum: TERMINAL_MAX_YIELD_MS })),
  last_seq: Type6.Optional(integer)
};
var fsEntry = Type6.Object({
  name: Type6.String(),
  path: Type6.String(),
  kind,
  sizeBytes: integer,
  readonly: Type6.Boolean()
});
var transferSha256 = Type6.String({ pattern: "^[0-9a-f]{64}$" });
var transferCandidateProperties = {
  candidateId: Type6.String({ minLength: 1 }),
  tier: Type6.Union([Type6.Literal("tailnet_direct"), Type6.Literal("public_direct")]),
  url: Type6.String({ minLength: 1 }),
  tlsSpkiSha256: transferSha256
};
var transferAdvertisementProperties = {
  transferId: Type6.String({ minLength: 1 }),
  listenerPort: Type6.Integer({ minimum: 1, maximum: 65535 }),
  tlsSpkiSha256: transferSha256,
  expiresAtMs: positiveInteger,
  addresses: Type6.Optional(Type6.Array(Type6.String({ minLength: 1 }), { maxItems: 8 }))
};
var transferCandidate = Type6.Object(transferCandidateProperties, { additionalProperties: false });
var transferAdvertisement = Type6.Object(transferAdvertisementProperties, { additionalProperties: false });
var transferProbeResult = Type6.Object({
  candidateId: Type6.String({ minLength: 1 }),
  outcome: Type6.Union([Type6.Literal("reachable"), Type6.Literal("unreachable")]),
  roundTripMs: Type6.Optional(integer),
  reasonCode: Type6.Optional(Type6.String({ minLength: 1 }))
}, { additionalProperties: false });
var transferWindowProperties = {
  transferId: Type6.String({ minLength: 1 }),
  sha256: transferSha256,
  size: integer,
  offset: Type6.Optional(integer),
  expiresAtMs: positiveInteger
};
var fsReadResult = Type6.Union([
  Type6.Object({
    path: Type6.String(),
    sizeBytes: integer,
    readonly: Type6.Boolean(),
    truncated: Type6.Boolean(),
    bytes: Type6.Union([
      Type6.Object({ kind: Type6.Literal("full"), base64: Type6.String() }),
      Type6.Object({ kind: Type6.Literal("truncated"), head: Type6.String(), tail: Type6.String() })
    ])
  }),
  ArtifactRefSchema
]);
var treeArchiveFormat = Type6.Union(TREE_ARCHIVE_FORMATS.map((value) => Type6.Literal(value)));
var treePackRequest = Type6.Object({
  path: Type6.String({ minLength: 1 }),
  include: Type6.Optional(Type6.Array(Type6.String())),
  ignore: Type6.Optional(Type6.Array(Type6.String())),
  format: treeArchiveFormat,
  maxBytes: Type6.Optional(positiveInteger)
}, { additionalProperties: false });
var treePackResult = Type6.Object({
  artifact: ArtifactRefSchema,
  fileCount: integer,
  dirCount: integer,
  symlinkCount: integer,
  totalBytes: integer,
  archiveBytes: integer
}, { additionalProperties: false });
var TreeApplyRequestSchema = Type6.Object({
  path: Type6.String(),
  artifact: ArtifactRefSchema,
  format: treeArchiveFormat,
  clean: Type6.Optional(Type6.Boolean()),
  sourceMachineId: Type6.Optional(Type6.String()),
  ticket: Type6.Optional(Type6.String())
}, { additionalProperties: false });
var treeApplyResult = Type6.Object({ path: Type6.String(), fileCount: integer, writtenBytes: integer }, { additionalProperties: false });
var ErrorPayloadSchema = Type6.Object({ code: Type6.String(), message: Type6.String() }, { additionalProperties: false });
var bridgeId = Type6.String({ minLength: 1, maxLength: 256 });
var BridgePolicySchema = Type6.Object({
  enabled: Type6.Optional(Type6.Boolean()),
  sources: Type6.Optional(BridgeSourcesSchema),
  targets: Type6.Optional(Type6.Array(Type6.Object({
    target: BridgeDestinationSchema,
    enabled: Type6.Optional(Type6.Boolean()),
    hostKeyFp: Type6.Optional(SshHostKeyFingerprintsSchema),
    home: Type6.Optional(Type6.String({ minLength: 1, maxLength: 4095, pattern: "^[^\\x00\\r\\n]+$" }))
  }, { additionalProperties: false }), { maxItems: 64, uniqueItems: true }))
}, { additionalProperties: false, title: "BridgePolicy" });
var BridgeRouteSchema = Type6.Union([
  Type6.Literal("auto"),
  Type6.Literal("direct"),
  Type6.Literal("bridge"),
  Type6.Object({ via: bridgeId, target: Type6.Optional(BridgeDestinationSchema) }, { additionalProperties: false })
]);
var meshOperationContracts = {
  echo: [Type6.Unknown(), Type6.Unknown()],
  shell: [
    Type6.Object({
      command: Type6.String({ minLength: 1 }),
      cwd: Type6.Optional(Type6.String({ minLength: 1 })),
      env: Type6.Optional(strings),
      timeoutMs: Type6.Optional(positiveInteger)
    }),
    Type6.Intersect([
      ShellResultSchema,
      Type6.Object({
        spillPath: Type6.Optional(Type6.String()),
        totalBytes: Type6.Optional(Type6.Integer()),
        omittedBytes: Type6.Optional(Type6.Integer()),
        head: Type6.Optional(Type6.String())
      })
    ])
  ],
  exec: [
    Type6.Object({
      command: Type6.String({ minLength: 1 }),
      cwd: Type6.Optional(Type6.String({ minLength: 1 })),
      env: Type6.Optional(strings),
      timeoutMs: Type6.Optional(integer)
    }),
    Type6.Object({
      stdout: Type6.String(),
      stderr: Type6.String(),
      spillPath: Type6.Optional(Type6.String()),
      totalBytes: Type6.Optional(Type6.Integer()),
      omittedBytes: Type6.Optional(Type6.Integer()),
      head: Type6.Optional(Type6.String()),
      status: Type6.Union([
        Type6.Object({ kind: Type6.Literal("exited"), exitCode: Type6.Integer() }),
        Type6.Object({ kind: Type6.Literal("timed_out") })
      ]),
      durationMs: integer,
      cwd: Type6.String()
    })
  ],
  terminalExec: [
    Type6.Object({
      cmd: Type6.String(),
      workdir: Type6.Optional(Type6.String({ minLength: 1 })),
      yield_ms: Type6.Optional(Type6.Integer({ minimum: TERMINAL_YIELD_MIN_MS, maximum: TERMINAL_MAX_YIELD_MS })),
      lifecycleVersion: Type6.Optional(Type6.Literal(1))
    }),
    terminalResult
  ],
  terminalWrite: [
    Type6.Object({
      ...terminalIdentity,
      data: Type6.Optional(Type6.String()),
      lifecycleVersion: Type6.Optional(Type6.Literal(1)),
      expectActivityMs: Type6.Optional(Type6.Integer({ minimum: TERMINAL_YIELD_MIN_MS, maximum: TERMINAL_MAX_YIELD_MS }))
    }),
    terminalResult
  ],
  terminalWait: [
    Type6.Object({
      ...terminalIdentity,
      lifecycleVersion: Type6.Optional(Type6.Literal(1)),
      until: Type6.Optional(Type6.Array(CommandStateSchema))
    }),
    terminalResult
  ],
  terminalKill: [
    Type6.Object({ handle_id: Type6.String({ minLength: 1 }), lifecycleVersion: Type6.Optional(Type6.Literal(1)) }),
    Type6.Object({
      handleId: Type6.String({ minLength: 1 }),
      state: Type6.Literal("task-failed"),
      lifecycle: Type6.Optional(TerminalLifecycleSchema),
      reason: Type6.Literal("killed")
    })
  ],
  fsRead: [
    Type6.Object({
      path: Type6.String(),
      limit_bytes: Type6.Optional(positiveInteger),
      offload: Type6.Optional(Type6.Union([Type6.Literal("auto"), Type6.Literal("never")]))
    }),
    fsReadResult
  ],
  fsWrite: [
    Type6.Union([
      Type6.Object({ path: Type6.String(), bytes: Type6.String(), create_parent_dirs: Type6.Optional(Type6.Boolean()) }),
      Type6.Object({
        path: Type6.String(),
        artifact: ArtifactRefSchema,
        create_parent_dirs: Type6.Optional(Type6.Boolean()),
        sourceMachineId: Type6.Optional(Type6.String({ minLength: 1 })),
        ticket: Type6.Optional(Type6.String({ minLength: 1 }))
      })
    ]),
    Type6.Object({ path: Type6.String(), bytesWritten: integer })
  ],
  fsTreePack: [treePackRequest, treePackResult],
  fsTreeApply: [TreeApplyRequestSchema, treeApplyResult],
  fsStat: [
    Type6.Object({ path: Type6.String() }),
    Type6.Object({ path: Type6.String(), kind, sizeBytes: integer, readonly: Type6.Boolean() })
  ],
  fsList: [
    Type6.Object({ path: Type6.String(), limit: Type6.Optional(positiveInteger) }),
    Type6.Object({ path: Type6.String(), entries: Type6.Array(fsEntry), truncated: Type6.Boolean() })
  ],
  fsGlob: [
    Type6.Object({ pattern: Type6.String(), limit: Type6.Optional(positiveInteger) }),
    Type6.Object({ pattern: Type6.String(), matches: Type6.Array(Type6.String()), truncated: Type6.Boolean() })
  ],
  fsGrep: [
    Type6.Object({ path: Type6.String(), pattern: Type6.String(), limit: Type6.Optional(positiveInteger) }),
    Type6.Object({
      path: Type6.String(),
      matches: Type6.Array(Type6.Object({
        path: Type6.String(),
        byteOffset: integer,
        snippet: Type6.String(),
        utf8Lossy: Type6.Boolean()
      })),
      truncated: Type6.Boolean()
    })
  ],
  doctor: [doctorArgs, DoctorReportSchema],
  service: [
    Type6.Object({ name: Type6.String({ minLength: 1 }) }),
    Type6.Object({ ok: Type6.Literal(true), service: Type6.String(), restarted: Type6.Literal(true) })
  ],
  release: [ReleaseRequestSchema, ReleaseOutcomeSchema],
  manifest: [CapabilityManifestSchema, Type6.Object({ ok: Type6.Literal(true) })],
  artifactPut: [ArtifactPutRequestSchema, ArtifactPutResultSchema],
  artifactGet: [ArtifactGetRequestSchema, ArtifactGetResultSchema],
  artifactTransferTicket: [
    Type6.Object({
      sourceMachineId: Type6.String({ minLength: 1 }),
      destinationMachineId: Type6.String({ minLength: 1 }),
      sha256: transferSha256,
      size: integer,
      offset: Type6.Optional(integer)
    }, { additionalProperties: false }),
    Type6.Union([
      Type6.Object({
        route: Type6.Literal("direct"),
        transferId: Type6.String({ minLength: 1 }),
        ticket: Type6.String({ minLength: 1 }),
        expiresAtMs: positiveInteger,
        sha256: transferSha256,
        size: integer,
        offset: integer,
        candidates: Type6.Array(transferCandidate, { minItems: 1 }),
        fallback: ArtifactRefSchema
      }, { additionalProperties: false }),
      Type6.Object({
        route: Type6.Literal("artifact_store"),
        transferId: Type6.String({ minLength: 1 }),
        expiresAtMs: positiveInteger,
        sha256: transferSha256,
        size: integer,
        offset: integer,
        fallback: ArtifactRefSchema
      }, { additionalProperties: false })
    ])
  ],
  agentRestart: [
    Type6.Object({ reason: Type6.Optional(Type6.String()) }, { additionalProperties: false }),
    Type6.Object({ scheduledInMs: Type6.Integer(), pid: Type6.Integer() }, { additionalProperties: false })
  ],
  processInfo: [
    Type6.Object({ pid: Type6.Optional(Type6.Integer()), handleId: Type6.Optional(Type6.String()) }, { additionalProperties: false }),
    Type6.Object({
      pid: Type6.Integer(),
      startedAtMs: Type6.Integer(),
      cpuTimeMs: Type6.Integer(),
      rssBytes: Type6.Integer(),
      command: Type6.String(),
      lastOpAtMs: Type6.Optional(Type6.Integer())
    }, { additionalProperties: false })
  ],
  meshMessage: [
    Type6.Object({ topic: Type6.String({ pattern: "^[a-z0-9][a-z0-9._-]{0,63}$" }), body: Type6.Unknown() }, { additionalProperties: false }),
    Type6.Object({ accepted: Type6.Literal(true), seq: Type6.Integer(), inboxPath: Type6.String() }, { additionalProperties: false })
  ],
  bridgeList: [
    Type6.Object({}, { additionalProperties: false }),
    Type6.Object({ ...BridgeManifestSchema.properties, truncated: Type6.Boolean() }, { additionalProperties: false })
  ],
  bridgeProbe: [
    Type6.Object({
      targets: Type6.Optional(Type6.Array(BridgeDestinationSchema, { minItems: 1, maxItems: 32, uniqueItems: true }))
    }, { additionalProperties: false }),
    Type6.Object({
      results: Type6.Array(Type6.Object({ ...BridgeTargetSchema.properties, observedHostKeyFp: SshHostKeyFingerprintsSchema }, { additionalProperties: false }), { maxItems: 32 }),
      at: integer
    }, { additionalProperties: false })
  ],
  bridgeInvoke: [
    Type6.Object({ target: BridgeDestinationSchema, op: bridgeId, args: Type6.Unknown(), tier: Type6.Optional(BridgeTierSchema) }, { additionalProperties: false }),
    Type6.Object({
      via: bridgeId,
      target: BridgeDestinationSchema,
      hostKeyFp: SshHostKeyFingerprintSchema,
      tier: BridgeTierSchema,
      response: Type6.Union([
        Type6.Object({ result: Type6.Unknown() }, { additionalProperties: false }),
        Type6.Object({ error: ErrorPayloadSchema }, { additionalProperties: false })
      ])
    }, { additionalProperties: false })
  ],
  artifactTransferServe: [
    Type6.Object(transferWindowProperties, { additionalProperties: false }),
    transferAdvertisement
  ]
};
var MeshInvokeProvenanceSchema = Type6.Object({
  requesterSession: Type6.Optional(Type6.String()),
  hubReceivedAtMs: Type6.Integer(),
  claimedFromMachineId: Type6.Optional(Type6.String())
}, { $id: meshSchemaId("mesh-invoke-provenance"), title: "MeshInvokeProvenance", additionalProperties: false });
var MeshTransferRedeemSchema = Type6.Object({
  kind: Type6.Literal("machine.transfer.redeem"),
  id: Type6.String(),
  ticketId: Type6.String({ minLength: 1 }),
  ticket: Type6.String({ minLength: 1 })
}, { $id: meshSchemaId("mesh-transfer-redeem"), title: "MeshTransferRedeem", additionalProperties: false });
var HubTransferRedeemResultSchema = Type6.Object({
  kind: Type6.Literal("hub.transfer.redeem.result"),
  id: Type6.String(),
  ticketId: Type6.String({ minLength: 1 }),
  outcome: Type6.Union([Type6.Literal("accepted"), Type6.Literal("replayed"), Type6.Literal("refused")])
}, { $id: meshSchemaId("hub-transfer-redeem-result"), title: "HubTransferRedeemResult", additionalProperties: false });
var MeshTransferCandidatesSchema = Type6.Object({
  kind: Type6.Literal("machine.transfer.candidates"),
  id: Type6.String(),
  ...transferAdvertisementProperties
}, { $id: meshSchemaId("mesh-transfer-candidates"), title: "MeshTransferCandidates", additionalProperties: false });
var HubTransferProbeSchema = Type6.Object({
  kind: Type6.Literal("hub.transfer.probe"),
  id: Type6.String(),
  transferId: Type6.String({ minLength: 1 }),
  candidates: Type6.Array(transferCandidate, { minItems: 1, maxItems: 8 })
}, { $id: meshSchemaId("hub-transfer-probe"), title: "HubTransferProbe", additionalProperties: false });
var MeshTransferProbeResultSchema = Type6.Object({
  kind: Type6.Literal("machine.transfer.probe.result"),
  id: Type6.String(),
  transferId: Type6.String({ minLength: 1 }),
  results: Type6.Array(transferProbeResult, { minItems: 1 })
}, {
  $id: meshSchemaId("mesh-transfer-probe-result"),
  title: "MeshTransferProbeResult",
  additionalProperties: false
});

// ../protocol/src/envelopes.ts
var EffectSchema = Type7.Union([Type7.Literal("read"), Type7.Literal("mutate")]);
var OperationMetadataProperties = {
  opId: Type7.Optional(Type7.String({ pattern: "^[0-9a-f]{64}$" })),
  effect: Type7.Optional(EffectSchema),
  opSeq: Type7.Optional(Type7.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })),
  taskId: Type7.Optional(Type7.String({ minLength: 1 })),
  capabilityToken: Type7.Optional(Type7.String())
};
var MeshInvokeSchema = Type7.Object({
  kind: Type7.Literal("machine.invoke"),
  id: Type7.String(),
  capability: Type7.String(),
  args: Type7.Optional(Type7.Unknown()),
  deliveryId: Type7.Optional(Type7.String()),
  deadlineAtMs: Type7.Optional(integer),
  ...OperationMetadataProperties,
  requesterSession: Type7.Optional(Type7.String()),
  provenance: Type7.Optional(MeshInvokeProvenanceSchema)
}, { $id: meshSchemaId("mesh-invoke"), title: "MeshInvoke" });
var meshResponseEnvelope = {
  kind: Type7.Literal("machine.response"),
  id: Type7.String(),
  deliveryId: Type7.Optional(Type7.String())
};
var MeshResponseSchema = Type7.Union([
  Type7.Object({ ...meshResponseEnvelope, result: Type7.Unknown() }, { additionalProperties: false }),
  Type7.Object({ ...meshResponseEnvelope, error: ErrorPayloadSchema }, { additionalProperties: false }),
  Type7.Object({ ...meshResponseEnvelope, result: Type7.Unknown(), error: ErrorPayloadSchema }, { additionalProperties: false })
], { $id: meshSchemaId("mesh-response"), title: "MeshResponse" });
var MeshManifestSchema = Type7.Object({
  kind: Type7.Literal("machine.manifest"),
  id: Type7.String(),
  capabilities: CapabilityManifestSchema
}, { $id: meshSchemaId("mesh-manifest"), title: "MeshManifest" });
var HubRequestSchema = Type7.Object({
  kind: Type7.Literal("hub.request"),
  id: Type7.String(),
  targetMachineId: Type7.String(),
  capability: Type7.String(),
  args: Type7.Optional(Type7.Unknown()),
  durable: Type7.Optional(Type7.Boolean()),
  route: Type7.Optional(BridgeRouteSchema),
  deadlineMs: Type7.Optional(Type7.Integer({ minimum: 1 })),
  ...OperationMetadataProperties
}, { $id: meshSchemaId("hub-request"), title: "HubRequest" });
var hubTopic = Type7.Union([Type7.Literal("device"), Type7.Literal("job"), Type7.Literal("message")]);
var HubSubscribeSchema = Type7.Object({
  kind: Type7.Literal("hub.subscribe"),
  id: Type7.String(),
  topics: Type7.Array(hubTopic),
  machineIds: Type7.Optional(Type7.Array(Type7.String()))
}, { $id: meshSchemaId("hub-subscribe"), title: "HubSubscribe", additionalProperties: false });
var HubUnsubscribeSchema = Type7.Object({ kind: Type7.Literal("hub.unsubscribe"), id: Type7.String() }, { $id: meshSchemaId("hub-unsubscribe"), title: "HubUnsubscribe", additionalProperties: false });
var HubEventSchema = Type7.Object({
  kind: Type7.Literal("hub.event"),
  seq: Type7.Integer(),
  topic: hubTopic,
  at: Type7.Integer(),
  machineId: Type7.Optional(Type7.String()),
  payload: Type7.Unknown(),
  gap: Type7.Optional(Type7.Literal(true))
}, { $id: meshSchemaId("hub-event"), title: "HubEvent", additionalProperties: false });
var HubSessionSchema = Type7.Object({ kind: Type7.Literal("hub.session"), id: Type7.Literal("agent-session"), connectionId: Type7.String() }, { $id: meshSchemaId("hub-session"), title: "HubSession", additionalProperties: false });
var HubPolicySchema = Type7.Object({
  kind: Type7.Literal("hub.policy"),
  tags: Type7.Optional(Type7.Array(Type7.String())),
  alias: Type7.Optional(Type7.String()),
  pathAppend: Type7.Optional(Type7.Array(Type7.String())),
  longShellBudgetMs: Type7.Optional(Type7.Integer()),
  bridge: Type7.Optional(BridgePolicySchema)
}, { $id: meshSchemaId("hub-policy"), title: "HubPolicy", additionalProperties: false });
var HubErrorSchema = Type7.Object({
  kind: Type7.Literal("hub.error"),
  id: Type7.String(),
  code: Type7.String(),
  message: Type7.String(),
  scope: Type7.Optional(Type7.Union([Type7.Literal("session"), Type7.Literal("operation")])),
  machineId: Type7.Optional(Type7.String())
}, { $id: meshSchemaId("hub-error"), title: "HubError" });
// ../protocol/src/jcs.ts
class JsonCanonicalizationError extends Error {
  valueType;
  constructor(valueType) {
    super(`unsupported JSON value for JCS canonicalization: ${valueType}`);
    this.name = "JsonCanonicalizationError";
    this.valueType = valueType;
  }
}
var canonicalizeJson = (value) => {
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) {
      throw new JsonCanonicalizationError(typeof value);
    }
    return encoded;
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalizeJson(item)).join(",")}]`;
  }
  const entries = Object.entries(value).sort(([left], [right]) => {
    if (left < right) {
      return -1;
    }
    if (left > right) {
      return 1;
    }
    return 0;
  });
  return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalizeJson(entryValue)}`).join(",")}}`;
};
// ../protocol/src/op-registry.ts
var triggers = {
  artifact_not_found: "unknown sha256",
  bridge_cycle: "inner operation is bridge.list",
  bridge_tier_unsupported: "inner operation is agent.restart",
  bridge_disabled: "bridge disabled with BUNSHIN_BRIDGE=0",
  empty_command: "empty command",
  empty_payload: "files=[]",
  invalid_capability_manifest: "missing machineId",
  invalid_cwd: "missing cwd",
  invalid_encoding: "malformed base64",
  invalid_glob: "unclosed character class",
  invalid_limit: "zero limit",
  invalid_pattern: "empty pattern",
  invalid_path: "invalid filesystem path",
  invalid_request: "invalid sha256",
  invalid_retention: "retention=0",
  invalid_timeout: "timeoutMs=0",
  io_error: "chmod-000 path",
  malformed_input: "missing required terminal field",
  missing_path: "missing path",
  not_directory: "file path",
  replay_gap: "last_seq before retained output",
  service_not_configured: "unknown service",
  service_restart_failed: "configured command exits non-zero",
  unsupported_format: "unsupported archive format",
  path_escape: "archive entry escapes destination",
  archive_too_large: "archive exceeds maximum size",
  restart_binary_unexecutable: "agent binary cannot execute",
  restart_already_scheduled: "agent restart already scheduled",
  process_not_found: "process not found",
  unsupported_platform: "unsupported platform",
  message_too_large: "message exceeds 65536 bytes",
  inbox_unavailable: "inbox unavailable",
  unauthorized: "missing or invalid credential",
  unknown_handle: "bogus handle_id",
  unsafe_path: "path contains ..",
  stdin_activity_timeout: "no terminal activity observed",
  stdin_closed: "terminal stdin is closed",
  terminal_lifecycle_unsupported: "terminal lifecycle unsupported",
  unsupported_path_kind: "symlink path"
};
var errors = (deterministic, hostDependent = []) => [
  ...deterministic.map((code) => ({ code, deterministic: true, trigger: triggers[code] })),
  ...hostDependent.map((code) => ({ code, deterministic: false }))
];
var invokeErrors = (effect) => [
  ...effect === "mutate" ? [{ code: "unauthorized", deterministic: true, trigger: triggers.unauthorized }] : [],
  { code: "unsupported_capability", deterministic: false },
  { code: "invocation_failed", deterministic: false }
];
var defineOp = ({
  op,
  capabilityGroup,
  effect,
  exposure = "invoke",
  determinism,
  disruption = "none",
  contract: [argsSchema, resultSchema],
  errors: opErrors,
  variableFields,
  timeoutBudget
}) => ({
  op,
  capabilityGroup,
  effect,
  exposure,
  transport: "built-in",
  disruption,
  determinism,
  ...variableFields === undefined ? {} : { variableFields },
  ...timeoutBudget === undefined ? {} : { timeoutBudget },
  argsSchema: artifactSchema(argsSchema, op, "args"),
  resultSchema: artifactSchema(resultSchema, op, "result"),
  errors: exposure === "invoke" ? [...opErrors, ...invokeErrors(effect)] : opErrors
});
var artifactSchema = (schema, op, role) => {
  const words = op.replaceAll(".", " Dot ").replaceAll("_", " Underscore ").split(" ").filter(Boolean);
  const stem = words.map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join("");
  return {
    ...schema,
    $id: `https://bunshin.local/schema/op-${op.replaceAll(".", "-")}-${role}.json`,
    title: `Op${stem}${role === "args" ? "Args" : "Result"}`,
    "x-bunshin-op": op,
    "x-bunshin-role": role
  };
};
var OP_REGISTRY = [
  defineOp({
    op: "echo",
    capabilityGroup: "echo",
    effect: "read",
    determinism: "fixed",
    contract: meshOperationContracts.echo,
    errors: errors([]),
    variableFields: []
  }),
  defineOp({
    op: "shell",
    capabilityGroup: "shell",
    effect: "mutate",
    determinism: "fixed",
    contract: meshOperationContracts.shell,
    errors: errors(["empty_command", "malformed_input"], ["terminal_error"]),
    variableFields: ["/startedAtMs", "/durationMs"],
    timeoutBudget: LONG_SHELL_BUDGET_MS
  }),
  defineOp({
    op: "exec.command",
    capabilityGroup: "exec",
    effect: "mutate",
    determinism: "fixed",
    contract: meshOperationContracts.exec,
    errors: errors(["empty_command", "invalid_timeout", "invalid_cwd"], ["io_error", "join_error"]),
    variableFields: ["/durationMs"],
    timeoutBudget: LONG_SHELL_BUDGET_MS
  }),
  defineOp({
    op: "exec_command",
    capabilityGroup: "terminal",
    effect: "mutate",
    determinism: "fixed",
    contract: meshOperationContracts.terminalExec,
    errors: errors(["empty_command", "malformed_input"], ["terminal_error", "terminal_lifecycle_unsupported"]),
    variableFields: ["/handleId", "/startedAtMs", "/elapsedMs"],
    timeoutBudget: AGENT_MAX_YIELD_MS
  }),
  defineOp({
    op: "write_stdin",
    capabilityGroup: "terminal",
    effect: "mutate",
    determinism: "fixed",
    contract: meshOperationContracts.terminalWrite,
    errors: errors(["unknown_handle", "replay_gap", "malformed_input"], ["terminal_error", "stdin_activity_timeout", "stdin_closed", "terminal_lifecycle_unsupported"]),
    variableFields: ["/handleId", "/startedAtMs", "/elapsedMs"],
    timeoutBudget: AGENT_MAX_YIELD_MS
  }),
  defineOp({
    op: "wait_for_command",
    capabilityGroup: "terminal",
    effect: "read",
    determinism: "fixed",
    contract: meshOperationContracts.terminalWait,
    errors: errors(["unknown_handle", "replay_gap", "malformed_input"], ["terminal_error", "terminal_lifecycle_unsupported"]),
    variableFields: ["/handleId", "/startedAtMs", "/elapsedMs"],
    timeoutBudget: AGENT_MAX_YIELD_MS
  }),
  defineOp({
    op: "kill_terminal",
    capabilityGroup: "terminal",
    effect: "mutate",
    determinism: "fixed",
    contract: meshOperationContracts.terminalKill,
    errors: errors(["unknown_handle", "malformed_input"], ["terminal_error", "terminal_lifecycle_unsupported"]),
    variableFields: ["/handleId"]
  }),
  defineOp({
    op: "fs.read",
    capabilityGroup: "fs",
    effect: "read",
    determinism: "fixed",
    contract: meshOperationContracts.fsRead,
    errors: errors(["invalid_limit", "missing_path", "unsupported_path_kind", "io_error"], ["value_too_large", "artifact_offload_failed"]),
    variableFields: ["/path"]
  }),
  defineOp({
    op: "fs.write",
    capabilityGroup: "fs",
    effect: "mutate",
    determinism: "fixed",
    contract: meshOperationContracts.fsWrite,
    errors: errors(["unsupported_path_kind", "invalid_encoding", "io_error"]),
    variableFields: ["/path"]
  }),
  defineOp({
    op: "fs.tree.pack",
    capabilityGroup: "fs",
    effect: "read",
    determinism: "fixed",
    contract: meshOperationContracts.fsTreePack,
    errors: errors(["invalid_path", "malformed_input", "archive_too_large"], ["io_error"]),
    variableFields: [],
    timeoutBudget: TREE_TRANSFER_BUDGET_MS
  }),
  defineOp({
    op: "fs.tree.apply",
    capabilityGroup: "fs",
    effect: "mutate",
    determinism: "fixed",
    contract: meshOperationContracts.fsTreeApply,
    errors: errors(["invalid_path", "malformed_input", "unsupported_format", "path_escape", "archive_too_large"], ["io_error"]),
    variableFields: [],
    timeoutBudget: TREE_TRANSFER_BUDGET_MS
  }),
  defineOp({
    op: "fs.stat",
    capabilityGroup: "fs",
    effect: "read",
    determinism: "variable",
    contract: meshOperationContracts.fsStat,
    errors: errors(["missing_path", "io_error"])
  }),
  defineOp({
    op: "fs.list",
    capabilityGroup: "fs",
    effect: "read",
    determinism: "fixed",
    contract: meshOperationContracts.fsList,
    errors: errors(["invalid_limit", "missing_path", "not_directory", "io_error"]),
    variableFields: []
  }),
  defineOp({
    op: "fs.glob",
    capabilityGroup: "fs",
    effect: "read",
    determinism: "fixed",
    contract: meshOperationContracts.fsGlob,
    errors: errors(["invalid_limit", "invalid_pattern", "invalid_glob", "io_error"]),
    variableFields: []
  }),
  defineOp({
    op: "fs.grep",
    capabilityGroup: "fs",
    effect: "read",
    determinism: "fixed",
    contract: meshOperationContracts.fsGrep,
    errors: errors(["invalid_limit", "invalid_pattern", "missing_path", "unsupported_path_kind", "io_error"], ["value_too_large"]),
    variableFields: ["/path"]
  }),
  defineOp({
    op: "doctor.report",
    capabilityGroup: "doctor",
    effect: "read",
    determinism: "variable",
    contract: meshOperationContracts.doctor,
    errors: errors([])
  }),
  defineOp({
    op: "service.restart",
    capabilityGroup: "service",
    effect: "mutate",
    determinism: "fixed",
    contract: meshOperationContracts.service,
    errors: errors(["service_not_configured", "service_restart_failed"]),
    variableFields: []
  }),
  defineOp({
    op: "release",
    capabilityGroup: "release",
    effect: "mutate",
    determinism: "fixed",
    contract: meshOperationContracts.release,
    errors: errors(["empty_payload", "invalid_retention", "unsafe_path", "unsupported_path_kind", "invalid_encoding", "io_error"], ["unsupported_platform", "health_check_failed"]),
    variableFields: []
  }),
  defineOp({
    op: "capability.manifest",
    capabilityGroup: "capability",
    effect: "read",
    exposure: "agent-to-hub",
    determinism: "fixed",
    contract: meshOperationContracts.manifest,
    errors: errors(["invalid_capability_manifest", "unauthorized"]),
    variableFields: []
  }),
  defineOp({
    op: "agent.restart",
    capabilityGroup: "agent",
    effect: "mutate",
    determinism: "fixed",
    disruption: "agent",
    contract: meshOperationContracts.agentRestart,
    errors: errors(["restart_binary_unexecutable", "restart_already_scheduled"]),
    variableFields: ["/pid"],
    timeoutBudget: 1e4
  }),
  defineOp({
    op: "process.info",
    capabilityGroup: "agent",
    effect: "read",
    determinism: "variable",
    contract: meshOperationContracts.processInfo,
    errors: errors(["process_not_found"], ["unsupported_platform"])
  }),
  defineOp({
    op: "mesh.message",
    capabilityGroup: "message",
    effect: "mutate",
    determinism: "variable",
    contract: meshOperationContracts.meshMessage,
    errors: errors(["message_too_large"], ["inbox_unavailable"]),
    variableFields: ["/seq"]
  }),
  defineOp({
    op: "bridge.list",
    capabilityGroup: "bridge",
    effect: "read",
    determinism: "variable",
    contract: meshOperationContracts.bridgeList,
    errors: errors([])
  }),
  defineOp({
    op: "bridge.probe",
    capabilityGroup: "bridge",
    effect: "read",
    determinism: "variable",
    contract: meshOperationContracts.bridgeProbe,
    errors: errors([]),
    variableFields: [],
    timeoutBudget: 30000
  }),
  defineOp({
    op: "bridge.invoke",
    capabilityGroup: "bridge",
    effect: "mutate",
    determinism: "variable",
    contract: meshOperationContracts.bridgeInvoke,
    errors: errors(["bridge_cycle", "bridge_tier_unsupported", "bridge_disabled"], [
      "bridge_target_unknown",
      "bridge_target_unreachable",
      "bridge_auth_denied",
      "bridge_hostkey_mismatch",
      "bridge_timeout"
    ]),
    variableFields: ["/via", "/hostKeyFp", "/tier", "/response"],
    timeoutBudget: LONG_SHELL_BUDGET_MS
  }),
  defineOp({
    op: "artifact.put",
    capabilityGroup: "artifact",
    effect: "mutate",
    exposure: "hub-http",
    determinism: "fixed",
    contract: meshOperationContracts.artifactPut,
    errors: errors(["invalid_request", "unauthorized"], ["artifact_store_failed"]),
    variableFields: ["/uploadUrl"]
  }),
  defineOp({
    op: "artifact.get",
    capabilityGroup: "artifact",
    effect: "read",
    exposure: "hub-http",
    determinism: "fixed",
    contract: meshOperationContracts.artifactGet,
    errors: errors(["invalid_request", "unauthorized", "artifact_not_found"], ["artifact_store_failed"]),
    variableFields: ["/downloadUrl"]
  }),
  defineOp({
    op: "artifact.transfer.ticket",
    capabilityGroup: "artifact",
    effect: "mutate",
    exposure: "hub-http",
    determinism: "variable",
    contract: meshOperationContracts.artifactTransferTicket,
    errors: errors(["invalid_request", "unauthorized", "artifact_not_found"], ["machine_unavailable", "artifact_store_failed"])
  }),
  defineOp({
    op: "artifact.transfer.serve",
    capabilityGroup: "artifact",
    effect: "mutate",
    determinism: "variable",
    contract: meshOperationContracts.artifactTransferServe,
    errors: errors([])
  })
];
var OP_EFFECTS = Object.freeze(Object.fromEntries(OP_REGISTRY.map(({ op, effect }) => [op, effect])));
var OP_EXPOSURE = Object.freeze(Object.fromEntries(OP_REGISTRY.map(({ op, exposure }) => [op, exposure])));
var opsByGroup = new Map;
for (const { op, capabilityGroup } of OP_REGISTRY) {
  const ops = opsByGroup.get(capabilityGroup);
  if (ops === undefined)
    opsByGroup.set(capabilityGroup, [op]);
  else
    ops.push(op);
}
var CAPABILITY_GROUPS = Object.freeze(Object.fromEntries([...opsByGroup].map(([group, ops]) => [group, Object.freeze(ops)])));
var opSchemaArtifacts = OP_REGISTRY.flatMap((entry) => [
  { fileName: `op-${entry.op.replaceAll(".", "-")}-args.json`, schema: entry.argsSchema },
  { fileName: `op-${entry.op.replaceAll(".", "-")}-result.json`, schema: entry.resultSchema }
]);
var protocolOpRegistry = {
  version: 1,
  features: PROTOCOL_FEATURES,
  ops: OP_REGISTRY.map((entry) => ({
    op: entry.op,
    capabilityGroup: entry.capabilityGroup,
    effect: entry.effect,
    exposure: entry.exposure,
    transport: entry.transport,
    determinism: entry.determinism,
    disruption: entry.disruption,
    variableFields: entry.variableFields,
    timeoutBudget: entry.timeoutBudget,
    errors: entry.errors
  })),
  capabilityGroups: CAPABILITY_GROUPS,
  constants: {
    AGENT_MAX_YIELD_MS,
    HUB_PENDING_RESPONSE_TIMEOUT_MS,
    SDK_MAX_DEADLINE_MS,
    DURABLE_INVOKE_INFLIGHT_RETENTION_MS,
    DURABLE_INVOKE_RESULT_RETENTION_MS,
    DURABLE_INVOKE_INLINE_MAX_BYTES,
    LONG_SHELL_BUDGET_MS,
    DURABLE_INVOKE_MAX_BUDGET_MS,
    HEARTBEAT_MS,
    PONG_TIMEOUT_MS,
    ARTIFACT_OFFLOAD_THRESHOLD_BYTES,
    TERMINAL_YIELD_MIN_MS,
    TERMINAL_MAX_YIELD_MS,
    TRANSFER_CANDIDATE_TTL_MS,
    TRANSFER_TICKET_TTL_MS,
    TRANSFER_PROBE_TIMEOUT_MS,
    TRANSFER_MAX_STREAM_MS,
    TRANSFER_IDLE_TIMEOUT_MS,
    TRANSFER_REDEEM_TIMEOUT_MS,
    TREE_TRANSFER_BUDGET_MS,
    TREE_ARCHIVE_MAX_BYTES,
    TREE_ARCHIVE_FORMATS
  }
};
// ../protocol/src/parser.ts
import { Errors } from "@sinclair/typebox/errors";
import { Check } from "@sinclair/typebox/value";
// ../protocol/src/schemas.ts
var protocolSchemaArtifacts = [
  { fileName: "capability-manifest.json", schema: CapabilityManifestSchema },
  { fileName: "command-state.json", schema: CommandStateSchema },
  { fileName: "disconnected.json", schema: DisconnectedSchema },
  { fileName: "doctor-report.json", schema: DoctorReportSchema },
  { fileName: "durable-result-envelope.json", schema: DurableResultEnvelopeSchema },
  { fileName: "exec-command-request.json", schema: ExecCommandRequestSchema },
  { fileName: "hub-error.json", schema: HubErrorSchema },
  { fileName: "hub-event.json", schema: HubEventSchema },
  { fileName: "hub-policy.json", schema: HubPolicySchema },
  { fileName: "hub-request.json", schema: HubRequestSchema },
  { fileName: "hub-session.json", schema: HubSessionSchema },
  { fileName: "hub-subscribe.json", schema: HubSubscribeSchema },
  { fileName: "hub-unsubscribe.json", schema: HubUnsubscribeSchema },
  { fileName: "hub-transfer-probe.json", schema: HubTransferProbeSchema },
  { fileName: "hub-transfer-redeem-result.json", schema: HubTransferRedeemResultSchema },
  { fileName: "mesh-invoke.json", schema: MeshInvokeSchema },
  { fileName: "mesh-invoke-provenance.json", schema: MeshInvokeProvenanceSchema },
  { fileName: "mesh-manifest.json", schema: MeshManifestSchema },
  { fileName: "mesh-response.json", schema: MeshResponseSchema },
  { fileName: "mesh-transfer-candidates.json", schema: MeshTransferCandidatesSchema },
  { fileName: "mesh-transfer-probe-result.json", schema: MeshTransferProbeResultSchema },
  { fileName: "mesh-transfer-redeem.json", schema: MeshTransferRedeemSchema },
  { fileName: "resumable.json", schema: ResumableSchema },
  { fileName: "shell-request.json", schema: ShellRequestSchema },
  { fileName: "shell-result.json", schema: ShellResultSchema },
  { fileName: "stdin-effect.json", schema: StdinEffectSchema },
  { fileName: "terminal-handle.json", schema: TerminalHandleSchema },
  { fileName: "terminal-lifecycle.json", schema: TerminalLifecycleSchema },
  { fileName: "terminal-message.json", schema: TerminalMessageSchema },
  { fileName: "wait-for-command-request.json", schema: WaitForCommandRequestSchema },
  { fileName: "write-stdin-request.json", schema: WriteStdinRequestSchema },
  ...opSchemaArtifacts
];
var schemaFileNames = protocolSchemaArtifacts.map((artifact) => artifact.fileName);
// src/terminal-frame.ts
import { Value } from "@sinclair/typebox/value";
var field = (value, key) => typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
var stringField = (value, key) => {
  const found = field(value, key);
  return typeof found === "string" ? found : undefined;
};
var numberField = (value, key) => {
  const found = field(value, key);
  return typeof found === "number" ? found : undefined;
};
var booleanField = (value, key) => {
  const found = field(value, key);
  return typeof found === "boolean" ? found : undefined;
};

class TerminalFrameError extends Error {
  constructor(label) {
    super(`${label} is not a terminal result`);
    this.name = "TerminalFrameError";
  }
}
var parseTerminalLifecycle = (value) => {
  if (value === undefined)
    return;
  if (!Value.Check(TerminalLifecycleSchema, value))
    throw new TerminalFrameError("lifecycle");
  return value;
};
var parseTerminalFrame = (value, label) => {
  const handleId = stringField(value, "handleId");
  const output = stringField(value, "output");
  const state = stringField(value, "state");
  const lastSeq = numberField(value, "lastSeq");
  if (handleId === undefined || output === undefined || state === undefined || lastSeq === undefined) {
    throw new TerminalFrameError(label);
  }
  const exitCode = numberField(value, "exitCode");
  const startedAtMs = numberField(value, "startedAtMs");
  const elapsedMs = numberField(value, "elapsedMs");
  const lifecycle = parseTerminalLifecycle(field(value, "lifecycle"));
  const stdinEffect = field(value, "stdinEffect");
  if (stdinEffect !== undefined && !Value.Check(StdinEffectSchema, stdinEffect)) {
    throw new TerminalFrameError("stdinEffect");
  }
  return {
    ...lifecycle === undefined ? {} : { lifecycle },
    ...stdinEffect === undefined ? {} : { stdinEffect },
    handleId,
    output,
    state,
    lastSeq,
    truncated: booleanField(value, "truncated") ?? false,
    omittedBytes: numberField(value, "omittedBytes") ?? 0,
    totalBytes: numberField(value, "totalBytes") ?? lastSeq,
    ...exitCode === undefined ? {} : { exitCode },
    ...startedAtMs === undefined ? {} : { startedAtMs },
    ...elapsedMs === undefined ? {} : { elapsedMs }
  };
};
var parseTerminalKill = (value, label) => {
  const handleId = stringField(value, "handleId");
  const state = stringField(value, "state");
  const reason = stringField(value, "reason");
  if (handleId === undefined || state !== "task-failed" || reason !== "killed") {
    throw new TerminalFrameError(label);
  }
  const lifecycle = parseTerminalLifecycle(field(value, "lifecycle"));
  return { handleId, state, reason, ...lifecycle === undefined ? {} : { lifecycle } };
};
var isUnknownHandleError = (error) => machineErrorCode(error) === "unknown_handle";
var machineErrorCode = (error) => error instanceof Error && Reflect.get(error, "code") === "machine_error" ? stringField(Reflect.get(error, "detail"), "code") : undefined;
var RETAINED_FROM = /(?:replay is available from|precedes retained output at) (\d+)/;
var replayGapRetainedFrom = (error) => {
  if (!(error instanceof Error) || machineErrorCode(error) !== "replay_gap")
    return;
  const message = stringField(Reflect.get(error, "detail"), "message") ?? error.message;
  const match = RETAINED_FROM.exec(message);
  const offset = match?.[1] === undefined ? Number.NaN : Number.parseInt(match[1], 10);
  return Number.isSafeInteger(offset) ? offset : undefined;
};

// src/command-handle.ts
class TerminalLifecycleUnsupportedError extends Error {
  constructor() {
    super("machine does not advertise terminal-lifecycle:v1");
    this.name = "TerminalLifecycleUnsupportedError";
  }
}

class StdinActivityTimeoutError extends Error {
  status;
  acceptedBytes;
  constructor(status, acceptedBytes) {
    super("stdin was accepted but no terminal activity was observed; do not resend the input");
    this.name = "StdinActivityTimeoutError";
    this.status = status;
    this.acceptedBytes = acceptedBytes;
  }
}

class CommandKilledError extends Error {
  constructor(handleId) {
    super(`command ${handleId} was killed`);
    this.name = "CommandKilledError";
  }
}

class CommandHandleLostError extends Error {
  reason;
  status;
  constructor(handleId, reason = "unknown_handle", status) {
    super(`command ${handleId} is no longer known to its machine: ${reason}`);
    this.name = "CommandHandleLostError";
    this.reason = reason;
    this.status = status;
  }
}
var STATUS_YIELD_MS = 250;
var WAIT_YIELD_MS = 1e4;
var MAX_GAP_RESYNCS = 5;
var isTerminal = (state) => state === "exited" || state === "killed" || state === "lost";
var hasExited = (frame) => frame.state === "completed" || frame.lifecycle !== undefined && isTerminal(frame.lifecycle.state);
var STATES = ["starting", "running", "waiting_input", "exited", "killed", "lost"];
var gapMarker = (omittedBytes) => `
[bunshin: ${omittedBytes} bytes of output were not retained by the agent]
`;
var withGap = (frame, omittedBytes) => omittedBytes <= 0 ? { frame, omittedBytes: 0 } : { frame: { ...frame, output: gapMarker(omittedBytes) + frame.output }, omittedBytes };

class Command {
  handleId;
  invoke;
  initial;
  now;
  firstSeenAt;
  supportsLifecycle;
  latest;
  statusCursor;
  statusOmitted;
  cachedStatus;
  killed = false;
  killing;
  constructor(invoke, initial, now, supportsLifecycle) {
    this.invoke = invoke;
    this.supportsLifecycle = supportsLifecycle;
    this.initial = initial;
    this.now = now;
    this.firstSeenAt = now();
    this.latest = initial;
    this.handleId = initial.handleId;
    this.statusCursor = initial.lastSeq;
    this.statusOmitted = initial.omittedBytes;
  }
  get seededOmitted() {
    return this.initial.omittedBytes;
  }
  async status() {
    const cached = this.cachedStatus;
    if (cached !== undefined) {
      return cached;
    }
    if (hasExited(this.latest)) {
      this.statusCursor = this.latest.lastSeq;
      return this.statusOf(this.latest, this.statusOmitted);
    }
    const polled = await this.poll(this.statusCursor, STATUS_YIELD_MS);
    if (polled === undefined) {
      return this.killedSnapshot();
    }
    this.statusCursor = polled.frame.lastSeq;
    this.statusOmitted += polled.omittedBytes;
    return this.statusOf(polled.frame, this.statusOmitted);
  }
  async wait(options) {
    if (options !== undefined)
      return this.waitUntil(options);
    this.assertAlive();
    let collected = this.initial.output;
    let omitted = this.seededOmitted;
    let cursor = this.initial.lastSeq;
    if (hasExited(this.initial)) {
      return this.exitOf(this.initial, collected, omitted);
    }
    for (;; ) {
      const polled = await this.poll(cursor, WAIT_YIELD_MS);
      if (polled === undefined) {
        throw new CommandKilledError(this.handleId);
      }
      collected += polled.frame.output;
      omitted += polled.omittedBytes;
      cursor = polled.frame.lastSeq;
      if (hasExited(polled.frame)) {
        return this.exitOf(polled.frame, collected, omitted);
      }
    }
  }
  async waitUntil(options) {
    const { until, timeoutMs } = options;
    if (!Array.isArray(until) || until.length === 0 || until.some((state) => !STATES.includes(state))) {
      throw new TypeError("until must be a nonempty array of known terminal states");
    }
    if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs < 0)) {
      throw new TypeError("timeoutMs must be finite and nonnegative");
    }
    if (!this.supportsLifecycle && until.some((state) => state === "waiting_input" || state === "starting")) {
      throw new TerminalLifecycleUnsupportedError;
    }
    const deadline = timeoutMs === undefined ? Number.POSITIVE_INFINITY : this.now() + timeoutMs;
    let frame = this.latest;
    let omitted = this.seededOmitted;
    for (;; ) {
      const status = this.cachedStatus ?? this.statusOf(frame, omitted);
      const matched = until.includes(status.state);
      if (matched || isTerminal(status.state))
        return { status, matched, reason: matched ? "matched" : "terminal" };
      const remaining = deadline - this.now();
      if (remaining <= 0)
        return { status, matched: false, reason: "timeout" };
      if (remaining < STATUS_YIELD_MS) {
        await new Promise((resolve) => setTimeout(resolve, remaining));
        frame = this.latest;
        continue;
      }
      try {
        const polled = await this.poll(frame.lastSeq, Math.min(WAIT_YIELD_MS, remaining), { until, deadline });
        if (polled !== undefined) {
          frame = polled.frame;
          omitted += polled.omittedBytes;
        }
      } catch (error) {
        if (!(error instanceof TerminalWaitDeadlineError))
          throw error;
        const status = this.cachedStatus ?? this.statusOf(this.latest, omitted);
        const matched = until.includes(status.state);
        return { status, matched, reason: matched ? "matched" : isTerminal(status.state) ? "terminal" : "timeout" };
      }
    }
  }
  output() {
    return this.stream();
  }
  async write(data, options) {
    this.assertAlive();
    const expectActivityMs = options?.expectActivityMs;
    if (options !== undefined) {
      if (typeof data !== "string" || data.length === 0 || !Number.isInteger(expectActivityMs) || expectActivityMs === undefined || expectActivityMs < 250 || expectActivityMs > 1e4) {
        throw new TypeError("stdin activity gate requires nonempty data and expectActivityMs in 250..10000");
      }
      if (!this.supportsLifecycle)
        throw new TerminalLifecycleUnsupportedError;
    }
    try {
      const frame = parseTerminalFrame(await this.invoke("write_stdin", {
        handle_id: this.handleId,
        data,
        yield_ms: STATUS_YIELD_MS,
        ...this.lifecycleArgs,
        ...expectActivityMs === undefined ? {} : { expectActivityMs }
      }), "write_stdin result");
      if (!this.killed)
        this.latest = frame;
      if (expectActivityMs !== undefined) {
        if (frame.stdinEffect === undefined)
          throw new TypeError("write_stdin result is missing stdinEffect");
        const status = this.statusOf(frame, this.statusOmitted);
        if (!frame.stdinEffect.observed)
          throw new StdinActivityTimeoutError(status, frame.stdinEffect.acceptedBytes);
        return { status, stdinEffect: frame.stdinEffect };
      }
    } catch (error) {
      if (error instanceof HubTransportError && typeof error.detail === "object" && error.detail !== null && Reflect.get(error.detail, "code") === "stdin_activity_timeout") {
        const frame = parseTerminalFrame(error.result, "stdin activity timeout result");
        if (frame.stdinEffect === undefined)
          throw new TypeError("stdin activity timeout is missing acceptedBytes");
        if (!this.killed)
          this.latest = frame;
        throw new StdinActivityTimeoutError(this.statusOf(frame, this.statusOmitted), frame.stdinEffect.acceptedBytes);
      }
      throw this.translate(error);
    }
  }
  get lifecycleArgs() {
    return this.supportsLifecycle ? { lifecycleVersion: 1 } : {};
  }
  async kill() {
    if (this.killed) {
      return;
    }
    const inFlight = this.killing;
    if (inFlight !== undefined) {
      return inFlight;
    }
    const attempt = this.sendKill();
    this.killing = attempt;
    try {
      await attempt;
    } finally {
      this.killing = undefined;
    }
  }
  async sendKill() {
    try {
      await this.invoke("kill_terminal", { handle_id: this.handleId, ...this.lifecycleArgs });
    } catch (error) {
      throw this.translate(error);
    }
    this.killed = true;
    this.cachedStatus = this.killedSnapshot();
  }
  async killWon() {
    const pending = this.killing;
    if (pending !== undefined) {
      await pending.catch(() => {
        return;
      });
    }
    return this.killed;
  }
  async* stream() {
    if (this.killed) {
      return;
    }
    if (this.initial.output.length > 0) {
      yield this.initial.output;
    }
    if (hasExited(this.initial)) {
      return;
    }
    let cursor = this.initial.lastSeq;
    while (!this.killed) {
      const polled = await this.poll(cursor, WAIT_YIELD_MS);
      if (polled === undefined) {
        return;
      }
      cursor = polled.frame.lastSeq;
      if (polled.frame.output.length > 0) {
        yield polled.frame.output;
      }
      if (hasExited(polled.frame)) {
        return;
      }
    }
  }
  async poll(lastSeq, yieldMs, wait) {
    let cursor = lastSeq;
    let yieldFor = yieldMs;
    for (let resyncs = 0;; resyncs += 1) {
      try {
        const frame = await this.pollOnce(cursor, yieldFor, wait);
        if (frame === undefined) {
          return;
        }
        return withGap(frame, cursor - lastSeq);
      } catch (error) {
        if (await this.killWon()) {
          return;
        }
        const retainedFrom = replayGapRetainedFrom(error);
        if (retainedFrom === undefined || retainedFrom <= cursor || resyncs >= MAX_GAP_RESYNCS) {
          throw this.translate(error);
        }
        cursor = retainedFrom;
        yieldFor = STATUS_YIELD_MS;
      }
    }
  }
  async pollOnce(lastSeq, yieldMs, wait) {
    const remaining = wait === undefined ? Number.POSITIVE_INFINITY : wait.deadline - this.now();
    if (remaining < STATUS_YIELD_MS) {
      if (remaining > 0)
        await new Promise((resolve) => setTimeout(resolve, remaining));
      return this.killed ? undefined : this.latest;
    }
    const frame = parseTerminalFrame(await this.invoke("wait_for_command", {
      handle_id: this.handleId,
      yield_ms: Math.floor(Math.min(yieldMs, remaining)),
      last_seq: lastSeq,
      ...this.lifecycleArgs,
      ...this.supportsLifecycle && wait !== undefined ? { until: wait.until } : {}
    }, Number.isFinite(remaining) ? { timeoutMs: remaining } : undefined), "wait_for_command result");
    if (await this.killWon()) {
      return;
    }
    this.latest = frame;
    return frame;
  }
  translate(error) {
    if (isUnknownHandleError(error) && error instanceof Error) {
      const result = Reflect.get(error, "result");
      const lifecycle = parseTerminalLifecycle(typeof result === "object" && result !== null ? Reflect.get(result, "lifecycle") : undefined);
      const lost = lifecycle?.state === "lost" ? lifecycle : { state: "lost", reason: "unknown_handle", stdinOpen: false, outputClosed: false };
      const status = { ...this.statusOf(this.latest, this.statusOmitted), state: lost.state, lifecycle: lost };
      this.cachedStatus = status;
      return new CommandHandleLostError(this.handleId, lost.reason, status);
    }
    return error instanceof Error ? error : new Error(String(error));
  }
  killedSnapshot() {
    return this.cachedStatus ?? {
      ...this.statusOf(this.latest, this.statusOmitted),
      state: "killed",
      lifecycle: { state: "killed", stdinOpen: false, outputClosed: true }
    };
  }
  assertAlive() {
    if (this.killed) {
      throw new CommandKilledError(this.handleId);
    }
  }
  elapsedOf(frame) {
    return frame.elapsedMs ?? Math.round(this.now() - this.firstSeenAt);
  }
  statusOf(frame, omittedBytes) {
    const lifecycle = this.supportsLifecycle && frame.lifecycle !== undefined ? frame.lifecycle : frame.state === "completed" ? { state: "exited", exitCode: frame.exitCode ?? 0, stdinOpen: false, outputClosed: true } : { state: "running", stdinOpen: true, outputClosed: false };
    const exitCode = lifecycle.state === "exited" ? lifecycle.exitCode : frame.exitCode;
    return {
      state: lifecycle.state,
      lifecycle,
      elapsedMs: this.elapsedOf(frame),
      output: frame.output,
      truncated: omittedBytes > 0,
      omittedBytes,
      totalBytes: frame.totalBytes,
      lastSeq: frame.lastSeq,
      ...exitCode === undefined ? {} : { exitCode }
    };
  }
  exitOf(frame, collected, omittedBytes) {
    if (frame.lifecycle?.state === "killed")
      throw new CommandKilledError(this.handleId);
    if (frame.lifecycle?.state === "lost")
      throw new CommandHandleLostError(this.handleId, frame.lifecycle.reason, this.statusOf(frame, omittedBytes));
    return {
      exitCode: frame.exitCode ?? 0,
      output: collected,
      durationMs: this.elapsedOf(frame),
      truncated: omittedBytes > 0,
      omittedBytes
    };
  }
}
var spawnCommand = async (invoke, command, { options = {}, now = () => performance.now(), protocolFeatures = [] } = {}) => {
  const supportsLifecycle = protocolFeatures.includes("terminal-lifecycle:v1");
  const frame = parseTerminalFrame(await invoke("exec_command", {
    cmd: command,
    yield_ms: STATUS_YIELD_MS,
    ...supportsLifecycle ? { lifecycleVersion: 1 } : {},
    ...options.cwd === undefined ? {} : { workdir: options.cwd }
  }), "exec_command result");
  return new Command(invoke, frame, now, supportsLifecycle);
};
// src/fanout-run.ts
class FanoutRun {
  [Symbol.toStringTag] = "FanoutRun";
  #result;
  #log = [];
  #observers = [];
  #wakers = [];
  #total;
  #finished = false;
  #failure;
  constructor(drive) {
    const sink = {
      planned: (total) => {
        this.#total = total;
        for (const observer of this.#observers)
          observer.planned(total);
      },
      emit: (outcome) => {
        this.#log.push(outcome);
        for (const observer of this.#observers)
          observer.emit(outcome);
        this.#wake();
      }
    };
    let driven;
    try {
      driven = drive(sink);
    } catch (error) {
      driven = Promise.reject(error);
    }
    this.#result = driven.then((result) => {
      this.#finished = true;
      this.#wake();
      return result;
    }, (error) => {
      this.#failure = { error };
      this.#finished = true;
      this.#wake();
      throw error;
    });
  }
  static defer(pending, start) {
    return new FanoutRun(async (sink) => {
      const inner = start(await pending);
      inner.#observe(sink);
      return inner.#result;
    });
  }
  get settled() {
    return this.#log.length;
  }
  get remaining() {
    return this.#total === undefined ? 0 : this.#total - this.#log.length;
  }
  get total() {
    return this.#total;
  }
  then(onfulfilled, onrejected) {
    return this.#result.then(onfulfilled, onrejected);
  }
  catch(onrejected) {
    return this.#result.catch(onrejected);
  }
  finally(onfinally) {
    return this.#result.finally(onfinally);
  }
  async* [Symbol.asyncIterator]() {
    this.#result.catch(() => {});
    let cursor = 0;
    for (;; ) {
      const next = this.#log[cursor];
      if (next !== undefined) {
        cursor += 1;
        yield next;
        continue;
      }
      if (this.#finished) {
        if (this.#failure !== undefined)
          throw this.#failure.error;
        return;
      }
      await new Promise((resolve) => {
        this.#wakers.push(resolve);
      });
    }
  }
  #observe(observer) {
    if (this.#total !== undefined)
      observer.planned(this.#total);
    for (const outcome of this.#log)
      observer.emit(outcome);
    this.#observers.push(observer);
  }
  #wake() {
    const wakers = this.#wakers;
    this.#wakers = [];
    for (const wake of wakers)
      wake();
  }
}

// ../protocol/src/composed-tools.ts
import { Buffer as Buffer2 } from "node:buffer";

class ComposedToolInputError extends Error {
  reason;
  constructor(reason) {
    super(`invalid composed tool input: ${reason}`);
    this.name = "ComposedToolInputError";
    this.reason = reason;
  }
}

class ComposedToolResultError extends Error {
  capability;
  reason;
  constructor(capability, reason) {
    super(`invalid ${capability} result: ${reason}`);
    this.name = "ComposedToolResultError";
    this.capability = capability;
    this.reason = reason;
  }
}
var createMachineComposedTools = (dependencies) => ({
  read: (path, options) => readText(dependencies, path, options),
  readBytes: (path, options) => readBinary(dependencies, path, options),
  write: (path, content, options) => writeContent(dependencies, { path, content, ...options === undefined ? {} : { options } }),
  glob: (pattern, options) => dependencies.invoke("fs.glob", globPayload(pattern, options)),
  grep: (path, pattern, options) => dependencies.invoke("fs.grep", grepPayload(path, pattern, options)),
  edit: (path, spec) => editText(dependencies, path, spec)
});
var readText = async (dependencies, path, options) => Buffer2.from(await readBinary(dependencies, path, options)).toString("utf8");
var readBinary = async (dependencies, path, options) => decodeReadResult(await dependencies.invoke("fs.read", readPayload(path, options)));
var writeContent = (dependencies, request) => dependencies.invoke("fs.write", writePayload(request.path, request.content, request.options));
var editText = async (dependencies, path, spec) => {
  dependencies.requireCapability("fs.read");
  dependencies.requireCapability("fs.write");
  if (spec.exact.length === 0) {
    throw new ComposedToolInputError("exact substring must not be empty");
  }
  const content = await readText(dependencies, path);
  const pieces = content.split(spec.exact);
  if (pieces.length === 1) {
    throw new ComposedToolInputError("exact substring was not found");
  }
  const nextContent = pieces.join(spec.replacement);
  const writeResult = await writeContent(dependencies, { path, content: nextContent });
  return {
    path,
    content: nextContent,
    replacements: pieces.length - 1,
    writeResult
  };
};
var readPayload = (path, options) => {
  if (options?.limitBytes === undefined) {
    return { path };
  }
  return { path, limit_bytes: options.limitBytes };
};
var writePayload = (path, content, options) => {
  const bytes = typeof content === "string" ? Buffer2.from(content, "utf8") : content;
  return {
    path,
    bytes: Buffer2.from(bytes).toString("base64"),
    create_parent_dirs: options?.createParentDirs ?? false
  };
};
var globPayload = (pattern, options) => {
  if (options?.limit === undefined) {
    return { pattern };
  }
  return { pattern, limit: options.limit };
};
var grepPayload = (path, pattern, options) => {
  if (options?.limit === undefined) {
    return { path, pattern };
  }
  return { path, pattern, limit: options.limit };
};
var decodeReadResult = (result) => {
  if (typeof result === "string") {
    return Uint8Array.from(Buffer2.from(result, "utf8"));
  }
  if (!isReadResultRecord(result)) {
    throw new ComposedToolResultError("fs.read", "result must be an object or string");
  }
  const content = result.content;
  if (result.truncated === true) {
    throw new ComposedToolResultError("fs.read", "read result is truncated; increase limitBytes");
  }
  if (typeof content === "string") {
    return Uint8Array.from(Buffer2.from(content, "utf8"));
  }
  if (result.bytes !== undefined && typeof result.truncated !== "boolean") {
    throw new ComposedToolResultError("fs.read", "truncated must be a boolean for byte results");
  }
  const decoded = decodeReadBytes(result.bytes);
  const sizeBytes = readResultSize(result);
  if (sizeBytes === undefined) {
    throw new ComposedToolResultError("fs.read", "byte results must include sizeBytes or size_bytes");
  }
  if (decoded.sizeBytes !== sizeBytes) {
    throw new ComposedToolResultError("fs.read", "full bytes length does not match sizeBytes");
  }
  return decoded.bytes;
};
var decodeReadBytes = (value) => {
  if (!isReadBytesRecord(value)) {
    throw new ComposedToolResultError("fs.read", "bytes must be an object");
  }
  const kind = value.kind;
  if (kind === "truncated") {
    throw new ComposedToolResultError("fs.read", "read result is truncated; increase limitBytes");
  }
  if (kind !== "full") {
    throw new ComposedToolResultError("fs.read", "bytes.kind must be full or truncated");
  }
  const base64 = value.base64;
  if (typeof base64 === "string") {
    const bytes = Buffer2.from(base64, "base64");
    return { bytes: Uint8Array.from(bytes), sizeBytes: bytes.length };
  }
  const bytes = value.bytes;
  if (isByteArray(bytes)) {
    return { bytes: Uint8Array.from(bytes), sizeBytes: bytes.length };
  }
  throw new ComposedToolResultError("fs.read", "full bytes must include base64 or byte array");
};
var readResultSize = (result) => {
  const value = result.sizeBytes ?? result.size_bytes;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
};
var isReadResultRecord = (value) => typeof value === "object" && value !== null;
var isReadBytesRecord = (value) => typeof value === "object" && value !== null;
var isByteArray = (value) => Array.isArray(value) && value.every((item) => Number.isInteger(item) && item >= 0 && item <= 255);

// src/machine-row.ts
var machineDirectoryFields = (record) => ({
  id: record.id,
  kind: record.kind,
  routes: record.routes,
  connection: record.connection,
  ...record.via === undefined ? {} : { via: record.via },
  ...record.identityConflict === undefined ? {} : { identityConflict: record.identityConflict },
  ...record.policy === undefined ? {} : { policy: record.policy },
  alias: record.alias,
  os: record.os,
  arch: record.arch,
  tags: record.tags,
  state: record.state,
  ...record.lastActivityMs === undefined ? {} : { lastActivityMs: record.lastActivityMs },
  ...record.lastSeenMs === undefined ? {} : { lastSeenMs: record.lastSeenMs },
  ...record.onlineBasis === undefined ? {} : { onlineBasis: record.onlineBasis },
  ...record.attention === undefined ? {} : { attention: record.attention },
  ...record.protocolFeatures === undefined ? {} : { protocolFeatures: record.protocolFeatures },
  ...record.build === undefined ? {} : { build: record.build },
  ...record.host === undefined ? {} : { host: record.host },
  ...record.restartNeeded === undefined ? {} : { restartNeeded: record.restartNeeded },
  ...record.unsupported === undefined ? {} : { unsupported: record.unsupported }
});

// src/machine-operations.ts
var mergeCallOptions = (bound, override) => {
  const route = override?.route ?? bound.route;
  const capabilityToken = override?.capabilityToken ?? bound.capabilityToken;
  const taskId = override?.taskId ?? bound.taskId;
  const opId = override?.opId ?? bound.opId;
  const taskContext = bound.taskContext;
  const signal = bound.signal !== undefined && override?.signal !== undefined && bound.signal !== override.signal ? AbortSignal.any([bound.signal, override.signal]) : override?.signal ?? bound.signal;
  return {
    ...route === undefined ? {} : { route },
    ...bound.bridgesEnabled === undefined ? {} : { bridgesEnabled: bound.bridgesEnabled },
    ...capabilityToken === undefined ? {} : { capabilityToken },
    ...taskId === undefined ? {} : { taskId },
    ...opId === undefined ? {} : { opId },
    ...taskContext === undefined ? {} : { taskContext },
    ...signal === undefined ? {} : { signal },
    ...override?.terminalTimeoutMs === undefined ? {} : { terminalTimeoutMs: override.terminalTimeoutMs }
  };
};
var shellPayloadFrom = (command, options) => ({
  kind: "shell",
  command,
  ...options?.cwd === undefined ? {} : { cwd: options.cwd },
  ...options?.env === undefined ? {} : { env: options.env },
  ...options?.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }
});
var shellPayload = (input, options) => {
  if (typeof input === "string") {
    return shellPayloadFrom(input, options);
  }
  return shellPayloadFrom(input.command, input);
};
var parseMessageResult = (result) => {
  if (typeof result !== "object" || result === null || !("accepted" in result) || result.accepted !== true || !("seq" in result) || typeof result.seq !== "number" || !Number.isInteger(result.seq) || !("inboxPath" in result) || typeof result.inboxPath !== "string") {
    throw new TypeError("malformed mesh.message result");
  }
  return { accepted: true, seq: result.seq, inboxPath: result.inboxPath };
};
var parseRestartResult = (result) => {
  if (typeof result !== "object" || result === null || !("scheduledInMs" in result) || typeof result.scheduledInMs !== "number" || !Number.isInteger(result.scheduledInMs) || !("pid" in result) || typeof result.pid !== "number" || !Number.isInteger(result.pid)) {
    throw new TypeError("malformed agent.restart result");
  }
  return { scheduledInMs: result.scheduledInMs, pid: result.pid };
};
var isProcessInfo = (result) => typeof result === "object" && result !== null && ("pid" in result) && typeof result.pid === "number" && ("startedAtMs" in result) && typeof result.startedAtMs === "number" && ("cpuTimeMs" in result) && typeof result.cpuTimeMs === "number" && ("rssBytes" in result) && typeof result.rssBytes === "number" && ("command" in result) && typeof result.command === "string" && (!("lastOpAtMs" in result) || result.lastOpAtMs === undefined || typeof result.lastOpAtMs === "number");
var parseProcessInfoResult = (result) => {
  if (!isProcessInfo(result))
    throw new TypeError("malformed process.info result");
  return result;
};
var terminalFields = (invoke) => ({
  exec_command: async (args, callOptions) => parseTerminalFrame(await invoke("exec_command", args, callOptions), "exec_command result"),
  write_stdin: async (args, callOptions) => parseTerminalFrame(await invoke("write_stdin", args, callOptions), "write_stdin result"),
  wait_for_command: async (args, callOptions) => parseTerminalFrame(await invoke("wait_for_command", args, callOptions), "wait_for_command result"),
  kill_terminal: async (args, callOptions) => parseTerminalKill(await invoke("kill_terminal", args, callOptions), "kill_terminal result")
});
var fileFields = (host, machineId, bind) => {
  const composed = (callOptions) => createMachineComposedTools({
    invoke: (capability, args) => host.invoke({ machineId, capability, args, callOptions: bind(callOptions) }),
    requireCapability: (capability) => host.requireCapability(machineId, capability, bind(callOptions))
  });
  return {
    read: (path, options, callOptions) => host.read({ machineId, path, options, callOptions: bind(callOptions) }),
    readHandle: (path, options, callOptions) => host.readHandle({ machineId, path, options, callOptions: bind(callOptions) }),
    readText: (path, options, callOptions) => host.readText({ machineId, path, options, callOptions: bind(callOptions) }),
    readBytes: (path, options, callOptions) => host.read({ machineId, path, options, callOptions: bind(callOptions) }),
    pushTree: (localDir, remotePath, options, callOptions) => host.pushTree({ machineId, localDir, remotePath, options, callOptions: bind(callOptions) }),
    pullTree: (remotePath, localDir, options, callOptions) => host.pullTree({ machineId, remotePath, localDir, options, callOptions: bind(callOptions) }),
    write: (path, content, options, callOptions) => host.write({ machineId, path, content, options, callOptions: bind(callOptions) }),
    glob: (pattern, options, callOptions) => composed(callOptions).glob(pattern, options),
    grep: (path, pattern, options, callOptions) => composed(callOptions).grep(path, pattern, options),
    edit: (path, spec, callOptions) => composed(callOptions).edit(path, spec)
  };
};
var sharedMachineFields = (host, record, boundOptions) => {
  const bind = (callOptions) => mergeCallOptions(boundOptions, callOptions);
  const invoke = (capability, args, callOptions) => host.invoke({ machineId: record.id, capability, args, callOptions: bind(callOptions) });
  return {
    ...machineDirectoryFields(record),
    transport: host.transportKind,
    message: async (topic, body) => parseMessageResult(await invoke("mesh.message", { topic, body })),
    shell: (input, options, callOptions) => host.invoke({
      machineId: record.id,
      capability: "shell",
      args: shellPayload(input, options),
      callOptions: bind(callOptions)
    }),
    spawn: (command, options) => spawnCommand((capability, args, callOptions) => invoke(capability, args, callOptions?.timeoutMs === undefined ? undefined : { terminalTimeoutMs: callOptions.timeoutMs }), command, { options, protocolFeatures: record.protocolFeatures }),
    ...terminalFields(invoke),
    ...fileFields(host, record.id, bind),
    processInfo: async (args = {}, callOptions) => parseProcessInfoResult(await invoke("process.info", args, callOptions)),
    restartAgent: async (args = {}, callOptions) => parseRestartResult(await invoke("agent.restart", args, callOptions)),
    invoke,
    tool: (capability) => host.tool(record.id, capability, boundOptions)
  };
};

// src/machine-proxy.ts
var rebindings = new WeakMap;
var registerRebind = (machine, rebind) => {
  rebindings.set(machine, rebind);
  return machine;
};
var directOnlyMachine = (machine) => {
  const rebind = rebindings.get(machine);
  if (rebind === undefined)
    throw new HubTransportError("bridge_disabled", "cannot bind direct-only routing to a foreign machine proxy");
  return rebind({ bridgesEnabled: false });
};
var withCallSignal = (machine, signal) => rebindings.get(machine)?.({ signal }) ?? machine;
var rebound = (boundOptions, extra) => {
  const options = extra.bridgesEnabled === undefined ? boundOptions : { ...boundOptions, bridgesEnabled: extra.bridgesEnabled };
  return extra.signal === undefined ? options : { ...options, ...mergeCallOptions(options, { signal: extra.signal }) };
};
var taskMachineProxy = (host, binding) => {
  const { record, boundOptions, context } = binding;
  return registerRebind({
    ...sharedMachineFields(host, record, { ...boundOptions, taskContext: context }),
    withToken: (token) => taskMachineProxy(host, {
      ...binding,
      boundOptions: mergeCallOptions(boundOptions, { capabilityToken: token })
    }),
    withTask: (nextTaskId, nextOptions) => newTaskMachineProxy(host, record, {
      taskId: nextTaskId,
      options: nextOptions,
      boundOptions: mergeCallOptions(boundOptions, { taskId: nextTaskId })
    }),
    step: (name, fn) => context.runStep(name, fn),
    taskJournal: () => context.snapshot()
  }, (extra) => taskMachineProxy(host, { ...binding, boundOptions: rebound(boundOptions, extra) }));
};
var newTaskMachineProxy = (host, record, task) => taskMachineProxy(host, {
  record,
  taskId: task.taskId,
  boundOptions: task.boundOptions,
  context: host.createTaskContext(task.taskId, task.options)
});
var machineProxy = (host, record, boundOptions = {}) => registerRebind({
  ...sharedMachineFields(host, record, boundOptions),
  withToken: (token) => machineProxy(host, record, mergeCallOptions(boundOptions, { capabilityToken: token })),
  withTask: (taskId, options) => newTaskMachineProxy(host, record, {
    taskId,
    options,
    boundOptions: mergeCallOptions(boundOptions, { taskId })
  }),
  step: async () => host.taskContextRequired()
}, (extra) => machineProxy(host, record, rebound(boundOptions, extra)));

// src/fanout.ts
class FanoutOptionsError extends Error {
  constructor(message) {
    super(message);
    this.name = "FanoutOptionsError";
  }
}

class FanoutTimeoutError extends Error {
  constructor(message) {
    super(message);
    this.name = "FanoutTimeoutError";
  }
}

class FanoutDuplicateTargetError extends Error {
  machineId;
  constructor(machineId, message) {
    super(message);
    this.name = "FanoutDuplicateTargetError";
    this.machineId = machineId;
  }
}
var UNLIMITED_FANOUT_DEFAULTS = {
  concurrency: Number.POSITIVE_INFINITY,
  cancelOnTimeout: true
};
var parseFanoutOptions = (options) => {
  if (options !== undefined && (typeof options !== "object" || options === null || Array.isArray(options))) {
    throw new FanoutOptionsError("fanout options must be an object");
  }
  const source = options ?? {};
  if (source.allowDisruptive !== undefined && typeof source.allowDisruptive !== "boolean") {
    throw new FanoutOptionsError("fanout allowDisruptive must be a boolean");
  }
  if (source.includeBridged !== undefined && typeof source.includeBridged !== "boolean") {
    throw new FanoutOptionsError("fanout includeBridged must be a boolean");
  }
  if (source.cancelOnTimeout !== undefined && typeof source.cancelOnTimeout !== "boolean") {
    throw new FanoutOptionsError("fanout cancelOnTimeout must be a boolean");
  }
  const concurrency = source.concurrency;
  if (concurrency !== undefined && (typeof concurrency !== "number" || Number.isNaN(concurrency) || concurrency !== Number.POSITIVE_INFINITY && (!Number.isInteger(concurrency) || concurrency <= 0))) {
    throw new FanoutOptionsError(`fanout concurrency must be a positive integer or Infinity (got ${describeFanoutValue(concurrency)})`);
  }
  const dedup = source.dedup ?? "none";
  if (dedup !== "none" && dedup !== "first" && dedup !== "reject") {
    throw new FanoutOptionsError(`fanout dedup must be "none", "first", or "reject" (got ${describeFanoutValue(dedup)})`);
  }
  const timeoutMs = source.timeoutMs;
  if (timeoutMs !== undefined && (typeof timeoutMs !== "number" || Number.isNaN(timeoutMs) || !Number.isFinite(timeoutMs) || timeoutMs <= 0)) {
    throw new FanoutOptionsError(`fanout timeoutMs must be a positive finite number (got ${describeFanoutValue(timeoutMs)})`);
  }
  return { concurrency, dedup, timeoutMs, cancelOnTimeout: source.cancelOnTimeout };
};
var resolveFanoutOptions = (parsed, defaults) => ({
  concurrency: parsed.concurrency ?? defaults.concurrency,
  dedup: parsed.dedup,
  timeoutMs: parsed.timeoutMs,
  cancelOnTimeout: parsed.cancelOnTimeout ?? defaults.cancelOnTimeout
});
var requireNonDisruptive = (capability) => {
  const disruption = OP_REGISTRY.find(({ op }) => op === capability)?.disruption;
  if (disruption === "agent" || disruption === "host") {
    throw new FanoutOptionsError(`fanout of ${capability} requires allowDisruptive: true`);
  }
};
var guardFanoutMachine = (machine) => new Proxy(machine, {
  get(target, key, receiver) {
    if (key === "invoke")
      return (op, ...args) => {
        requireNonDisruptive(op);
        return target.invoke(op, ...args);
      };
    if (key === "tool")
      return (op) => {
        requireNonDisruptive(op);
        return target.tool(op);
      };
    if (key === "restartAgent")
      return (...args) => {
        requireNonDisruptive("agent.restart");
        return target.restartAgent(...args);
      };
    if (key === "withToken")
      return (...args) => guardFanoutMachine(target.withToken(...args));
    if (key === "withTask")
      return (...args) => guardFanoutMachine(target.withTask(...args));
    return Reflect.get(target, key, receiver);
  }
});
var describeFanoutValue = (value) => typeof value === "string" ? JSON.stringify(value) : String(value);
var runFanoutTarget = async (machine, fn, run) => {
  const { index, timeoutMs } = run;
  const controller = new AbortController;
  let classified = false;
  let release = () => {};
  const decided = new Promise((resolve) => {
    release = resolve;
  });
  const classify = (outcome) => {
    if (classified)
      return;
    classified = true;
    run.onSettled(outcome);
    release();
  };
  controller.signal.addEventListener("abort", () => {
    classify({
      kind: "rejected",
      machine,
      index,
      error: new FanoutTimeoutError(`fanout target ${machine.alias} (${machine.id}) exceeded timeoutMs ${timeoutMs}`)
    });
  });
  const timer = timeoutMs === undefined ? undefined : setTimeout(() => controller.abort(), timeoutMs);
  const target = run.cancelOnTimeout ? withCallSignal(machine, controller.signal) : machine;
  let started;
  try {
    started = Promise.resolve(fn(target, { signal: controller.signal }));
  } catch (thrown) {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    classify({ kind: "rejected", machine, index, error: normalizeFanoutError(thrown) });
    return;
  }
  started.then((value) => classify({ kind: "fulfilled", machine, index, value }), (thrown) => classify({ kind: "rejected", machine, index, error: normalizeFanoutError(thrown) }));
  await decided;
  if (timer !== undefined) {
    clearTimeout(timer);
  }
  if (run.cancelOnTimeout)
    return;
  await started.then(() => {}, () => {});
};
var normalizeFanoutError = (thrown) => thrown instanceof Error ? thrown : new Error(String(thrown));
var planFanout = (machines, policy) => {
  const outcomes = new Array(machines.length);
  const runnable = [];
  const seenIds = new Set;
  for (const [index, machine] of machines.entries()) {
    if (policy.bridgesEnabled === false && !machine.routes.some((route) => route.kind === "direct" && route.online)) {
      outcomes[index] = {
        kind: "skipped",
        machine,
        index,
        reason: machine.kind === "bridged" || machine.state === "online" ? "bridge_disabled" : "machine_offline"
      };
      continue;
    }
    if (machine.state === "offline") {
      outcomes[index] = { kind: "skipped", machine, index, reason: "machine_offline" };
      continue;
    }
    if (machine.unsupported === true) {
      outcomes[index] = { kind: "skipped", machine, index, reason: "machine_unsupported" };
      continue;
    }
    const duplicate = seenIds.has(machine.id);
    seenIds.add(machine.id);
    if (policy.dedup === "none" || !duplicate) {
      runnable.push({ machine, index });
      continue;
    }
    if (policy.dedup === "first") {
      outcomes[index] = { kind: "skipped", machine, index };
      continue;
    }
    throw new FanoutDuplicateTargetError(machine.id, `fanout target list contains machine ${machine.id} (${machine.alias}) more than once`);
  }
  return { outcomes, runnable };
};
var runFanoutPool = async (plan, concurrency, run) => {
  if (concurrency === Number.POSITIVE_INFINITY) {
    await Promise.all(plan.runnable.map((target) => run(target)));
    return;
  }
  let cursor = 0;
  const worker = async () => {
    for (;; ) {
      const slot = cursor;
      cursor += 1;
      const entry = plan.runnable[slot];
      if (entry === undefined) {
        return;
      }
      await run(entry);
    }
  };
  const workerCount = Math.min(concurrency, plan.runnable.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
};
var foldFanoutOutcomes = (outcomes, dedup) => {
  const fulfilled = [];
  const rejected = [];
  const skipped = [];
  for (const outcome of outcomes) {
    if (outcome?.kind === "fulfilled") {
      fulfilled.push({ machine: outcome.machine, value: outcome.value });
    } else if (outcome?.kind === "rejected") {
      rejected.push({ machine: outcome.machine, error: outcome.error });
    } else if (outcome?.kind === "skipped") {
      skipped.push({
        machine: outcome.machine,
        ...outcome.reason === undefined ? {} : { reason: outcome.reason }
      });
    }
  }
  return dedup === "first" || skipped.length > 0 ? { fulfilled, rejected, skipped } : { fulfilled, rejected };
};
var executeFanout = async (sink, machines, fn, options) => {
  const plan = planFanout(machines, { bridgesEnabled: options.bridgesEnabled, dedup: options.dedup });
  sink.planned(machines.length);
  for (const outcome of plan.outcomes) {
    if (outcome !== undefined)
      sink.emit(outcome);
  }
  await runFanoutPool(plan, options.concurrency, (target) => runFanoutTarget(target.machine, fn, {
    index: target.index,
    timeoutMs: options.timeoutMs,
    cancelOnTimeout: options.cancelOnTimeout,
    onSettled: (outcome) => {
      plan.outcomes[target.index] = outcome;
      sink.emit(outcome);
    }
  }));
  return foldFanoutOutcomes(plan.outcomes, options.dedup);
};
var fanout = (machines, fn, options) => new FanoutRun(async (sink) => {
  const parsed = parseFanoutOptions(options);
  if (options?.tag !== undefined) {
    throw new FanoutOptionsError(`fanout received an explicit target list and a tag ("${options.tag}"); pass targets or a tag, not both`);
  }
  return executeFanout(sink, machines, (machine, context) => fn(options?.allowDisruptive === true ? machine : guardFanoutMachine(machine), context), { ...resolveFanoutOptions(parsed, UNLIMITED_FANOUT_DEFAULTS), bridgesEnabled: undefined });
});

// src/facade.ts
var DEFAULT_DIRECTORY_TTL_MS = 30000;

class BunshinFacade {
  hub;
  session;
  operatorConfig;
  directoryTtlMs;
  fanoutDefaults;
  snapshotLoadedAtMs = Date.now();
  constructor(hub, session, operatorConfig, options) {
    this.hub = hub;
    this.session = session;
    this.operatorConfig = operatorConfig ?? { aliases: {} };
    this.directoryTtlMs = options?.directoryTtlMs ?? DEFAULT_DIRECTORY_TTL_MS;
    this.fanoutDefaults = { ...UNLIMITED_FANOUT_DEFAULTS, ...options?.fanoutDefaults };
  }
  async refreshSessionIfNeeded() {
    const session = this.session;
    if (session !== undefined && session.expiresAtMs() - Date.now() <= session.refreshBeforeExpiryMs) {
      await session.refreshSession();
    }
  }
  async refreshDirectory() {
    await this.refreshSessionIfNeeded();
    await this.hub.refresh();
    this.snapshotLoadedAtMs = Date.now();
  }
  async listMachines() {
    await this.refreshDirectory();
    return this.hub.listMachines().map((machine) => this.selectedMachine(machine));
  }
  fanout(targets, fn, options) {
    return new FanoutRun(async (sink) => {
      parseFanoutOptions(options);
      const mergedOptions = { ...this.operatorConfig.fanoutDefaults, ...options };
      const parsed = parseFanoutOptions(mergedOptions);
      if (Array.isArray(targets) && mergedOptions.tag !== undefined) {
        throw new FanoutOptionsError(`fanout received an explicit target list and a tag ("${mergedOptions.tag}"); pass targets or a tag, not both`);
      }
      const selection = mergedOptions.tag === undefined ? targets : { tag: mergedOptions.tag };
      const includeBridged = mergedOptions.includeBridged ?? this.operatorConfig.bridges?.fanout ?? false;
      const machines = await this.resolveFanoutTargets(selection, includeBridged);
      return executeFanout(sink, machines, (machine, context) => fn(mergedOptions.allowDisruptive === true ? machine : guardFanoutMachine(machine), context), {
        ...resolveFanoutOptions(parsed, this.fanoutDefaults),
        bridgesEnabled: this.operatorConfig.bridges?.enabled
      });
    });
  }
  async getMachine(idOrAlias) {
    const lookup = this.operatorConfig.aliases[idOrAlias] ?? idOrAlias;
    if (Date.now() - this.snapshotLoadedAtMs >= this.directoryTtlMs) {
      await this.refreshDirectory();
    }
    try {
      return this.selectedMachine(this.hub.getMachine(lookup));
    } catch (error) {
      if (!(error instanceof MachineNotFoundError)) {
        throw error;
      }
    }
    await this.refreshDirectory();
    return this.selectedMachine(this.hub.getMachine(lookup));
  }
  async findMachine(query) {
    await this.refreshDirectory();
    const matches = this.hub.findMachine(query);
    if (matches.length > 1) {
      throw new AmbiguousMachineLookupError(describeQuery(query), matches.map((machine) => machine.id));
    }
    const only = matches[0];
    if (only === undefined) {
      throw new MachineNotFoundError(describeQuery(query));
    }
    return this.selectedMachine(only);
  }
  async listTools(idOrAlias) {
    const machine = await this.getMachine(idOrAlias);
    return this.hub.listTools(machine.id);
  }
  resultOf(requestId) {
    return this.hub.resultOf(requestId);
  }
  async setPolicy(machineId, policy) {
    await this.refreshSessionIfNeeded();
    return this.hub.setPolicy(machineId, policy);
  }
  async getPolicy(machineId) {
    await this.refreshSessionIfNeeded();
    return this.hub.getPolicy(machineId);
  }
  events(options) {
    return this.hub.events(options);
  }
  close() {
    return this.hub.close();
  }
  selectedMachine(machine) {
    return this.operatorConfig.bridges?.enabled === false ? directOnlyMachine(machine) : machine;
  }
  async resolveFanoutTargets(targets, includeBridged) {
    if (targets === "all" || isFanoutTagSelector(targets)) {
      return (await this.listMachines()).filter((machine) => (includeBridged || machine.kind === "enrolled") && (targets === "all" || machine.tags.includes(targets.tag)));
    }
    return Promise.all(targets.map((target) => typeof target === "string" ? this.getMachine(target) : this.selectedMachine(target)));
  }
}
var isFanoutTagSelector = (targets) => !Array.isArray(targets);
var describeQuery = (query) => {
  const parts = [
    query.tag === undefined ? undefined : `tag:${query.tag}`,
    query.os === undefined ? undefined : `os:${query.os}`,
    query.arch === undefined ? undefined : `arch:${query.arch}`
  ].filter((part) => part !== undefined);
  return parts.length === 0 ? "{}" : `{${parts.join(", ")}}`;
};

// ../protocol/src/op-id.ts
import { createHash } from "node:crypto";
var normalizeOperationArgs = (args) => {
  if (args === undefined) {
    return;
  }
  const encoded = JSON.stringify(args);
  return encoded === undefined ? undefined : JSON.parse(encoded);
};
var computeWireOpId = (machineId, taskId, opSeq, op, args) => computeOpId(taskId, opSeq, op, { machineId, args: normalizeOperationArgs(args) });
var computeOpId = (taskId, opSeq, op, args) => {
  const normalizedArgs = normalizeOperationArgs(args);
  return createHash("sha256").update(canonicalizeJson([
    taskId,
    opSeq,
    op,
    normalizedArgs === undefined ? { kind: "absent" } : { kind: "present", value: normalizedArgs }
  ])).digest("hex");
};

// src/read-handle.ts
import { createHash as createHash2 } from "node:crypto";

class ArtifactFetchError extends Error {
  constructor(url, status) {
    super(`artifact fetch failed: ${url} responded ${status}`);
    this.name = "ArtifactFetchError";
  }
}

class ArtifactDigestMismatchError extends Error {
  constructor(expected, actual) {
    super(`artifact digest mismatch: expected ${expected} but streamed ${actual}`);
    this.name = "ArtifactDigestMismatchError";
  }
}

class ArtifactSizeMismatchError extends Error {
  constructor(expected, actual, options) {
    super(`artifact size mismatch: expected ${expected} bytes but streamed ${actual}`, options);
    this.name = "ArtifactSizeMismatchError";
  }
}
var SHA256_HEX = /^[0-9a-f]{64}$/;
var DOWNLOAD_MAX_BYTES = 64 * 1024 * 1024;
var parseArtifactRef = (value) => {
  if (!isRecord(value)) {
    return;
  }
  const kind = Reflect.get(value, "kind");
  const sha256 = Reflect.get(value, "sha256");
  const size = Reflect.get(value, "size");
  const url = Reflect.get(value, "url");
  if (kind !== "artifact" || typeof sha256 !== "string" || !SHA256_HEX.test(sha256)) {
    return;
  }
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0) {
    return;
  }
  if (typeof url !== "string" || parseArtifactDownloadUrl(url) === undefined) {
    return;
  }
  return { kind: "artifact", sha256, size, url };
};
var isReadHandle = (value) => isRecord(value) && typeof Reflect.get(value, "sha256") === "string" && typeof Reflect.get(value, "size") === "number" && typeof Reflect.get(value, "fetch") === "function";
var createReadHandle = (ref, fetchFn = fetch, signal) => ({
  sha256: ref.sha256,
  size: ref.size,
  artifact: ref,
  fetch: () => digestVerifyingStream({
    url: ref.url,
    sha256: ref.sha256,
    fetchFn,
    signal,
    expectedSize: ref.size,
    maximumSize: DOWNLOAD_MAX_BYTES
  })
});
var drainReadHandle = async (handle) => {
  const chunks = [];
  let size = 0;
  const reader = handle.fetch().getReader();
  for (;; ) {
    const { done, value } = await reader.read();
    if (done)
      break;
    size += value.byteLength;
    if (size > handle.size) {
      try {
        await reader.cancel();
      } catch (error) {
        throw new ArtifactSizeMismatchError(handle.size, size, { cause: error });
      }
      throw new ArtifactSizeMismatchError(handle.size, size);
    }
    chunks.push(value);
  }
  if (size !== handle.size)
    throw new ArtifactSizeMismatchError(handle.size, size);
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
};
var digestVerifyingStream = (download) => {
  const { url, sha256, fetchFn, signal, expectedSize, maximumSize } = download;
  let reader;
  const hash = createHash2("sha256");
  const fetchController = new AbortController;
  let cancelled = false;
  let cancelReason;
  let size = 0;
  return new ReadableStream({
    async start(controller) {
      try {
        if (parseArtifactDownloadUrl(url) === undefined) {
          controller.error(new ArtifactFetchError(url, 0));
          return;
        }
        const requestSignal = signal === undefined ? fetchController.signal : AbortSignal.any([signal, fetchController.signal]);
        const response = await fetchFn(url, { redirect: "manual", signal: requestSignal });
        if (cancelled) {
          await response.body?.cancel(cancelReason);
          return;
        }
        if (!response.ok || response.body === null) {
          await response.body?.cancel();
          controller.error(new ArtifactFetchError(url, response.status));
          return;
        }
        reader = response.body.getReader();
      } catch (error) {
        if (cancelled)
          return;
        controller.error(error instanceof Error ? error : new TypeError(String(error)));
      }
    },
    async pull(controller) {
      try {
        const source = reader;
        if (source === undefined)
          return;
        const { done, value } = await source.read();
        if (!done) {
          size += value.byteLength;
          if (expectedSize !== undefined && size > expectedSize || maximumSize !== undefined && size > maximumSize) {
            await source.cancel();
            controller.error(new ArtifactSizeMismatchError(expectedSize ?? maximumSize ?? 0, size));
            return;
          }
          hash.update(value);
          controller.enqueue(value);
          return;
        }
        if (expectedSize !== undefined && size !== expectedSize) {
          controller.error(new ArtifactSizeMismatchError(expectedSize, size));
          return;
        }
        const actual = hash.digest("hex");
        if (actual !== sha256) {
          controller.error(new ArtifactDigestMismatchError(sha256, actual));
          return;
        }
        controller.close();
      } catch (error) {
        controller.error(error instanceof Error ? error : new TypeError(String(error)));
      }
    },
    async cancel(reason) {
      cancelled = true;
      cancelReason = reason;
      fetchController.abort(reason);
      await reader?.cancel(reason);
    }
  });
};
var isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var streamHandleToText = async (handle) => {
  const reader = handle.fetch().getReader();
  const decoder = new TextDecoder;
  let text = "";
  for (;; ) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
};
var parseArtifactDownloadUrl = (value) => {
  let url;
  try {
    url = new URL(value);
  } catch {
    return;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:" || url.username !== "" || url.password !== "") {
    return;
  }
  return url.hash === "" ? url : undefined;
};

// src/artifact-write.ts
var fsWritePayload = async (machine, path, content, options) => {
  if (isReadHandle(content) && machine.protocolFeatures?.includes("artifact-write")) {
    const artifact = parseArtifactRef(content.artifact);
    if (artifact !== undefined) {
      return { path, artifact, create_parent_dirs: options?.createParentDirs ?? false };
    }
  }
  const resolved = isReadHandle(content) ? await drainReadHandle(content) : content;
  const bytes = typeof resolved === "string" ? Buffer.from(resolved, "utf8") : resolved;
  return {
    path,
    bytes: Buffer.from(bytes).toString("base64"),
    create_parent_dirs: options?.createParentDirs ?? false
  };
};

// src/capability-routing.ts
var routePreferenceOf = (capability, options) => {
  const route = options?.route;
  if (options?.bridgesEnabled === false) {
    if (capability === "bridge.invoke" || route === "bridge" || typeof route === "object") {
      throw new HubTransportError("bridge_disabled", "requester bridges are disabled");
    }
    return "direct";
  }
  return typeof route === "object" ? { ...route } : route;
};
var hasCapability = (machine, capability, preference = "auto") => {
  const routes = machine.routes;
  const direct = routes.find((route) => route.kind === "direct");
  if (preference === "direct")
    return direct?.capabilities.includes(capability) ?? false;
  if (preference === "auto" && direct?.online && direct.capabilities.includes(capability))
    return true;
  const ssh = routes.find((route) => route.kind === "ssh" && route.online && route.enabled && !route.identityConflict && route.capabilities.includes(capability) && (typeof preference !== "object" || route.via === preference.via && (preference.target === undefined || route.target === preference.target)));
  if (ssh !== undefined)
    return true;
  return preference === "auto" && (direct?.capabilities.includes(capability) ?? false);
};
var requireCapabilityOf = (machine, capability, preference, explainRouteRefusal) => {
  if (hasCapability(machine, capability, preference))
    return;
  if (typeof preference === "object") {
    const refusal = explainRouteRefusal?.(machine, capability, preference);
    if (refusal !== undefined) {
      throw new HubTransportError(refusal, `explicit route refused: ${refusal}`);
    }
  }
  throw new CapabilityUnavailableError(machine.id, capability);
};

// src/durable-result.ts
var DURABLE_RESULT_MAX_BYTES = 64 * 1024 * 1024;

class DurableResultArtifactResolverMissingError extends Error {
  name = "DurableResultArtifactResolverMissingError";
  constructor() {
    super("durable result artifact resolution requires an authenticated configured-hub resolver");
  }
}

class DurableResultEnvelopeError extends Error {
  reason;
  constructor(reason, options) {
    super(`invalid durable result envelope: ${reason}`, options);
    this.name = "DurableResultEnvelopeError";
    this.reason = reason;
  }
}
var resolveDurableResultEnvelope = async (value, options) => {
  if (!isDurableResultEnvelope(value, options.acceptLegacyBodyArtifact === true))
    return value;
  const ref = parseArtifactRef(Reflect.get(value, "bodyArtifact"));
  if (ref === undefined) {
    throw new DurableResultEnvelopeError("bodyArtifact must be a valid artifact reference");
  }
  if (ref.size > DURABLE_RESULT_MAX_BYTES) {
    throw new DurableResultEnvelopeError(`bodyArtifact exceeds the ${DURABLE_RESULT_MAX_BYTES}-byte requester limit`);
  }
  if (options.resolveArtifact === undefined)
    throw new DurableResultArtifactResolverMissingError;
  const resolved = await options.resolveArtifact(ref);
  let body;
  try {
    body = await drainReadHandle(createReadHandle(resolved.ref, options.fetchFn, resolved.signal));
  } catch (error) {
    if (error instanceof ArtifactDigestMismatchError || error instanceof ArtifactSizeMismatchError || error instanceof ArtifactFetchError) {
      throw error;
    }
    if (resolved.signal.aborted) {
      throw new DurableResultEnvelopeError("artifact download timed out", { cause: error });
    }
    throw error;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } catch (error) {
    if (error instanceof TypeError || error instanceof SyntaxError) {
      throw new DurableResultEnvelopeError("bodyArtifact must contain valid JSON", { cause: error });
    }
    throw error;
  }
};
var isDurableResultEnvelope = (value, acceptLegacy) => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const keys = Object.keys(value);
  const bodyArtifact = Reflect.get(value, "bodyArtifact");
  if (keys.length === 1 && Object.hasOwn(value, "bodyArtifact") && typeof bodyArtifact === "object" && bodyArtifact !== null && !Array.isArray(bodyArtifact) && Object.hasOwn(bodyArtifact, "envelope") && Reflect.get(bodyArtifact, "envelope") === DURABLE_RESULT_ENVELOPE_FEATURE) {
    return true;
  }
  if (keys.length === 2 && Object.hasOwn(value, "kind") && Reflect.get(value, "kind") === DURABLE_RESULT_ENVELOPE_FEATURE && Object.hasOwn(value, "bodyArtifact")) {
    return true;
  }
  return acceptLegacy && keys.length === 1 && Object.hasOwn(value, "bodyArtifact");
};

// src/fleet-events.ts
class FleetEventsError extends Error {
  constructor(message) {
    super(message);
    this.name = "FleetEventsError";
  }
}

// src/machine-lookup.ts
var resolveMachineRecord = (machines, idOrAlias) => {
  const byId = machines.find((machine) => machine.id === idOrAlias);
  if (byId !== undefined)
    return byId;
  const named = machines.filter((machine) => machine.alias === idOrAlias);
  const enrolled = named.filter((machine) => machine.kind !== "bridged");
  const candidates = enrolled.length > 0 ? enrolled : named;
  const [match, ...rest] = candidates;
  if (match === undefined)
    throw new MachineNotFoundError(idOrAlias);
  if (rest.length > 0) {
    throw new AmbiguousMachineLookupError(idOrAlias, candidates.map((machine) => machine.id));
  }
  return match;
};

// src/read-ops.ts
import { Buffer as Buffer3 } from "node:buffer";
import { createHash as createHash3 } from "node:crypto";
var MAX_READ_LIMIT_BYTES = 10 * 1024 * 1024;

class ReadLimitError extends Error {
  limitBytes;
  maxLimitBytes;
  constructor(limitBytes, maxLimitBytes) {
    super(`read limitBytes ${limitBytes} exceeds the ${maxLimitBytes}-byte ceiling; read in chunks instead`);
    this.name = "ReadLimitError";
    this.limitBytes = limitBytes;
    this.maxLimitBytes = maxLimitBytes;
  }
}
var assertReadLimit = (options) => {
  const limitBytes = options?.limitBytes;
  if (limitBytes === undefined)
    return;
  if (!Number.isSafeInteger(limitBytes) || limitBytes < 1 || limitBytes > MAX_READ_LIMIT_BYTES) {
    throw new ReadLimitError(limitBytes, MAX_READ_LIMIT_BYTES);
  }
};
var readPayload2 = (path, options) => options?.limitBytes === undefined ? { path } : { path, limit_bytes: options.limitBytes };
var offloadedHandle = async (deps, raw) => {
  if (isReadHandle(raw))
    return raw;
  const ref = parseArtifactRef(raw);
  if (ref === undefined)
    return;
  const resolved = await deps.resolveArtifact(ref);
  return createReadHandle(resolved.ref, deps.fetchFn(), resolved.signal);
};
var inlineBytes = (deps, call, raw) => createMachineComposedTools({
  invoke: () => Promise.resolve(raw),
  requireCapability: (capability) => deps.requireCapability(call.machineId, capability)
}).readBytes(call.path, call.options);
var inlineHandle = (bytes) => ({
  sha256: createHash3("sha256").update(bytes).digest("hex"),
  size: bytes.byteLength,
  fetch: () => new ReadableStream({
    start: (controller) => {
      controller.enqueue(bytes);
      controller.close();
    }
  })
});
var READ_FINISHERS = {
  bytes: (handle, inline) => handle === undefined ? inline() : drainReadHandle(handle),
  handle: async (handle, inline) => handle ?? inlineHandle(await inline()),
  text: async (handle, inline) => handle === undefined ? Buffer3.from(await inline()).toString("utf8") : streamHandleToText(handle)
};
var readMachine = async (deps, kind, call) => {
  assertReadLimit(call.options);
  const raw = await deps.invoke({
    machineId: call.machineId,
    capability: "fs.read",
    args: readPayload2(call.path, call.options),
    callOptions: call.callOptions
  });
  const handle = await offloadedHandle(deps, raw);
  const finish = READ_FINISHERS[kind];
  return finish(handle, () => inlineBytes(deps, call, raw));
};

// src/task-context.ts
var seedFromTaskId = (taskId) => {
  let hash = 2166136261;
  for (let index = 0;index < taskId.length; index += 1) {
    hash ^= taskId.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};
var createPinnedClock = (taskId) => {
  let state = seedFromTaskId(taskId);
  const nextUnit = () => {
    state = state + 1831565813 >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ mixed >>> 15, mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ mixed >>> 7, mixed | 61);
    return ((mixed ^ mixed >>> 14) >>> 0) / 4294967296;
  };
  return {
    now: () => Math.floor(nextUnit() * 1e9),
    random: () => nextUnit()
  };
};

class TaskContext {
  taskId;
  clock;
  priorBySeq;
  seqByName = new Map;
  nextSeq = 0;
  nextWireSeq = 0;
  journal = [];
  constructor(taskId, options) {
    this.taskId = taskId;
    this.clock = options?.clock ?? createPinnedClock(taskId);
    this.priorBySeq = new Map;
    if (options?.journal !== undefined) {
      for (const entry of options.journal.values()) {
        this.priorBySeq.set(entry.opSeq, entry.opId);
      }
    }
  }
  async runStep(name, fn) {
    const opSeq = this.opSeqFor(name);
    const draws = [];
    const context = {
      taskId: this.taskId,
      stepName: name,
      opSeq,
      now: () => {
        const value = this.clock.now();
        draws.push({ kind: "now", value });
        return value;
      },
      random: () => {
        const value = this.clock.random();
        draws.push({ kind: "random", value });
        return value;
      }
    };
    const result = await fn(context);
    const opId = computeOpId(this.taskId, opSeq, "step", { name, draws });
    this.assertJournalConsistent(name, opSeq, opId);
    this.journal.push({ opId, opSeq });
    return result;
  }
  snapshot() {
    return this.journal.map((entry) => ({ opId: entry.opId, opSeq: entry.opSeq }));
  }
  nextWireOpSeq() {
    const seq = this.nextWireSeq;
    this.nextWireSeq += 1;
    return seq;
  }
  opSeqFor(name) {
    const existing = this.seqByName.get(name);
    if (existing !== undefined) {
      return existing;
    }
    const seq = this.nextSeq;
    this.nextSeq += 1;
    this.seqByName.set(name, seq);
    return seq;
  }
  assertJournalConsistent(name, opSeq, opId) {
    const recorded = this.priorBySeq.get(opSeq);
    if (recorded !== undefined && recorded !== opId) {
      throw new LedgerMismatchError({
        taskId: this.taskId,
        stepName: name,
        opSeq,
        expectedOpId: recorded,
        actualOpId: opId
      });
    }
  }
}

// src/tree-ops.ts
import { createHash as createHash5 } from "node:crypto";

// src/tree-archive.ts
import { createHash as createHash4 } from "node:crypto";
import { lstatSync as lstatSync2, readdirSync as readdirSync2, readFileSync, readlinkSync } from "node:fs";
import { join as join2, resolve as resolve2 } from "node:path";
import { gzipSync } from "node:zlib";

// src/tree-archive-format.ts
import { isAbsolute } from "node:path";
var BLOCK = 512;

class TreeArchiveError extends Error {
  code;
  constructor(code, message, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "TreeArchiveError";
    this.code = code;
  }
}
var USTAR_FIELDS = {
  name: [0, 100],
  mode: [100, 8],
  uid: [108, 8],
  gid: [116, 8],
  size: [124, 12],
  mtime: [136, 12],
  checksum: [148, 8],
  typeflag: [156, 1],
  linkname: [157, 100],
  magic: [257, 6],
  version: [263, 2],
  uname: [265, 32],
  gname: [297, 32],
  devmajor: [329, 8],
  devminor: [337, 8]
};
var octal = (value, length) => `${value.toString(8).padStart(length - 1, "0")}\x00`.slice(-length);
var writeField = (target, field, value) => {
  const [offset, length] = USTAR_FIELDS[field];
  target.write(value, offset, Math.min(length, Buffer.byteLength(value)), "utf8");
};
var fieldBytes = (block, field) => {
  const [offset, length] = USTAR_FIELDS[field];
  return block.subarray(offset, offset + length);
};
var header = (fields) => {
  const h = Buffer.alloc(BLOCK);
  writeField(h, "name", fields.name);
  writeField(h, "mode", octal(fields.mode & 4095, 8));
  writeField(h, "uid", octal(0, 8));
  writeField(h, "gid", octal(0, 8));
  writeField(h, "size", octal(fields.size, 12));
  writeField(h, "mtime", octal(0, 12));
  h.fill(32, 148, 156);
  writeField(h, "typeflag", fields.type);
  writeField(h, "linkname", fields.link ?? "");
  writeField(h, "magic", "ustar\x00");
  writeField(h, "version", "00");
  writeField(h, "uname", "root");
  writeField(h, "gname", "root");
  writeField(h, "devmajor", "");
  writeField(h, "devminor", "");
  let sum = 0;
  for (const byte of h)
    sum += byte;
  writeField(h, "checksum", octal(sum, 8));
  return h;
};
var padded = (bytes) => Buffer.concat([bytes, Buffer.alloc((BLOCK - bytes.length % BLOCK) % BLOCK)]);
var paxRecord = (key, value) => {
  const raw = `${key}=${value}
`;
  let length = Buffer.byteLength(raw) + String(Buffer.byteLength(raw)).length + 1;
  while (length !== Buffer.byteLength(`${length} ${raw}`))
    length = Buffer.byteLength(`${length} ${raw}`);
  return Buffer.from(`${length} ${raw}`);
};
var readString = (value) => value.toString("utf8").replace(/\0.*$/, "");
var parseOctal = (value) => Number.parseInt(readString(value).trim() || "0", 8);
var linkTargetStaysInside = (entryName, link) => {
  if (isAbsolute(link) || /^[\\/]/.test(link) || /^[A-Za-z]:[\\/]/.test(link))
    return false;
  let depth = entryName.split(/[\\/]/).filter(Boolean).length - 1;
  for (const part of link.split(/[\\/]/)) {
    if (part === "" || part === ".")
      continue;
    if (part === "..") {
      depth -= 1;
      if (depth < 0)
        return false;
    } else
      depth += 1;
  }
  return true;
};

// src/tree-archive-extract.ts
import { chmodSync, lstatSync, mkdirSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { isAbsolute as isAbsolute2, join, resolve, sep } from "node:path";
import { gunzipSync } from "node:zlib";
var extractTree = async (archive, destDir, options = {}) => {
  const dest = resolve(destDir);
  prepareDestination(destDir, options);
  let bytes;
  try {
    bytes = gunzipSync(archive);
  } catch (error) {
    throw new TreeArchiveError("malformed_input", "malformed_input: invalid gzip", error);
  }
  let offset = 0;
  const longNames = { path: undefined, link: undefined };
  let fileCount = 0;
  let writtenBytes = 0;
  while (offset + BLOCK <= bytes.length) {
    const h = bytes.subarray(offset, offset + BLOCK);
    offset += BLOCK;
    if (h.every((v) => v === 0))
      break;
    const size = parseOctal(fieldBytes(h, "size"));
    const type = String.fromCharCode(h[156] || 0);
    const body = bytes.subarray(offset, offset + size);
    offset += Math.ceil(size / BLOCK) * BLOCK;
    const name = longNames.path ?? readString(fieldBytes(h, "name"));
    const link = longNames.link ?? readString(fieldBytes(h, "linkname"));
    if (absorbLongNames(type, body, longNames))
      continue;
    longNames.path = undefined;
    longNames.link = undefined;
    const written = applyMember(dest, { name, type, link, block: h, body });
    if (written !== undefined) {
      fileCount++;
      writtenBytes += written;
    }
  }
  return { fileCount, writtenBytes };
};
var absorbLongNames = (type, body, longNames) => {
  if (type === "x") {
    const text = body.toString();
    const pathMatch = /(?:^|\n)\d+ path=([^\n]+)\n/.exec(text);
    const linkMatch = /(?:^|\n)\d+ linkpath=([^\n]+)\n/.exec(text);
    if (!pathMatch && !linkMatch)
      throw new TreeArchiveError("malformed_input", "malformed_input: invalid pax header");
    if (pathMatch)
      longNames.path = pathMatch[1];
    if (linkMatch)
      longNames.link = linkMatch[1];
    return true;
  }
  if (type === "L") {
    longNames.path = readString(body);
    return true;
  }
  if (type === "K") {
    longNames.link = readString(body);
    return true;
  }
  return false;
};
var prepareDestination = (destDir, options) => {
  const dest = resolve(destDir);
  if (options.clean && (!isAbsolute2(destDir) || dest.split(sep).filter(Boolean).length < 2))
    throw new TreeArchiveError("invalid_path", "invalid_path: clean destination is too shallow");
  if (options.clean) {
    mkdirSync(dest, { recursive: true });
    for (const child of readdirSync(dest))
      rmSync(join(dest, child), { recursive: true, force: true });
  } else
    mkdirSync(dest, { recursive: true });
};
var applyMember = (dest, member) => {
  const { name, type, block, body } = member;
  validateEntryPath(name);
  const target = materializeParent(dest, name);
  if (target !== dest && !target.startsWith(`${dest}${sep}`))
    throw new TreeArchiveError("path_escape", `path_escape: ${name}`);
  if (type === "5") {
    unlinkSymlink(target);
    mkdirSync(target, { recursive: true });
    return;
  }
  if (type === "2") {
    validateLinkTarget(name, member.link);
    unlinkNonDirectory(target);
    symlinkSync(member.link, target);
    return;
  }
  if (type === "0" || type === "\x00") {
    unlinkSymlink(target);
    writeFileSync(target, body, { mode: block[100] ? parseOctal(fieldBytes(block, "mode")) : 420 });
    chmodSync(target, parseOctal(fieldBytes(block, "mode")) & 4095);
    return body.length;
  }
  throw new TreeArchiveError("malformed_input", `malformed_input: unsupported tar type ${type}`);
};
var materializeParent = (dest, name) => {
  const escapeError = () => new TreeArchiveError("path_escape", `path_escape: ${name}`);
  const parts = name.replace(/\/$/, "").split("/").filter(Boolean);
  const last = parts.at(-1);
  if (last === undefined)
    throw escapeError();
  let current = dest;
  for (const part of parts.slice(0, -1)) {
    current = join(current, part);
    const stat = lstatSafe(current);
    if (stat?.isSymbolicLink() === true)
      throw escapeError();
    if (stat === undefined)
      mkdirSync(current);
  }
  return join(current, last);
};
var lstatSafe = (path) => {
  try {
    return lstatSync(path);
  } catch {
    return;
  }
};
var unlinkSymlink = (path) => {
  if (lstatSafe(path)?.isSymbolicLink() === true)
    unlinkSync(path);
};
var unlinkNonDirectory = (path) => {
  const stat = lstatSafe(path);
  if (stat !== undefined && !stat.isDirectory())
    unlinkSync(path);
};
var validateEntryPath = (name) => {
  if (isAbsolute2(name) || name.split(/[\\/]/).includes(".."))
    throw new TreeArchiveError("path_escape", `path_escape: ${name}`);
};
var validateLinkTarget = (entryName, link) => {
  if (!linkTargetStaysInside(entryName, link))
    throw new TreeArchiveError("path_escape", `path_escape: ${entryName} -> ${link}`);
};

// src/tree-archive.ts
var DEFAULT_TREE_EXCLUDES = new Set([".git", "node_modules", "target", ".DS_Store"]);
var TYPE_CODES = { file: "0", dir: "5", symlink: "2" };
var packTree = async (rootDir, options = {}) => {
  const { entries, totalBytes } = collectEntries(resolve2(rootDir), options);
  const bytes = gzipSync(Buffer.concat([...entries.flatMap(entryBlocks), Buffer.alloc(BLOCK * 2)]), { level: 9 });
  if (options.maxBytes !== undefined && bytes.length > options.maxBytes)
    throw new TreeArchiveError("archive_too_large", `archive_too_large: ${bytes.length}`);
  const counts = { file: 0, dir: 0, symlink: 0 };
  for (const entry of entries)
    counts[entry.kind] += 1;
  return {
    bytes,
    fileCount: counts.file,
    dirCount: counts.dir,
    symlinkCount: counts.symlink,
    totalBytes,
    archiveBytes: bytes.length
  };
};
var collectEntries = (root, options) => {
  const entries = [];
  let totalBytes = 0;
  const ignored = (path) => path.split("/").some((part) => DEFAULT_TREE_EXCLUDES.has(part)) || (options.ignore ?? []).some((pattern) => globMatch(pattern, path));
  const included = (path) => (options.include ?? []).length === 0 || (options.include ?? []).some((pattern) => globMatch(pattern, path) || globMatch(pattern, `${path}/`));
  const visit = (absolute, name) => {
    if (name && (ignored(name) || !included(name) && ![...readdirSafe(absolute)].some((item) => included(`${name}/${item.name}`))))
      return;
    let stat;
    try {
      stat = lstatSync2(absolute);
    } catch (error) {
      throw new TreeArchiveError("io_error", `io_error: ${absolute}`, error);
    }
    const mode = stat.mode;
    if (stat.isDirectory()) {
      if (name)
        entries.push({ path: `${name}/`, kind: "dir", mode });
      for (const child of readdirSafe(absolute))
        visit(join2(absolute, child.name), name ? `${name}/${child.name}` : child.name);
      return;
    }
    if (stat.isFile()) {
      const data = readFileSync(absolute);
      totalBytes += data.byteLength;
      entries.push({ path: name, kind: "file", mode, data });
      return;
    }
    if (stat.isSymbolicLink()) {
      const link = readlink(absolute);
      if (!linkTargetStaysInside(name, link))
        return;
      entries.push({ path: name, kind: "symlink", mode, link });
      return;
    }
    throw new TreeArchiveError("unsupported_path_kind", `unsupported_path_kind: ${absolute}`);
  };
  visit(root, "");
  entries.sort((a, b) => a.path.localeCompare(b.path));
  return { entries, totalBytes };
};
var entryBlocks = (entry) => {
  const longName = Buffer.byteLength(entry.path) > 100;
  const longLink = entry.link !== undefined && Buffer.byteLength(entry.link) > 100;
  const body = [
    header({
      name: longName ? "" : entry.path,
      mode: entry.mode,
      size: entry.data?.length ?? 0,
      type: TYPE_CODES[entry.kind],
      link: longLink ? "" : entry.link
    }),
    padded(entry.data ?? Buffer.alloc(0))
  ];
  if (!longName && !longLink)
    return body;
  const paxData = Buffer.concat([
    longName ? paxRecord("path", entry.path) : Buffer.alloc(0),
    longLink ? paxRecord("linkpath", entry.link ?? "") : Buffer.alloc(0)
  ]);
  const paxName = `PaxHeaders/${createHash4("sha256").update(entry.path).digest("hex").slice(0, 16)}`;
  return [header({ name: paxName, mode: 420, size: paxData.length, type: "x" }), padded(paxData), ...body];
};
var readdirSafe = (path) => {
  try {
    return readdirSync2(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    throw new TreeArchiveError("io_error", `io_error: ${path}`, error);
  }
};
var readlink = (path) => {
  try {
    return readlinkSync(path, "utf8");
  } catch (error) {
    throw new TreeArchiveError("io_error", `io_error: ${path}`, error);
  }
};
var globMatch = (pattern, path) => {
  const bun = Reflect.get(globalThis, "Bun");
  if (typeof bun?.Glob === "function")
    return new bun.Glob(pattern).match(path);
  const escaped = pattern.replace(/[.+^${}()|[\\]\\]/g, "\\$&").replace(/\\\*\\\*/g, ".*").replace(/\\\*/g, "[^/]*").replace(/\\\?/g, "[^/]");
  return new RegExp(`^${escaped}$`).test(path);
};

// src/tree-ops.ts
var pushMachineTree = async (deps, call) => {
  deps.requireTreeTransfer(call.machineId);
  const packed = await packTree(call.localDir, {
    ...call.options?.ignore === undefined ? {} : { ignore: call.options.ignore }
  });
  if (deps.transport.uploadArtifact === undefined)
    throw new TreeTransferUnsupportedError(call.machineId);
  const artifact = await deps.transport.uploadArtifact(packed.bytes);
  return deps.invoke({
    machineId: call.machineId,
    capability: "fs.tree.apply",
    args: { path: call.remotePath, format: "tar+gzip", artifact, clean: call.options?.clean },
    callOptions: call.callOptions
  });
};
var pullMachineTree = async (deps, call) => {
  deps.requireTreeTransfer(call.machineId);
  const raw = await deps.invoke({
    machineId: call.machineId,
    capability: "fs.tree.pack",
    args: {
      path: call.remotePath,
      format: "tar+gzip",
      ignore: call.options?.ignore,
      include: call.options?.include
    },
    callOptions: call.callOptions
  });
  const artifact = parseArtifactRef(raw && typeof raw === "object" ? Reflect.get(raw, "artifact") : undefined);
  if (artifact === undefined)
    throw new HubTransportError("artifact_fetch_failed", "fs.tree.pack returned malformed artifact");
  const response = await deps.fetchFn()(artifact.url);
  if (!response.ok)
    throw new HubTransportError("artifact_fetch_failed", `artifact download responded ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length !== artifact.size || computeSha256(bytes) !== artifact.sha256)
    throw new HubTransportError("artifact_fetch_failed", "artifact digest or size mismatch");
  return extractTree(bytes, call.localDir, {});
};
var computeSha256 = (bytes) => createHash5("sha256").update(bytes).digest("hex");

// src/machine-hub.ts
var connectMachineHub = async (options) => {
  let connected = false;
  try {
    await options.transport.connect();
    connected = true;
    return new ConnectedMachineHub(options, await loadHubSnapshot(options.transport));
  } catch (error) {
    if (connected) {
      await options.transport.close().catch(() => {});
    }
    if (error instanceof MachineHubConnectError) {
      throw error;
    }
    if (error instanceof Error) {
      throw new MachineHubConnectError(error.message, error);
    }
    throw new MachineHubConnectError(String(error));
  }
};
var loadHubSnapshot = async (transport) => {
  const machines = await transport.listMachines();
  const tools = new Map;
  for (const machine of machines) {
    tools.set(machine.id, await transport.listTools(machine.id));
  }
  return { machines, tools };
};
var normalizeMachines = (snapshot) => snapshot.machines.map((machine) => ({
  ...machine,
  kind: machine.kind ?? "enrolled",
  routes: machine.routes ?? [
    {
      kind: "direct",
      machineId: machine.id,
      online: machine.state === "online",
      capabilities: (snapshot.tools.get(machine.id) ?? []).map((tool) => tool.capability)
    }
  ],
  connection: machine.connection ?? (machine.state === "online" ? "hub" : "none")
}));

class ConnectedMachineHub {
  transport;
  machines;
  tools;
  transportKind;
  mint;
  resolveArtifact;
  connectionTaskId = `adhoc:${crypto.randomUUID()}`;
  readDeps = {
    invoke: (call) => this.invoke(call),
    requireCapability: (machineId, capability) => this.requireCapability(machineId, capability),
    resolveArtifact: (ref) => this.resolveReadArtifact(ref),
    fetchFn: () => this.transportFetch()
  };
  treeDeps;
  nextWireSeq = 0;
  nextAdhocWireSeq() {
    const seq = this.nextWireSeq;
    this.nextWireSeq += 1;
    return seq;
  }
  constructor(options, snapshot) {
    this.transport = options.transport;
    this.treeDeps = {
      invoke: (call) => this.invoke(call),
      requireTreeTransfer: (machineId) => this.requireTreeTransfer(machineId),
      transport: options.transport,
      fetchFn: () => this.transportFetch()
    };
    this.machines = normalizeMachines(snapshot);
    this.tools = snapshot.tools;
    const transportResolver = options.transport.resolveArtifact;
    this.resolveArtifact = options.resolveArtifact ?? (transportResolver === undefined ? undefined : (ref) => transportResolver.call(options.transport, ref));
    this.transportKind = options.transport.kind ?? "hub";
    const transportMint = options.transport.mintCapabilityToken;
    this.mint = options.mintCapabilityToken ?? (transportMint === undefined ? undefined : (input) => transportMint.call(options.transport, input));
  }
  listMachines() {
    return this.machines.map((machine) => machineProxy(this, machine));
  }
  getMachine(idOrAlias) {
    return machineProxy(this, this.resolve(idOrAlias));
  }
  findMachine(query) {
    return this.machines.filter((machine) => matchesQuery(machine, query)).map((machine) => machineProxy(this, machine));
  }
  listTools(idOrAlias) {
    return this.toolsFor(this.resolve(idOrAlias).id);
  }
  async refresh() {
    const snapshot = await loadHubSnapshot(this.transport);
    this.machines = normalizeMachines(snapshot);
    this.tools = snapshot.tools;
  }
  mintCapabilityToken(input) {
    if (this.mint === undefined) {
      return Promise.reject(new HubTransportError("mint_unavailable", "transport does not mint capability tokens"));
    }
    return this.mint(input);
  }
  resultOf(requestId) {
    const resultOf = this.transport.resultOf;
    if (resultOf === undefined) {
      return Promise.reject(new HubTransportError("result_failed", "transport does not expose the durable results route", requestId));
    }
    return resultOf.call(this.transport, requestId);
  }
  setPolicy(machineId, policy) {
    if (this.transport.setPolicy === undefined)
      throw new HubTransportError("policy_unavailable", "transport does not expose device policy");
    return this.transport.setPolicy(machineId, policy);
  }
  getPolicy(machineId) {
    if (this.transport.getPolicy === undefined)
      throw new HubTransportError("policy_unavailable", "transport does not expose device policy");
    return this.transport.getPolicy(machineId);
  }
  events(options) {
    const events = this.transport.events;
    if (events === undefined) {
      throw new FleetEventsError("transport does not expose fleet events");
    }
    return events.call(this.transport, options);
  }
  close() {
    return this.transport.close();
  }
  createTaskContext(taskId, options) {
    return new TaskContext(taskId, options);
  }
  taskContextRequired() {
    throw new TaskContextRequiredError;
  }
  pushTree(call) {
    return pushMachineTree(this.treeDeps, call);
  }
  pullTree(call) {
    return pullMachineTree(this.treeDeps, call);
  }
  requireTreeTransfer(machineId) {
    if (!this.resolve(machineId).protocolFeatures?.includes("tree-transfer") && !this.hasCapability(machineId, "fs.tree.pack") && !this.hasCapability(machineId, "fs.tree.apply"))
      throw new TreeTransferUnsupportedError(machineId);
  }
  async write(call) {
    const args = await fsWritePayload(this.resolve(call.machineId), call.path, call.content, call.options);
    return this.invoke({ machineId: call.machineId, capability: "fs.write", args, callOptions: call.callOptions });
  }
  read(call) {
    return readMachine(this.readDeps, "bytes", call);
  }
  readText(call) {
    return readMachine(this.readDeps, "text", call);
  }
  readHandle(call) {
    return readMachine(this.readDeps, "handle", call);
  }
  async invoke(call) {
    const { machineId, capability, args, callOptions } = call;
    callOptions?.signal?.throwIfAborted();
    const route = this.routePreference(capability, callOptions);
    this.requireCapability(machineId, capability, route === undefined ? undefined : { route });
    const context = callOptions?.taskContext;
    const opSeq = context === undefined ? this.nextAdhocWireSeq() : context.nextWireOpSeq();
    const taskId = context === undefined ? callOptions?.taskId ?? this.connectionTaskId : context.taskId;
    const wireArgs = normalizeOperationArgs(args);
    const metadata = {
      ...route === undefined ? {} : { route },
      taskId,
      opSeq,
      effect: OP_EFFECTS[capability] ?? "mutate",
      opId: callOptions?.opId ?? computeWireOpId(machineId, taskId, opSeq, capability, wireArgs),
      ...callOptions?.capabilityToken === undefined ? {} : { capabilityToken: callOptions.capabilityToken }
    };
    const signal = callOptions?.signal;
    const value = signal === undefined ? await this.transport.invoke(machineId, capability, wireArgs, metadata, callOptions?.terminalTimeoutMs) : await this.transport.invoke(machineId, capability, wireArgs, metadata, callOptions?.terminalTimeoutMs, signal);
    if (this.transport.normalizesDurableResults === true)
      return value;
    const resolver = this.resolveArtifact;
    const acceptLegacyBodyArtifact = this.toolsFor(machineId).some((tool) => tool.capability === capability && tool.transport === "built-in") && OP_REGISTRY.some((entry) => entry.op === capability && entry.transport === "built-in");
    return resolveDurableResultEnvelope(value, {
      fetchFn: this.transportFetch(),
      acceptLegacyBodyArtifact,
      ...resolver === undefined ? {} : { resolveArtifact: resolver }
    });
  }
  tool(machineId, capability, boundOptions) {
    if (!this.hasCapability(machineId, capability, this.routePreference(capability, boundOptions))) {
      return;
    }
    return (args, callOptions) => this.invoke({ machineId, capability, args, callOptions: mergeCallOptions(boundOptions, callOptions) });
  }
  requireCapability(machineId, capability, callOptions) {
    requireCapabilityOf(this.resolve(machineId), capability, this.routePreference(capability, callOptions), this.transport.explainRouteRefusal);
  }
  async resolveReadArtifact(ref) {
    const resolver = this.resolveArtifact;
    if (resolver === undefined)
      return { ref, signal: undefined };
    return resolver(ref);
  }
  transportFetch() {
    const fetchArtifact = this.transport.fetchArtifact;
    return fetchArtifact === undefined ? fetch : fetchArtifact.bind(this.transport);
  }
  routePreference(capability, options) {
    return routePreferenceOf(capability, options);
  }
  hasCapability(machineId, capability, preference = "auto") {
    return hasCapability(this.resolve(machineId), capability, preference);
  }
  toolsFor(machineId) {
    return this.tools.get(machineId) ?? [];
  }
  resolve(idOrAlias) {
    return resolveMachineRecord(this.machines, idOrAlias);
  }
}
var matchesQuery = (machine, query) => {
  if (query.tag !== undefined && !machine.tags.includes(query.tag)) {
    return false;
  }
  if (query.os !== undefined && machine.os !== query.os) {
    return false;
  }
  if (query.arch !== undefined && machine.arch !== query.arch) {
    return false;
  }
  return true;
};

// src/connect.ts
var connect = async (options) => {
  const { transport } = options;
  await transport.connect();
  const hub = await connectMachineHub({
    transport,
    ...options.resolveArtifact === undefined ? {} : { resolveArtifact: options.resolveArtifact }
  });
  const session = transport.credentialRefresh;
  return options.createFacade?.(hub, session, options.operatorConfig) ?? new BunshinFacade(hub, session, options.operatorConfig, options.facade);
};
// src/machine-errors.ts
class MachineWireError extends HubTransportError {
  disposition;
  constructor(code, message, requestId = "", disposition, detail) {
    super(code, message, requestId, detail);
    this.name = new.target.name;
    this.disposition = disposition;
  }
}

class InvokeDeadlineError extends MachineWireError {
  constructor(message, requestId = "", disposition) {
    super("invoke_deadline", message, requestId, disposition);
  }
}

class OpFailedError extends MachineWireError {
  constructor(message, requestId = "", disposition) {
    super("op_failed", message, requestId, disposition);
  }
}

class BudgetExceededError extends MachineWireError {
  constructor(message, requestId = "", disposition) {
    super("budget_exceeded", message, requestId, disposition);
  }
}

class MalformedFrameError extends MachineWireError {
  constructor(message, requestId = "", disposition) {
    super("malformed_frame", message, requestId, disposition);
  }
}

class WrongKindError extends MachineWireError {
  constructor(message, requestId = "", disposition) {
    super("wrong_kind", message, requestId, disposition);
  }
}

class AgentBusyRefreshError extends MachineWireError {
  constructor(message, requestId = "", disposition) {
    super("agent_busy_refresh", message, requestId, disposition);
  }
}

class PersistenceFailedError extends MachineWireError {
  constructor(message, requestId = "", disposition) {
    super("persistence_failed", message, requestId, disposition);
  }
}

class MachineOfflineSkippedError extends MachineWireError {
  constructor(message, requestId = "", disposition) {
    super("machine_offline_skipped", message, requestId, disposition);
  }
}
// src/result-shape.ts
import { Value as Value2 } from "@sinclair/typebox/value";
var isBridgeEnvelope = (value) => Value2.Check(meshOperationContracts.bridgeInvoke[1], value);
var field2 = (value, key) => typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
var isString = (value) => typeof value === "string";
var isInteger = (value) => typeof value === "number" && Number.isSafeInteger(value);
var isShellResult = (value) => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  if (!isInteger(field2(value, "exitCode")) || !isString(field2(value, "stdout")) || !isString(field2(value, "stderr"))) {
    return false;
  }
  const timeout = field2(value, "timeout");
  return timeout === undefined || timeout === "deadline" || timeout === "exit-unconfirmed";
};
var isTerminalFrame = (value) => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  if (!isString(field2(value, "handleId")) || !isString(field2(value, "output")))
    return false;
  const state = field2(value, "state");
  if (state !== "running" && state !== "completed")
    return false;
  if (!isInteger(field2(value, "lastSeq")))
    return false;
  const truncated = field2(value, "truncated");
  return truncated === undefined || typeof truncated === "boolean";
};
export {
  AgentBusyRefreshError,
  AmbiguousMachineLookupError,
  ArtifactDigestMismatchError,
  ArtifactFetchError,
  ArtifactSizeMismatchError,
  BudgetExceededError,
  BunshinFacade,
  CapabilityUnavailableError,
  CommandHandleLostError,
  CommandKilledError,
  ConnectedMachineHub,
  DurableResultArtifactResolverMissingError,
  DurableResultEnvelopeError,
  FanoutDuplicateTargetError,
  FanoutOptionsError,
  FanoutRun,
  FanoutTimeoutError,
  FleetEventsError,
  HubTransportError,
  InvokeDeadlineError,
  LedgerMismatchError,
  MachineHubConnectError,
  MachineNotFoundError,
  MachineOfflineSkippedError,
  MachineWireError,
  MalformedFrameError,
  OpFailedError,
  PersistenceFailedError,
  ReadLimitError,
  StdinActivityTimeoutError,
  TaskContextRequiredError,
  TerminalLifecycleUnsupportedError,
  TreeTransferUnsupportedError,
  UNLIMITED_FANOUT_DEFAULTS,
  WrongKindError,
  attachBunshinMachinesAsNodes,
  connect,
  connectMachineHub,
  fanout,
  isBridgeEnvelope,
  isShellResult,
  isTerminalFrame
};
