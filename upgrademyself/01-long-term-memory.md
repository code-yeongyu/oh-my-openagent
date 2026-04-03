# 01. 크로스세션 장기 메모리 (Cross-Session Long-Term Memory)

> Phase 2 | 예상 소요: 2~3주

---

## 문제 정의

현재 oh-my-openagent는 세션이 끊기면 에이전트가 배운 것들이 사라진다.

- `boulder-state`: 현재 세션 태스크 상태만 추적
- `compaction-context-injector`: AGENTS.md/README.md 주입 (고정된 프로젝트 지식)
- 에이전트가 "이 프로젝트에서 X는 항상 Y 방식으로 해야 한다"는 것을 배워도 다음 세션에서 다시 배워야 함

---

## 설계

### 저장 구조

```
.opencode/
└── memory/
    ├── entries.jsonl           # 메모리 엔트리 (JSON Lines)
    └── index.json              # 태그 인덱스 (빠른 검색)
```

### 메모리 엔트리 스키마

```typescript
// src/config/schema/memory-entry.ts
import { z } from 'zod/v4';

export const MemoryEntrySchema = z.object({
  id: z.string(),                          // nanoid(8)
  timestamp: z.string(),                   // ISO8601
  sessionId: z.string(),                   // 출처 세션
  type: z.enum([
    'decision',    // 중요한 결정 (예: "이 API는 항상 retry 3회 후 실패처리")
    'failure',     // 실패 패턴 (예: "X 방법으로 하면 Y 오류 발생")
    'pattern',     // 코드 패턴 (예: "이 프로젝트는 factory 패턴 사용")
    'preference',  // 사용자 선호 (예: "코드 설명은 한국어로")
  ]),
  summary: z.string().max(200),            // 1-2줄 요약
  context: z.string().max(2000),           // 원문 컨텍스트
  tags: z.array(z.string()).max(10),       // 키워드 태그
  hitCount: z.number().default(0),         // 재사용 횟수
  lastHit: z.string().optional(),          // 마지막 사용 시점
});

export type MemoryEntry = z.infer<typeof MemoryEntrySchema>;
```

### 설정 스키마

```typescript
// src/config/schema/long-term-memory.ts
export const LongTermMemoryConfigSchema = z.object({
  enabled: z.boolean().default(true),
  max_entries: z.number().min(10).max(1000).default(200),
  max_inject_count: z.number().min(1).max(20).default(5),
  inject_types: z.array(MemoryEntrySchema.shape.type).default([
    'decision', 'failure', 'pattern', 'preference'
  ]),
  auto_extract: z.boolean().default(true),  // 세션 종료 시 자동 추출
  storage_path: z.string().default('.opencode/memory'),
});
```

---

## 구현 파일

### `src/features/long-term-memory/memory-store.ts`

```typescript
export function createMemoryStore(storagePath: string) {
  return {
    async append(entry: MemoryEntry): Promise<void>,
    async getAll(): Promise<MemoryEntry[]>,
    async updateHit(id: string): Promise<void>,
    async prune(maxEntries: number): Promise<void>,  // LRU 기반 정리
  };
}
```

### `src/features/long-term-memory/memory-ranker.ts`

관련성 점수 계산 (키워드 매칭 기반, 외부 의존성 없음):

```typescript
export function rankMemories(
  entries: MemoryEntry[],
  currentMessage: string,
  maxCount: number
): MemoryEntry[] {
  // 1. 태그 매칭 점수
  // 2. 요약 텍스트 키워드 매칭
  // 3. 최근 사용 여부 가중치
  // 4. hitCount 가중치
  // → 상위 maxCount개 반환
}
```

### `src/hooks/memory-injector/index.ts`

```typescript
// chat.message 훅에서 실행
// 첫 번째 메시지 수신 시 관련 메모리를 시스템 프롬프트 앞에 주입
export function createMemoryInjectorHook(config: LongTermMemoryConfig) {
  return {
    event: 'chat.message',
    handler: async (ctx) => {
      if (!ctx.isFirstMessage) return;
      const memories = await rankMemories(...);
      if (memories.length === 0) return;
      ctx.injectSystemMessage(formatMemories(memories));
    }
  };
}
```

### `src/hooks/memory-extractor/index.ts`

```typescript
// event 훅의 session.idle / session.deleted 에서 실행
// 에이전트에게 중요한 정보를 메모리로 저장하도록 요청
export function createMemoryExtractorHook(config: LongTermMemoryConfig) {
  return {
    event: 'session.deleted',
    handler: async (ctx) => {
      // 세션 요약 요청 → 메모리 엔트리 생성
    }
  };
}
```

---

## 주입 포맷

```
[장기 메모리 - 관련 과거 경험]
💡 [decision] 이 프로젝트에서 API 호출은 항상 3회 retry 후 실패처리한다. (2026-03-15)
⚠️ [failure] hashline-edit에서 탭 문자가 포함된 라인은 해시 불일치 발생. (2026-03-20)
📌 [pattern] 새 기능은 src/features/ 아래 독립 모듈로 만들고 barrel export 필수. (2026-03-28)
```

---

## 테스트 시나리오

1. 세션 A: 에이전트가 "X는 Y 방식으로 해야 한다"는 결정을 내림
2. 세션 A 종료 시 memory-extractor가 해당 결정을 저장
3. 세션 B: 관련 태스크 시작 시 memory-injector가 해당 메모리 주입
4. 에이전트가 동일 실수 반복하지 않음을 확인
