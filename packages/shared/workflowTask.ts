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
