# Comment-Checker TypeScript Port 구현 계획

## 1. 아키텍처 개요

### 1.1 핵심 도전 과제

**OpenCode Hook의 제약사항:**
- `tool.execute.before`: `output.args`에서 파일 경로/내용 접근 가능
- `tool.execute.after`: `tool_input`이 **제공되지 않음** (Claude Code와의 핵심 차이점)
- **해결책**: Before hook에서 데이터를 캡처하여 callID로 키잉된 Map에 저장, After hook에서 조회

### 1.2 디렉토리 구조

```
src/hooks/comment-checker/
├── index.ts              # Hook factory, 메인 엔트리포인트
├── types.ts              # 모든 타입 정의
├── constants.ts          # 언어 레지스트리, 쿼리 템플릿, 디렉티브 목록
├── detector.ts           # CommentDetector - web-tree-sitter 기반 코멘트 감지
├── filters/
│   ├── index.ts          # 필터 barrel export
│   ├── bdd.ts            # BDD 패턴 필터
│   ├── directive.ts      # 린터/타입체커 디렉티브 필터
│   ├── docstring.ts      # 독스트링 필터
│   └── shebang.ts        # Shebang 필터
├── output/
│   ├── index.ts          # 출력 barrel export
│   ├── formatter.ts      # FormatHookMessage
│   └── xml-builder.ts    # BuildCommentsXML
└── utils.ts              # 유틸리티 함수
```

### 1.3 데이터 흐름

```
[write/edit 도구 실행]
       │
       ▼
┌──────────────────────┐
│ tool.execute.before  │
│  - 파일 경로 캡처    │
│  - pendingCalls Map  │
│    에 저장           │
└──────────┬───────────┘
           │
           ▼
    [도구 실제 실행]
           │
           ▼
┌──────────────────────┐
│ tool.execute.after   │
│  - pendingCalls에서  │
│    데이터 조회       │
│  - 파일 읽기         │
│  - 코멘트 감지       │
│  - 필터 적용         │
│  - 메시지 주입       │
└──────────────────────┘
```

---

## 2. 구현 순서

### Phase 1: 기반 구조
1. `src/hooks/comment-checker/` 디렉토리 생성
2. `types.ts` - 모든 타입 정의
3. `constants.ts` - 언어 레지스트리, 디렉티브 패턴

### Phase 2: 필터 구현
4. `filters/bdd.ts` - BDD 패턴 필터
5. `filters/directive.ts` - 디렉티브 필터
6. `filters/docstring.ts` - 독스트링 필터
7. `filters/shebang.ts` - Shebang 필터
8. `filters/index.ts` - 필터 조합

### Phase 3: 코어 로직
9. `detector.ts` - web-tree-sitter 기반 코멘트 감지
10. `output/xml-builder.ts` - XML 출력
11. `output/formatter.ts` - 메시지 포매팅

### Phase 4: Hook 통합
12. `index.ts` - Hook factory 및 상태 관리
13. `src/hooks/index.ts` 업데이트 - export 추가

### Phase 5: 의존성 및 빌드
14. `package.json` 업데이트 - web-tree-sitter 추가
15. typecheck 및 build 검증

---

## 3. 핵심 구현 사항

### 3.1 언어 레지스트리 (38개 언어)

```typescript
const LANGUAGE_REGISTRY: Record<string, LanguageConfig> = {
  python: { extensions: [".py"], commentQuery: "(comment) @comment", docstringQuery: "..." },
  javascript: { extensions: [".js", ".jsx"], commentQuery: "(comment) @comment" },
  typescript: { extensions: [".ts"], commentQuery: "(comment) @comment" },
  tsx: { extensions: [".tsx"], commentQuery: "(comment) @comment" },
  go: { extensions: [".go"], commentQuery: "(comment) @comment" },
  rust: { extensions: [".rs"], commentQuery: "(line_comment) @comment (block_comment) @comment" },
  // ... 38개 전체
}
```

### 3.2 필터 로직

**BDD 필터**: `given, when, then, arrange, act, assert`
**Directive 필터**: `noqa, pyright:, eslint-disable, @ts-ignore` 등 30+
**Docstring 필터**: `IsDocstring || starts with /**`
**Shebang 필터**: `starts with #!`

### 3.3 출력 형식 (Go 버전과 100% 동일)

```
COMMENT/DOCSTRING DETECTED - IMMEDIATE ACTION REQUIRED

Your recent changes contain comments or docstrings, which triggered this hook.
You need to take immediate action. You must follow the conditions below.
(Listed in priority order - you must always act according to this priority order)

CRITICAL WARNING: This hook message MUST NEVER be ignored...

<comments file="/path/to/file.py">
	<comment line-number="10">// comment text</comment>
</comments>
```

---

## 4. 생성할 파일 목록

1. `src/hooks/comment-checker/types.ts`
2. `src/hooks/comment-checker/constants.ts`
3. `src/hooks/comment-checker/filters/bdd.ts`
4. `src/hooks/comment-checker/filters/directive.ts`
5. `src/hooks/comment-checker/filters/docstring.ts`
6. `src/hooks/comment-checker/filters/shebang.ts`
7. `src/hooks/comment-checker/filters/index.ts`
8. `src/hooks/comment-checker/output/xml-builder.ts`
9. `src/hooks/comment-checker/output/formatter.ts`
10. `src/hooks/comment-checker/output/index.ts`
11. `src/hooks/comment-checker/detector.ts`
12. `src/hooks/comment-checker/index.ts`

## 5. 수정할 파일 목록

1. `src/hooks/index.ts` - export 추가
2. `package.json` - web-tree-sitter 의존성

---

## 6. Definition of Done

- [ ] write/edit 도구 실행 시 코멘트 감지 동작
- [ ] 4개 필터 모두 정상 작동
- [ ] 최소 5개 언어 지원 (Python, JS, TS, TSX, Go)
- [ ] Go 버전과 동일한 출력 형식
- [ ] typecheck 통과
- [ ] build 성공
