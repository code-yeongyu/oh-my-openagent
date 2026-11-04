import { type CapabilityManifest } from "./capability.ts";
import { type DoctorReport } from "./doctor.ts";
import { type HubError, type HubRequest, type MeshInvoke, type MeshManifest, type MeshResponse } from "./envelopes.ts";
import { type ProtocolErrorFrame } from "./error-plane.ts";
import { type HubTransferProbe, type HubTransferRedeemResult, type MeshTransferCandidates, type MeshTransferProbeResult, type MeshTransferRedeem } from "./mesh.ts";
import { type Disconnected, type ExecCommandRequest, type Resumable, type ShellRequest, type TerminalHandle, type TerminalMessage, type WaitForCommandRequest, type WriteStdinRequest } from "./terminal.ts";
type ProtocolParseErrorInit = {
    readonly schemaName: string;
    readonly path: string;
    readonly detail: string;
};
export declare class ProtocolParseError extends Error {
    readonly schemaName: string;
    readonly path: string;
    readonly detail: string;
    constructor(init: ProtocolParseErrorInit);
}
export declare const parseMeshInvoke: (value: unknown) => MeshInvoke;
export declare const parseErrorFrame: (value: unknown) => ProtocolErrorFrame;
export declare const parseMeshResponse: (value: unknown) => MeshResponse;
export declare const parseMeshManifest: (value: unknown) => MeshManifest;
export declare const parseHubRequest: (value: unknown) => HubRequest;
export declare const parseHubError: (value: unknown) => HubError;
export declare const parseMeshTransferRedeem: (value: unknown) => MeshTransferRedeem;
export declare const parseHubTransferRedeemResult: (value: unknown) => HubTransferRedeemResult;
export declare const parseMeshTransferCandidates: (value: unknown) => MeshTransferCandidates;
export declare const parseHubTransferProbe: (value: unknown) => HubTransferProbe;
export declare const parseMeshTransferProbeResult: (value: unknown) => MeshTransferProbeResult;
export declare const parseCapabilityManifest: (value: unknown) => CapabilityManifest;
export declare const parseDoctorReport: (value: unknown) => DoctorReport;
export declare const parseTerminalMessage: (value: unknown) => TerminalMessage;
export declare const parseShellRequest: (value: unknown) => ShellRequest;
export declare const parseExecCommandRequest: (value: unknown) => ExecCommandRequest;
export declare const parseWriteStdinRequest: (value: unknown) => WriteStdinRequest;
export declare const parseWaitForCommandRequest: (value: unknown) => WaitForCommandRequest;
export declare const parseTerminalHandle: (value: unknown) => TerminalHandle;
export declare const parseDisconnected: (value: unknown) => Disconnected;
export declare const parseResumable: (value: unknown) => Resumable;
export {};
