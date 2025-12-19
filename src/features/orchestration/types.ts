export interface DelegationRecord {
  fromAgent: string;
  toAgent: string;
  timestamp: number;
  depth: number;
  sessionId: string;
}

export interface DelegationTrackerConfig {
  maxDepth: number;
  detectLoops: boolean;
  warnOnDeepChain: boolean;
  deepChainThreshold: number;
}

export interface DelegationCheckResult {
  allowed: boolean;
  reason?: string;
  depth: number;
  history: DelegationRecord[];
}

export interface MaxTurnsConfig {
  maxTurns: number;
  warnAtTurn: number;
  includeToolCalls: boolean;
}

export interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffFactor: number;
  jitterFactor: number;
  retryableErrors: string[];
}

export interface RetryResult<T> {
  success: boolean;
  result?: T;
  attempts: number;
  totalDelayMs: number;
  lastError?: Error;
}
