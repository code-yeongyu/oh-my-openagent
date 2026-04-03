# 04. Doom Loop 감지 강화

> Phase 1 | 예상 소요: 1주

---

## 문제 정의

현재 루프 감지는 서브에이전트에만 적용되고, 단순 기준을 사용한다.

- `background-agent/loop-detector.ts`: 서브에이전트 전용, 동일 툴 N회 연속만 감지
- 메인 에이전트의 순환 패턴 감지 없음
- 감지 후 "중단"만 하고 복구 전략 없음
- A→B→A→B 같은 교번 루프 감지 불가

---

## 설계

### 감지 신호 유형

```typescript
type LoopSignal = {
  // 기존 (유지)
  consecutiveIdenticalTool: {
    tool: string;
    count: number;
    threshold: number;
  } | null;

  // 신규: 순환 패턴
  cyclicToolPattern: {
    pattern: string[];   // ['bash', 'read', 'bash', 'read']
    cycleLength: number; // 2
    repetitions: number; // 3
  } | null;

  // 신규: 출력 정체
  staleOutputPattern: {
    tool: string;
    similarOutputCount: number;
    similarity: number;  // 0~1
  } | null;

  // 신규: 컨텍스트 정체
  contextStagnation: {
    turnsWithoutProgress: number;
    lastMeaningfulAction: string;
  } | null;

  // 심각도 집계
  severity: 'none' | 'warning' | 'medium' | 'high' | 'critical';
};
```

### 심각도 계산

```
warning  → 단일 신호 1개 감지
medium   → 단일 신호 2개 이상 OR 순환 패턴 감지
high     → 출력 정체 + 다른 신호 조합
critical → 컨텍스트 정체 N턴 + 다른 신호 조합
```

---

## 구현 파일

### `src/features/doom-loop-detector/pattern-analyzer.ts`

```typescript
// 최근 N개 툴 호출 이력에서 순환 패턴 탐지
export function detectCyclicPattern(
  toolHistory: ToolCall[],
  windowSize: number = 20
): CyclicPattern | null {
  // 길이 2~5의 반복 패턴 탐색
  for (let len = 2; len <= 5; len++) {
    const pattern = toolHistory.slice(-len * 2, -len);
    const recent = toolHistory.slice(-len);
    if (arraysEqual(pattern, recent)) {
      return { pattern: recent.map(t => t.name), cycleLength: len, repetitions: 2 };
    }
  }
  return null;
}
```

### `src/features/doom-loop-detector/stagnation-detector.ts`

```typescript
// 툴 출력이 이전과 유사한지 감지 (정규화 후 해밍 거리)
export function detectStaleOutput(
  recentOutputs: ToolOutput[],
  similarityThreshold: number = 0.85
): StaleOutputSignal | null {
  // 최근 3개 출력에서 유사도 계산
  // 유사도 > threshold이면 stale로 간주
}
```

### `src/features/doom-loop-detector/recovery-strategies.ts`

```typescript
export type RecoveryAction =
  | { type: 'warn'; message: string }
  | { type: 'suggest_alternative'; prompt: string }
  | { type: 'delegate'; targetAgent: string; remainingTask: string }
  | { type: 'abort'; saveState: boolean };

export function getRecoveryAction(
  severity: LoopSeverity,
  config: DoomLoopConfig
): RecoveryAction {
  return {
    warning:  () => ({ type: 'warn', message: '...' }),
    medium:   () => ({ type: 'suggest_alternative', prompt: '...' }),
    high:     () => ({ type: 'delegate', targetAgent: 'hephaestus', ... }),
    critical: () => ({ type: 'abort', saveState: true }),
  }[severity]();
}
```

---

## 훅 연동

### `src/hooks/doom-loop-detector/index.ts`

```typescript
// experimental.chat.messages.transform 훅에서 실행
// 최근 20개 메시지를 분석해 루프 신호 탐지
export function createDoomLoopDetectorHook(config: DoomLoopConfig) {
  const patternAnalyzer = createPatternAnalyzer();
  const stagnationDetector = createStagnationDetector();
  
  return {
    event: 'experimental.chat.messages.transform',
    handler: async (ctx) => {
      const signal = analyzeLoopSignals(ctx.messages, patternAnalyzer, stagnationDetector);
      
      if (signal.severity === 'none') return;
      
      const action = getRecoveryAction(signal.severity, config);
      await executeRecoveryAction(action, ctx);
    }
  };
}
```

---

## 기존 코드 확장

### `src/features/background-agent/loop-detector.ts` 확장

기존 서브에이전트 루프 감지에 새 신호 유형 추가:

```typescript
// 기존
if (consecutiveCount >= threshold) abort();

// 신규 추가
const cyclicPattern = detectCyclicPattern(toolHistory);
const staleOutput = detectStaleOutput(recentOutputs);
const severity = calculateSeverity({ consecutiveCount, cyclicPattern, staleOutput });
const action = getRecoveryAction(severity, config);
await executeRecoveryAction(action);
```

---

## 설정 스키마

```typescript
// src/config/schema/doom-loop.ts
export const DoomLoopConfigSchema = z.object({
  enabled: z.boolean().default(true),
  thresholds: z.object({
    consecutive_tool_calls: z.number().default(5),
    cyclic_pattern_repetitions: z.number().default(3),
    stale_output_similarity: z.number().min(0).max(1).default(0.85),
    stagnation_turns: z.number().default(15),
  }),
  recovery: z.object({
    warning_enabled: z.boolean().default(true),
    delegation_agent: z.string().default('hephaestus'),
    abort_saves_state: z.boolean().default(true),
  }),
});
```

---

## 테스트 시나리오

1. bash → read → bash → read 4회 반복 → medium 심각도 감지, 대안 제안
2. 동일 grep 6회 연속 → 기존 consecutive 감지 + warning 메시지
3. 동일 파일 내용 read 4회 → stale output 감지, 다른 접근 권장
4. 20턴 동안 TODO 변화 없음 → stagnation 감지, 서브에이전트 위임
5. critical 상태 → 세션 상태 저장 후 중단, 재개 가능 확인
