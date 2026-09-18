export declare function abortBtwSide(args: {
    sessionID: string;
    abortSession: (sessionID: string) => Promise<void>;
    showToast: (message: string) => void;
}): Promise<void>;
export declare function deleteBtwSide(args: {
    sessionID: string;
    deleteSession: (sessionID: string) => Promise<void>;
    showToast: (message: string) => void;
    failureMessage: string;
}): Promise<boolean>;
