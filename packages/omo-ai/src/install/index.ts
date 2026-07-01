export type SenpiInstallOptions = {
  readonly packageRoot?: string;
  readonly agentDir?: string;
  readonly updatedAt?: string;
};

export type SenpiInstallReport = {
  readonly ok: boolean;
  readonly action: "repair" | "uninstall" | "doctor";
  readonly packageRoot: string;
  readonly payloadRoot: string;
  readonly settingsPath: string;
  readonly hooksStatePath: string;
  readonly packageEntryCount: number;
  readonly packageEntryPresentExactlyOnce: boolean;
  readonly omoTrustEntryCount: number;
  readonly expectedOmoTrustEntryCount: number;
  readonly missingTrustEntries: readonly string[];
  readonly backupPaths: readonly string[];
  readonly problems: readonly string[];
  readonly updatedAt: string;
};

export declare function repairSenpiInstall(options?: SenpiInstallOptions): SenpiInstallReport;

export declare function uninstallSenpiInstall(options?: SenpiInstallOptions): SenpiInstallReport;

export declare function inspectSenpiInstall(options?: SenpiInstallOptions): SenpiInstallReport;
