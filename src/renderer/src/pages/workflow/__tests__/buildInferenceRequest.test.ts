import type { WorkflowTask } from '@shared/workflowTask'
import { describe, expect, it } from 'vitest'

import { buildInferenceRequest } from '../buildInferenceRequest'

const task: WorkflowTask = {
  workflowTaskId: 'wf_1',
  name: 'Estimation',
  description: '',
  version: 1,
  owner: 'creator@x.com',
  fields: [{ key: 'amount', type: 'text', label: 'Amount', required: true }],
  promptTemplate: 'Estimate {{amount}} please',
  systemPrompt: 'You are an estimator.',
  model: 'claude-sonnet',
  inferenceConfig: { maxTokens: 1000 },
  allowedSkills: [],
  allowedTools: [],
  allowedMcpServers: [],
  createdAt: 't',
  updatedAt: 't'
}

describe('buildInferenceRequest', () => {
  it('fills the prompt template and wraps it as a workflow_task user message', () => {
    const req = buildInferenceRequest(task, { amount: '500' })
    expect(req.type).toBe('workflow_task')
    expect(req.workflowTaskId).toBe('wf_1')
    expect(req.model).toBe('claude-sonnet')
    expect(req.messages[0].content[0].text).toBe('Estimate 500 please')
    expect(req.system).toEqual([{ text: 'You are an estimator.' }])
    expect(req.inferenceConfig).toEqual({ maxTokens: 1000 })
  })

  it('replaces unknown placeholders with empty and omits a blank system prompt', () => {
    const req = buildInferenceRequest({ ...task, systemPrompt: '' }, {})
    expect(req.messages[0].content[0].text).toBe('Estimate  please')
    expect(req.system).toBeUndefined()
  })
})
