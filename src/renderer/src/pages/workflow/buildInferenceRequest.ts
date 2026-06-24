import type { InferenceRequest } from '@shared/inference'
import type { WorkflowTask } from '@shared/workflowTask'

/**
 * Build the gateway request for a workflow-task run: fill the task's
 * promptTemplate ({{field_key}}) with the operator's field values and wrap it
 * as a single user message with the task's system prompt and inference config.
 */
export function buildInferenceRequest(task: WorkflowTask, values: Record<string, string>): InferenceRequest {
  const prompt = task.promptTemplate.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, key: string) => values[key] ?? '')
  const request: InferenceRequest = {
    model: task.model,
    type: 'workflow_task',
    workflowTaskId: task.workflowTaskId,
    messages: [{ role: 'user', content: [{ text: prompt }] }],
    inferenceConfig: task.inferenceConfig
  }
  if (task.systemPrompt) {
    request.system = [{ text: task.systemPrompt }]
  }
  return request
}
