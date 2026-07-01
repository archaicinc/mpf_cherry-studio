// Mirrors the MPF server's WorkflowTask contract (GET /me/workflow-tasks).
// Kept in @shared so both the main process (fetch) and renderer (UI) share it.

export type WorkflowTaskFieldType = 'text' | 'textarea' | 'datepicker' | 'select'

export interface WorkflowTaskField {
  key: string
  type: WorkflowTaskFieldType
  label: string
  required: boolean
  /** Choices for a `select` field; ignored for other types. */
  options?: string[]
}

/** A callable Bedrock model offered in the builder's picker (from GET /models). */
export interface ModelOption {
  /** Bedrock inference-profile id stored on the task and sent to the gateway. */
  profileId: string
  label: string
  provider: string
}

export interface WorkflowTaskInferenceConfig {
  maxTokens?: number
  temperature?: number
  topP?: number
}

export interface WorkflowTask {
  workflowTaskId: string
  name: string
  description: string
  version: number
  /** Email of the admin who created the task; only the creator may edit it. */
  owner: string
  fields: WorkflowTaskField[]
  promptTemplate: string
  systemPrompt: string
  model: string
  inferenceConfig: WorkflowTaskInferenceConfig
  allowedSkills: string[]
  allowedTools: string[]
  allowedMcpServers: string[]
  createdAt: string
  updatedAt: string
}
