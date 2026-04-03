# 03. Git 스냅샷 Undo

> Phase 1 | 예상 소요: 1주

---

## 문제 정의

에이전트가 파일을 잘못 수정하면 되돌리기 어렵다.

- `git-worktree`: 병렬 격리에만 사용, 단계별 undo 없음
- `hashline-edit`: 편집 전 검증은 하지만 실행 후 롤백 없음
- 멀티파일 동시 수정 시 사고가 나면 복구 방법이 없음

---

## 설계

### 스냅샷 방식

**방식 A: git stash (권장)**
```bash
# 스냅샷 생성
git stash push --include-untracked -m "omo-snapshot:{id}:{description}"

# 복원
git stash pop stash@{N}
```

장점: git 내장, 브랜치 독립적, 쉬운 조회
단점: stash는 스택이라 순서 관리 필요

**방식 B: 임시 커밋**
```bash
# 스냅샷 생성
git add -A && git commit --no-verify -m "omo-snapshot:{id}:{description}"

# 복원
git reset --hard {commit-sha}
```

장점: 영구 이력, diff 비교 용이
단점: git log 오염, --no-verify 필요

→ **방식 A (git stash) 채택**, 스냅샷 메타데이터를 별도 파일로 관리

### 스냅샷 메타데이터

```
.opencode/snapshots/
└── registry.json
```

```typescript
type SnapshotRegistry = {
  snapshots: SnapshotEntry[];
};

type SnapshotEntry = {
  id: string;              // nanoid(8)
  sessionId: string;       // 생성 세션
  stashIndex: number;      // git stash list의 인덱스
  timestamp: string;       // ISO8601
  description: string;     // 자동 생성 설명
  trigger: 'auto' | 'manual';  // 생성 트리거
  filesChanged: string[];  // 변경된 파일 목록
};
```

---

## 구현 파일

### `src/features/git-snapshot/snapshot-manager.ts`

```typescript
export function createSnapshotManager(sessionId: string) {
  return {
    async create(description: string, trigger: 'auto' | 'manual'): Promise<SnapshotEntry>,
    async list(): Promise<SnapshotEntry[]>,
    async restore(id: string): Promise<void>,
    async diff(id: string): Promise<string>,   // 스냅샷 vs 현재 diff
    async cleanup(maxAge: number): Promise<void>,  // 오래된 스냅샷 정리
  };
}
```

### `src/tools/git-snapshot/index.ts`

```typescript
// 에이전트가 직접 사용할 수 있는 툴 3종
export const gitSnapshotTools = [
  createSnapshotTool,      // 수동 스냅샷 생성
  listSnapshotsTool,       // 스냅샷 목록 조회
  restoreSnapshotTool,     // 스냅샷 복원
];
```

### 자동 스냅샷 훅 (`src/hooks/auto-snapshot/index.ts`)

```typescript
// tool.execute.before 훅
// Write, Edit, MultiEdit, hashline-edit 툴 실행 전 자동 스냅샷
export function createAutoSnapshotHook(config: GitSnapshotConfig) {
  return {
    event: 'tool.execute.before',
    tools: ['Write', 'Edit', 'MultiEdit', 'hashline-edit'],
    handler: async (ctx) => {
      const changedFiles = estimateChangedFiles(ctx.toolInput);
      
      // 3개 이상 파일 동시 수정 시 반드시 스냅샷
      if (changedFiles.length >= config.auto_snapshot_threshold) {
        await snapshotManager.create(
          `before: ${ctx.toolName} on ${changedFiles.join(', ')}`,
          'auto'
        );
      }
    }
  };
}
```

---

## 슬래시 커맨드

```typescript
// src/features/builtin-commands/
'/snapshot'          → 현재 상태 수동 스냅샷 생성
'/snapshots'         → 세션 내 스냅샷 목록
'/undo'              → 마지막 스냅샷으로 복원
'/restore {id}'      → 특정 스냅샷 복원
```

---

## 설정 스키마

```typescript
// src/config/schema/git-snapshot.ts
export const GitSnapshotConfigSchema = z.object({
  enabled: z.boolean().default(true),
  auto_snapshot: z.boolean().default(true),
  auto_snapshot_threshold: z.number().default(3),  // N개 이상 파일 수정 시 자동
  max_snapshots_per_session: z.number().default(20),
  cleanup_after_days: z.number().default(7),
});
```

---

## 기존 코드 재활용

- `src/shared/git-worktree/parse-status-porcelain.ts` → 변경 파일 목록 파싱
- `src/shared/git-worktree/collect-git-diff-stats.ts` → diff 통계

---

## 테스트 시나리오

1. Write 툴로 5개 파일 동시 수정 → 자동 스냅샷 생성 확인
2. `/undo` 명령으로 스냅샷 복원 → 원본 파일 상태 복구 확인
3. `/snapshots` → 세션 내 스냅샷 목록 및 타임스탬프 확인
4. 세션 종료 후 스냅샷 registry 파일 보존 확인
5. 7일 후 오래된 스냅샷 자동 정리 확인
