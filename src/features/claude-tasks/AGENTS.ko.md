# src/features/claude-tasks/ — 태스크 스키마 + 저장소

**생성일:** 2026-04-11

## 개요

테스트를 제외한 4개 파일 (약 622 LOC). 원자적 쓰기, 락, OpenCode todo API 동기화를 갖춘 파일 기반 태스크 영속화.

## 태스크 스키마

```typescript
interface Task {
  id: string              // T-{uuid} 자동 생성
  subject: string         // 짧은 제목
  description?: string    // 상세 설명
  status: "pending" | "in_progress" | "completed" | "deleted"
  activeForm?: string     // 현재 폼/템플릿
  blocks?: string[]       // 이 태스크가 블록하는 태스크들
  blockedBy?: string[]    // 이 태스크를 블록하는 태스크들
  owner?: string          // 에이전트/세션
  metadata?: Record<string, unknown>
  repoURL?: string        // 연관 리포지토리
  parentID?: string       // 부모 태스크 ID
  threadID?: string       // 세션 ID (자동 기록)
}
```

## 파일

| 파일 | 목적 |
|------|---------|
| `types.ts` | Task 인터페이스 + status 타입 |
| `storage.ts` | `readJsonSafe()`, `writeJsonAtomic()`, `acquireLock()`, `generateTaskId()` |
| `session-storage.ts` | 세션별 태스크 저장소, threadID 자동 기록 |
| `index.ts` | Barrel exports |

## 저장소

- 위치: `.sisyphus/tasks/` 디렉토리
- 형식: 태스크당 하나의 JSON 파일
- 원자적 쓰기: 임시 파일 → rename
- 락: 동시 접근을 위한 파일 기반 락
- 동기화: 각 업데이트 후 OpenCode Todo API 로 변경사항 푸시
