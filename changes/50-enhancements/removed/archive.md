# Removed Enhancements Archive

These items were removed from the 50-enhancements plan because they are either already implemented or consolidated.

## Already Implemented

### A3: 依赖图感知波次执行
- **Status**: Implemented
- **Location**: `src/shared/wave-grouper.ts`
- **Details**: Full Wave grouping algorithm with DAG and conflict detection exists.

### G6: 风险分级 TDD 执行
- **Status**: Implemented
- **Location**: `src/hooks/tdd-guard/risk-validator.ts`
- **Details**: Risk Tier 0-3 logic is fully implemented.

### M1: 本地 Stdio MCP 支持
- **Status**: Implemented
- **Details**: OpenCode supports `stdio` transport natively via Claude Code compatibility layer.

### D3: 循环检测
- **Status**: Implemented
- **Location**: `src/hooks/failure-counter/index.ts`
- **Details**: Failure counter hook handles escalation (1->Skill, 2->Oracle, 3->Block).

## Consolidated / Scope Changed

### M4: Skill MCP 懒加载
- **Status**: Existing Feature
- **Details**: `skill-mcp-manager` already handles on-demand creation and idle cleanup for Skill-embedded MCPs.
- **Note**: The surviving M4 task strictly focuses on adding lazy loading to *Built-in* MCPs.

### D5: /skill-create 命令
- **Status**: Merged
- **Target**: Merged into **S3**, using `keyword-detector` to trigger `skill-studio`.

### S1: (Partial) Non-Pattern Skills
- **Status**: Standardized
- **Details**: Core skills (TDD, Plans) are already standardized. S1 scope is narrowed to `backend-pattern-*` skills only.
