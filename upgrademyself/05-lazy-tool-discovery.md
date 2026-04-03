# 05. Lazy Tool Discovery

> Phase 1 | 예상 소요: 1~2주

---

## 문제 정의

현재 26개 툴이 세션 시작 시 전부 등록된다.

- `src/plugin/tool-registry.ts`: 모든 툴 스키마를 한번에 로드
- 툴 스키마 설명이 컨텍스트 윈도우의 상당 부분 차지
- 에이전트에게 불필요한 툴이 노출되어 혼란 유발 가능
- 예: 이미지 태스크가 없는데 `multimodal-looker` 툴이 항상 보임

---

## 설계

### 3계층 툴 구조

```
Layer 1: Core (항상 로드, 5개)
  ├── look-at           # 파일 읽기 (필수)
  ├── interactive-bash  # 셸 실행 (필수)
  ├── glob              # 파일 검색 (필수)
  ├── grep              # 내용 검색 (필수)
  └── discover-tools    # 툴 발견 (메타툴, 필수)

Layer 2: Standard (태스크 카테고리 기반, 자동 로드)
  ├── [code] edit, hashline-edit, lsp, ast-grep
  ├── [agent] delegate-task, call-omo-agent, background-task
  ├── [skill] skill, skill-mcp
  └── [git] git-snapshot (신규)

Layer 3: Extended (요청 시 동적 로드)
  ├── session-manager
  ├── slashcommand
  ├── task
  └── ... (나머지 툴들)
```

### `discover-tools` 메타툴

```typescript
// 에이전트가 필요한 툴을 찾을 때 사용
discoverTools({
  category?: 'edit' | 'search' | 'agent' | 'skill' | 'git' | 'session',
  query?: string,     // "파일을 수정하는 툴 찾기"
  load?: boolean,     // true면 즉시 로드 (기본 false: 목록만 반환)
})
```

반환 예시:
```json
{
  "available": [
    {
      "name": "hashline-edit",
      "category": "edit",
      "description": "해시 검증 기반 안전한 파일 편집",
      "loaded": false
    }
  ],
  "hint": "load: true 로 다시 호출하면 스키마가 로드됩니다."
}
```

---

## 구현 파일

### `src/features/lazy-tool-loader/tool-manifest.ts`

```typescript
// 툴의 전체 스키마 없이 메타데이터만 포함
type ToolManifest = {
  name: string;
  layer: 1 | 2 | 3;
  categories: ToolCategory[];
  description: string;          // 1줄 설명 (스키마 없음)
  schemaPath: string;           // 동적 import 경로
};

export const TOOL_MANIFEST: ToolManifest[] = [
  { name: 'look-at',       layer: 1, categories: ['search'], ... },
  { name: 'hashline-edit', layer: 2, categories: ['edit'],   ... },
  { name: 'lsp',           layer: 3, categories: ['edit'],   ... },
  // ...
];
```

### `src/features/lazy-tool-loader/tool-loader.ts`

```typescript
export function createToolLoader() {
  const loadedTools = new Map<string, Tool>();

  return {
    // 초기 로드: Layer 1만
    async loadCore(): Promise<Tool[]>,

    // 카테고리 기반 로드: Layer 1 + 관련 Layer 2
    async loadForCategory(category: TaskCategory): Promise<Tool[]>,

    // 동적 로드: 특정 툴 스키마 로드
    async loadTool(name: string): Promise<Tool>,

    // 현재 로드된 툴 목록
    getLoadedTools(): Tool[],
  };
}
```

### `src/features/lazy-tool-loader/tool-recommender.ts`

```typescript
// 첫 번째 메시지를 분석해 관련 Layer 2 툴 자동 로드
export function recommendToolsForMessage(
  message: string,
  manifest: ToolManifest[]
): ToolManifest[] {
  const keywords = {
    edit:    ['수정', 'fix', 'edit', 'change', 'update', 'refactor'],
    agent:   ['위임', 'delegate', 'parallel', 'background', 'spawn'],
    skill:   ['skill', '스킬', 'playwright', 'browser'],
    git:     ['commit', 'branch', 'stash', 'snapshot', 'undo'],
    session: ['session', '세션', 'resume', 'history'],
  };
  
  // 키워드 매칭 → 관련 카테고리 → Layer 2 툴 반환
}
```

---

## `src/plugin/tool-registry.ts` 변경

### Before (현재)
```typescript
// 모든 툴 즉시 등록
export function createToolRegistry(ctx) {
  return [
    createSkillTool(ctx),
    createDelegateTaskTool(ctx),
    createHashlineEditTool(ctx),
    createLspTool(ctx),
    // ... 26개 전부
  ];
}
```

### After (변경 후)
```typescript
export function createToolRegistry(ctx) {
  const loader = createToolLoader();
  
  // Layer 1만 즉시 로드
  const coreTools = await loader.loadCore();
  
  // 첫 번째 메시지에서 Layer 2 동적 로드 (chat.message 훅)
  // Layer 3는 discover-tools 툴로 요청 시 로드
  
  return coreTools;
}
```

---

## 컨텍스트 절약 효과 추정

| 상황 | 현재 | 변경 후 |
|------|------|---------|
| 세션 시작 시 툴 스키마 | 26개 전체 | 5개 (Layer 1) |
| 일반 코딩 태스크 | 26개 | 5 + 4 = 9개 |
| 에이전트 위임 태스크 | 26개 | 5 + 3 = 8개 |
| 예상 토큰 절약 | - | ~40~60% |

---

## 설정 스키마

```typescript
// src/config/schema/lazy-tool-loader.ts
export const LazyToolLoaderConfigSchema = z.object({
  enabled: z.boolean().default(true),
  preload_categories: z.array(ToolCategorySchema).default([]),  // 항상 미리 로드할 카테고리
  auto_recommend: z.boolean().default(true),  // 첫 메시지 분석 자동 추천
});
```

---

## 테스트 시나리오

1. 세션 시작 시 5개 Core 툴만 등록됨을 확인
2. "hashline-edit로 파일 수정해줘" 메시지 → edit 카테고리 툴 자동 로드
3. `discover-tools({ category: 'agent' })` → Layer 2 agent 툴 목록 반환
4. `discover-tools({ load: true })` → 툴 스키마 즉시 로드 확인
5. `disabled_tools` 설정과 lazy 로드 충돌 없음 확인
