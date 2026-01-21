export type FailoverStrategy = 'auto' | 'aggressive' | 'conservative';

export type ProviderStatus = 'HEALTHY' | 'COOLING' | 'LOCKED' | 'PROBATION';

export interface ProviderState {
  status: ProviderStatus;
  resumeAt: number;
  reason?: string;
  retryCount: number;
}

export interface FailoverConfig {
  enabled: boolean;
  strategy: FailoverStrategy;
  cooldown?: number;
}

export type RecoveryAction = 'COOLING' | 'LOCKED' | 'RETRY' | 'SKIP';

export interface DiagnoseResult {
  action: RecoveryAction;
  reason: string;
  cooldownMs?: number;
}

export interface ModelChain {
  primary: string;
  fallbacks: string[];
}
