export const HOOK_NAME = "observation-write-guard"

export const PROTECTED_PATH = "continuous-learning/references/observations/"

export const BLOCKED_MESSAGE = `[observation-write-guard] 禁止覆盖观察记录文件。

请使用 Edit 工具追加内容，而非 Write 覆盖。
观察记录是累积的，覆盖会丢失历史数据。`
