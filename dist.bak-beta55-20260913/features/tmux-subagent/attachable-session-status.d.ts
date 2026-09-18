declare const ATTACHABLE_SESSION_STATUSES: readonly ["idle", "running", "busy", "retry"];
export type AttachableSessionStatus = (typeof ATTACHABLE_SESSION_STATUSES)[number];
export declare function isAttachableSessionStatus(status: string | undefined): status is AttachableSessionStatus;
export {};
