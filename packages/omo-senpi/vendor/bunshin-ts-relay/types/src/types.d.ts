export declare const RELAY_STATUS_STATES: readonly ["not_configured", "disabled", "sign_in_required", "plan_required", "keychain_locked", "connecting", "activation_pending", "connected", "offline", "authorization_stale", "service_degraded", "update_required", "signed_out", "fail_closed"];
export type StatusState = (typeof RELAY_STATUS_STATES)[number];
export type RelayStatus = Readonly<{
    state: StatusState;
    device: {
        readonly id: string;
        readonly name: string;
    } | null;
    connected: boolean;
}>;
export type RelayStatusResult = RelayStatus | Readonly<{
    state: null;
    device: null;
    connected: false;
}>;
export declare const OUTPUT_CREDIT_BYTES = 65536;
export type OutputItem = {
    readonly kind: "bytes";
    readonly bytes: Uint8Array;
} | {
    readonly kind: "gap";
    readonly missing: number;
};
export type DeadlineTimer = (expire: () => void, ms: number) => () => void;
