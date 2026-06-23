import { z } from "zod"

const ChatRoleSchema = z.enum(["system", "user", "assistant", "tool", "function"])

const ChatMessageToolCallSchema = z.object({
  id: z.string().min(1),
  type: z.literal("function"),
  function: z.object({
    name: z.string().min(1),
    arguments: z.string(),
  }),
})

const ImageUrlSchema = z.union([
  z.string(),
  z.object({ url: z.string(), detail: z.string().optional() }).passthrough(),
])

const ContentPartTextSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
})

const ContentPartImageSchema = z.object({
  type: z.literal("image_url"),
  image_url: ImageUrlSchema,
})

const ContentPartSchema = z
  .union([ContentPartTextSchema, ContentPartImageSchema])
  .or(z.object({ type: z.string() }).passthrough())

const ChatMessageSchema = z
  .object({
    role: ChatRoleSchema,
    content: z.union([z.string(), z.null(), z.array(ContentPartSchema)]).optional(),
    name: z.string().optional(),
    tool_call_id: z.string().optional(),
    tool_calls: z.array(ChatMessageToolCallSchema).optional(),
  })
  .passthrough()

export type ChatContentPart = z.infer<typeof ContentPartSchema>
export type ChatContentPartText = z.infer<typeof ContentPartTextSchema>
export type ChatContentPartImage = z.infer<typeof ContentPartImageSchema>

export type ChatMessageToolCall = z.infer<typeof ChatMessageToolCallSchema>

const StopSchema = z.union([z.string(), z.array(z.string()).max(4)])

const ToolFunctionSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  parameters: z.record(z.string(), z.unknown()).optional(),
})

const ToolDefinitionSchema = z.object({
  type: z.literal("function"),
  function: ToolFunctionSchema,
})

const ToolChoiceObjectSchema = z.object({
  type: z.literal("function"),
  function: z.object({ name: z.string().min(1) }),
})

const ToolChoiceSchema = z.union([
  z.literal("auto"),
  z.literal("none"),
  z.literal("required"),
  ToolChoiceObjectSchema,
])

export const ChatCompletionRequestSchema = z
  .object({
    model: z.string().min(1, "model is required"),
    messages: z.array(ChatMessageSchema).min(1, "messages must contain at least one entry"),
    temperature: z.number().min(0).max(2).optional(),
    top_p: z.number().min(0).max(1).optional(),
    n: z.number().int().min(1).max(10).optional(),
    stream: z.boolean().optional(),
    stop: StopSchema.optional(),
    max_tokens: z.number().int().positive().optional(),
    presence_penalty: z.number().min(-2).max(2).optional(),
    frequency_penalty: z.number().min(-2).max(2).optional(),
    logit_bias: z.record(z.string(), z.number()).optional(),
    user: z.string().optional(),
    seed: z.number().int().optional(),
    response_format: z.object({ type: z.string() }).passthrough().optional(),
    tools: z.array(ToolDefinitionSchema).optional(),
    tool_choice: ToolChoiceSchema.optional(),
    parallel_tool_calls: z.boolean().optional(),
  })
  .passthrough()

export type ChatCompletionRequest = z.infer<typeof ChatCompletionRequestSchema>
export type ToolDefinition = z.infer<typeof ToolDefinitionSchema>
export type ToolChoice = z.infer<typeof ToolChoiceSchema>

export const ChatCompletionUsageSchema = z.object({
  prompt_tokens: z.number().int().nonnegative(),
  completion_tokens: z.number().int().nonnegative(),
  total_tokens: z.number().int().nonnegative(),
})

const ToolCallResponseSchema = z.object({
  id: z.string(),
  type: z.literal("function"),
  function: z.object({
    name: z.string(),
    arguments: z.string(),
  }),
})

const ChatCompletionChoiceSchema = z.object({
  index: z.number().int().nonnegative(),
  message: z.object({
    role: ChatRoleSchema,
    content: z.union([z.string(), z.null()]),
    reasoning_content: z.string().optional(),
    tool_calls: z.array(ToolCallResponseSchema).optional(),
  }),
  finish_reason: z.union([
    z.literal("stop"),
    z.literal("length"),
    z.literal("content_filter"),
    z.literal("tool_calls"),
    z.literal("function_call"),
    z.null(),
  ]),
})

export const ChatCompletionResponseSchema = z.object({
  id: z.string(),
  object: z.literal("chat.completion"),
  created: z.number().int().nonnegative(),
  model: z.string(),
  choices: z.array(ChatCompletionChoiceSchema).min(1),
  usage: ChatCompletionUsageSchema.optional(),
})

export type ChatCompletionResponse = z.infer<typeof ChatCompletionResponseSchema>
export type ToolCallResponse = z.infer<typeof ToolCallResponseSchema>

const ChatCompletionChunkChoiceSchema = z.object({
  index: z.number().int().nonnegative(),
  delta: z
    .object({
      role: ChatRoleSchema.optional(),
      content: z.string().optional(),
      reasoning_content: z.string().optional(),
    })
    .passthrough(),
  finish_reason: z.union([
    z.literal("stop"),
    z.literal("length"),
    z.literal("content_filter"),
    z.literal("tool_calls"),
    z.literal("function_call"),
    z.null(),
  ]),
})

export const ChatCompletionChunkSchema = z.object({
  id: z.string(),
  object: z.literal("chat.completion.chunk"),
  created: z.number().int().nonnegative(),
  model: z.string(),
  choices: z.array(ChatCompletionChunkChoiceSchema).min(1),
})

export type ChatCompletionChunk = z.infer<typeof ChatCompletionChunkSchema>

const ModelEntrySchema = z.object({
  id: z.string(),
  object: z.literal("model"),
  created: z.number().int().nonnegative(),
  owned_by: z.string(),
})

export const ModelsResponseSchema = z.object({
  object: z.literal("list"),
  data: z.array(ModelEntrySchema),
})

export type ModelsResponse = z.infer<typeof ModelsResponseSchema>
