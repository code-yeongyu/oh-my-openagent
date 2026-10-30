import type { RecoveryBridge } from "./ports.ts";

export const APPROVAL_PATH_MESSAGE =
	"Recovery on this device needs approval from another of your devices.";

export type RecoveryAvailability =
	| { readonly kind: "passkey" }
	| {
			readonly kind: "approval-only";
			readonly reason: "no-native-bridge" | "no-prf";
			readonly message: typeof APPROVAL_PATH_MESSAGE;
	  };

/**
 * Where passkey recovery can run: only behind a native bridge on a PRF-capable platform. The CLI
 * has no bridge, and older macOS or a Windows authenticator without hmac-secret has no PRF; both
 * offer only another device's approval, never anything weaker.
 */
export const recoveryAvailability = (
	bridge: RecoveryBridge | null,
): RecoveryAvailability => {
	if (bridge === null)
		return {
			kind: "approval-only",
			reason: "no-native-bridge",
			message: APPROVAL_PATH_MESSAGE,
		};
	if (!bridge.prfSupported)
		return {
			kind: "approval-only",
			reason: "no-prf",
			message: APPROVAL_PATH_MESSAGE,
		};
	return { kind: "passkey" };
};
