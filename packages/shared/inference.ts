// Mirrors the MPF server's streaming inference contract (the inference-gateway
// Lambda Function URL). The desktop app POSTs an InferenceRequest with a Bearer
// idToken and reads an NDJSON stream of {type:"delta"|"done"|"error"} lines.

export interface InferenceMessage {
  role: 'user' | 'assistant'
  content: { text: string }[]
}

export interface InferenceSystemBlock {
  text: string
}

export interface InferenceConfig {
  maxTokens?: number
  temperature?: number
  topP?: number
}

export interface InferenceRequest {
  model: string
  type: 'workflow_task' | 'general'
  workflowTaskId?: string
  skillId?: string
  messages: InferenceMessage[]
  system?: InferenceSystemBlock[]
  inferenceConfig?: InferenceConfig
}

/** A parsed line from the inference stream. */
export type InferenceStreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'done'; usage?: { inputTokens: number; outputTokens: number } }
  | { type: 'error'; message: string }

/** Payload pushed to the renderer for each streamed delta of a run. */
export interface WorkflowRunChunk {
  runId: string
  text: string
}
