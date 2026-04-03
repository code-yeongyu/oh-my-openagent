# 06. 벡터DB 기반 동적 컨텍스트

> Phase 3 | 예상 소요: 3~4주

---

## 문제 정의

현재 컨텍스트 주입은 정적이다.

- `context-injector`: AGENTS.md, README.md, rules 파일만 주입 (고정)
- 에이전트가 현재 태스크와 관련된 파일을 직접 grep으로 찾아야 함
- 대형 코드베이스에서 관련 코드를 찾는 데 많은 툴 호출 낭비
- 관련 코드가 자동으로 컨텍스트에 주입되면 에이전트 효율 대폭 향상

---

## 구현 전략

**두 단계 구현**:
1. **옵션 A (TF-IDF, 즉시)**: 외부 의존성 없음, 키워드 기반
2. **옵션 B (벡터 임베딩, 이후)**: SQLite-vec + 로컬 임베딩 모델

---

## 옵션 A: TF-IDF 기반 (Phase 3 초기)

### 설계

```
src/features/dynamic-context/
├── index.ts
├── file-indexer.ts          # 프로젝트 파일 인덱싱 (캐시)
├── keyword-extractor.ts     # 현재 메시지에서 키워드 추출
├── tfidf-scorer.ts          # TF-IDF 기반 파일 관련성 점수
├── snippet-extractor.ts     # 관련 파일에서 관련 스니펫 추출
└── context-builder.ts       # 스니펫 → 주입 포맷 변환
```

### 파일 인덱스 구조

```typescript
type FileIndex = {
  path: string;
  lastModified: number;
  terms: Map<string, number>;  // 단어 → 빈도수
  lineCount: number;
};

// 저장: .opencode/index/tfidf-cache.json
```

### 동작 흐름

```
1. 프로젝트 시작 시 (또는 파일 변경 시)
   → file-indexer가 .ts/.tsx/.py 등 코드 파일 인덱싱
   → TF-IDF 캐시 생성 (.opencode/index/tfidf-cache.json)

2. 첫 메시지 수신 시 (chat.message 훅)
   → keyword-extractor로 메시지에서 핵심 단어 추출
   → tfidf-scorer로 관련 파일 상위 5개 선별
   → snippet-extractor로 관련 코드 스니펫 추출 (파일당 최대 50줄)
   → context-builder로 포맷팅 후 시스템 메시지에 주입

3. 태스크 중간 (tool.execute.after)
   → 새로 언급된 파일/함수명 추출 → 실시간 관련 파일 보완
```

### 주입 포맷

```
[동적 컨텍스트 - 현재 태스크 관련 코드]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📄 src/features/background-agent/manager.ts (관련성: 94%)
   lines 45-67:
   export function createBackgroundAgentManager() {
     return {
       async spawn(task: AgentTask): Promise<void> {
         // ...
       }
     };
   }

📄 src/tools/delegate-task/index.ts (관련성: 87%)
   lines 12-30:
   // ...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
주입된 파일: 2개 | 총 토큰: ~800
```

---

## 옵션 B: 벡터 임베딩 기반 (Phase 3 후기)

### 의존성

```json
{
  "dependencies": {
    "better-sqlite3": "^9.x",        // SQLite 드라이버
    "sqlite-vec": "^0.x"              // 벡터 확장
  }
}
```

**임베딩 모델 옵션** (로컬, 외부 API 없음):
- `nomic-embed-text` via Ollama (권장, 무료)
- `text-embedding-3-small` via OpenAI API (선택)
- `jina-embeddings-v3` via 로컬 ONNX (오프라인)

### 벡터 스토어 구조

```typescript
// src/features/vector-context/vector-store.ts
export function createVectorStore(dbPath: string) {
  return {
    async upsert(chunk: CodeChunk): Promise<void>,
    async search(query: string, topK: number): Promise<ScoredChunk[]>,
    async deleteByPath(filePath: string): Promise<void>,
    async getStats(): Promise<{ chunkCount: number; fileCount: number }>,
  };
}
```

### 코드 청킹 전략

```typescript
type CodeChunk = {
  id: string;
  filePath: string;
  startLine: number;
  endLine: number;
  content: string;           // 청크 원문
  chunkType: 'function' | 'class' | 'module' | 'block';
  embedding: number[];       // 벡터 (768차원)
};

// 청킹 전략:
// - 함수/클래스 단위로 청킹 (AST 기반)
// - 최대 200줄, 최소 5줄
// - 50줄 오버랩으로 컨텍스트 연속성 유지
```

### 인덱싱 파이프라인

```
프로젝트 파일 변경 감지 (file watcher)
  → 변경된 파일 파싱 (AST 기반 청킹)
  → 임베딩 생성 (배치, 32개씩)
  → SQLite-vec에 upsert
  → 변경 완료
```

---

## 설정 스키마

```typescript
// src/config/schema/dynamic-context.ts
export const DynamicContextConfigSchema = z.object({
  enabled: z.boolean().default(false),  // 기본 off (opt-in)
  engine: z.enum(['tfidf', 'vector']).default('tfidf'),
  max_inject_files: z.number().min(1).max(10).default(3),
  max_snippet_lines: z.number().min(10).max(200).default(50),
  min_relevance_score: z.number().min(0).max(1).default(0.5),
  
  // 벡터 엔진 설정 (engine: 'vector' 시)
  vector: z.object({
    embedding_provider: z.enum(['ollama', 'openai', 'onnx']).default('ollama'),
    embedding_model: z.string().default('nomic-embed-text'),
    db_path: z.string().default('.opencode/vector-index.db'),
    chunk_size_lines: z.number().default(100),
    chunk_overlap_lines: z.number().default(20),
  }).optional(),
  
  // 제외 패턴
  exclude_patterns: z.array(z.string()).default([
    'node_modules/**',
    'dist/**',
    '**/*.lock',
    '**/*.json',
  ]),
});
```

---

## Phase 3 구현 순서

1. **옵션 A (TF-IDF)** 구현 및 검증 (2주)
   - file-indexer, tfidf-scorer, snippet-extractor 구현
   - chat.message 훅에 연동
   - 효과 측정 (에이전트의 grep 호출 횟수 비교)

2. **옵션 B (벡터)** 구현 (2주)
   - SQLite-vec 연동
   - Ollama 임베딩 연동
   - AST 기반 청킹 (ast-grep 재활용)
   - 점진적 인덱싱 (파일 변경 감지)

3. **마이그레이션** (1주)
   - `engine: 'tfidf'` → `engine: 'vector'` 설정 전환
   - TF-IDF 인덱스 → 벡터 DB 마이그레이션 스크립트

---

## 테스트 시나리오

**옵션 A:**
1. "background-agent 수정해줘" 메시지 → manager.ts, loop-detector.ts 자동 주입 확인
2. 관련성 낮은 파일은 주입되지 않음 확인
3. max_inject_files=3 설정으로 최대 3개만 주입 확인

**옵션 B:**
1. 새 파일 생성 시 자동 인덱싱 확인
2. 자연어 쿼리로 관련 함수 청크 검색 확인
3. 오프라인 상태에서 ONNX 임베딩 동작 확인
4. 대형 코드베이스 (1만 파일) 에서 검색 속도 < 100ms 확인
