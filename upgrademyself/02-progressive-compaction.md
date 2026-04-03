# 02. 5단계 점진적 Compaction

> Phase 2 | 예상 소요: 2~3주

---

## 문제 정의

현재 compaction은 이진(binary)적이다: 컨텍스트가 가득 차면 한 번에 압축한다.

- `compaction-context-injector`: compaction 후 AGENTS.md/README.md 재주입만 함
- `compaction-todo-preserver`: TODO 상태만 보존
- 컨텍스트 사용량에 따른 점진적 대응이 없어 갑작스러운 정보 손실 발생

---

## 설계

### 5단계 임계값

```
Green  [0%  ~ 60%] → 정상 동작
Yellow [60% ~ 75%] → 부드러운 최적화
Orange [75% ~ 85%] → 적극적 압축
Red    [85% ~ 95%] → 긴급 압축
Critical [95%+]   → 강제 compaction + 재시작
```

### 설정 스키마

```typescript
// src/config/schema/progressive-compaction.ts
export const ProgressiveCompactionConfigSchema = z.object({
  enabled: z.boolean().default(true),
  thresholds: z.object({
    yellow: z.number().min(0).max(1).default(0.60),
    orange: z.number().min(0).max(1).default(0.75),
    red:    z.number().min(0).max(1).default(0.85),
    critical: z.number().min(0).max(1).default(0.95),
  }),
  strategies: z.object({
    yellow: z.object({
      max_tool_output_chars: z.number().default(5000),   // 기본 20000 → 5000
      resize_images: z.boolean().default(true),
    }),
    orange: z.object({
      summarize_old_tool_results: z.boolean().default(true),
      old_tool_results_age_turns: z.number().default(10), // 10턴 이전 결과 요약
      preserve_todo_only: z.boolean().default(true),
    }),
    red: z.object({
      delegate_to_subagent: z.boolean().default(true),
      strip_reasoning: z.boolean().default(true),
    }),
    critical: z.object({
      force_compaction: z.boolean().default(true),
      save_state_and_restart: z.boolean().default(true),
    }),
  }),
});
```

---

## 구현 파일

### `src/features/progressive-compaction/compaction-level.ts`

```typescript
export type CompactionLevel = 'green' | 'yellow' | 'orange' | 'red' | 'critical';

export function calculateCompactionLevel(
  usedTokens: number,
  maxTokens: number,
  thresholds: CompactionThresholds
): CompactionLevel {
  const ratio = usedTokens / maxTokens;
  if (ratio >= thresholds.critical) return 'critical';
  if (ratio >= thresholds.red)      return 'red';
  if (ratio >= thresholds.orange)   return 'orange';
  if (ratio >= thresholds.yellow)   return 'yellow';
  return 'green';
}
```

### `src/features/progressive-compaction/compaction-strategies.ts`

```typescript
export function createStrategy(level: CompactionLevel, config: StrategyConfig) {
  return {
    green:    () => noopStrategy(),
    yellow:   () => softOptimizationStrategy(config.yellow),
    orange:   () => aggressiveCompressionStrategy(config.orange),
    red:      () => emergencyCompressionStrategy(config.red),
    critical: () => forceCompactionStrategy(config.critical),
  }[level]();
}
```

### `src/features/progressive-compaction/context-monitor.ts`

```typescript
// chat.params 훅에서 실행 - 모델 호출 시마다 컨텍스트 사용량 추적
export function createContextMonitor() {
  return {
    update(usedTokens: number, maxTokens: number): CompactionLevel,
    getLevel(): CompactionLevel,
    getLevelHistory(): CompactionLevel[],
  };
}
```

---

## 단계별 행동 상세

### Yellow (60~75%): 부드러운 최적화
- `tool.execute.after` 훅: 툴 출력 최대 5,000자로 잘라내기 (현재 20,000)
- `read-image-resizer` 훅: 이미지를 512px로 리사이즈 (현재 1024px)
- 에이전트에게: "컨텍스트가 60% 이상 사용되었습니다. 불필요한 반복을 줄이세요."

### Orange (75~85%): 적극적 압축
- `experimental.chat.messages.transform`: 10턴 이전 툴 결과를 요약으로 대체
- TODO 상태만 유지, 완료된 계획 본문 제거
- 에이전트에게: "주요 결정사항만 유지하고 세부 내용은 생략하세요."

### Red (85~95%): 긴급 압축
- 새 서브에이전트에게 남은 작업 위임
- thinking block에서 reasoning 제거 (결론만 유지)
- 에이전트에게: "즉시 결론을 내리고 남은 작업을 정리하세요."

### Critical (95%+): 강제 compaction
- 현재 상태를 boulder-state에 저장
- `/compact` 명령어 강제 실행
- compaction 후 이전 상태로 재개

---

## 훅 연동 포인트

```
chat.params          → 컨텍스트 사용량 감지, 단계 계산
tool.execute.after   → Yellow: 출력 잘라내기
messages.transform   → Orange: 오래된 결과 요약
event.session.idle   → Red: 서브에이전트 위임
event.session.*      → Critical: 강제 compaction
```

---

## 테스트 시나리오

1. 컨텍스트 사용률 시뮬레이션으로 각 단계 전환 확인
2. Yellow 단계: 5001자 툴 출력이 5000자로 잘리는지 확인
3. Orange 단계: 15턴 이전 bash 출력이 "[요약됨]"으로 대체되는지 확인
4. Critical 단계: 강제 compaction 후 태스크가 재개되는지 확인
