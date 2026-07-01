import { loggerService } from '@logger'
import type { WorkflowTask, WorkflowTaskField } from '@shared/workflowTask'
import { Button, DatePicker, Empty, Input, Select, Spin } from 'antd'
import { Play } from 'lucide-react'
import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import { useParams } from 'react-router-dom'
import remarkGfm from 'remark-gfm'
import styled from 'styled-components'

import { buildInferenceRequest } from './buildInferenceRequest'
import { setWorkflowTaskName } from './workflowTaskNames'

const logger = loggerService.withContext('WorkflowTaskPage')

/** Runs a single workflow task: an interactive form built from the task's
 * fields, plus a Run that streams the gateway result into a markdown panel. */
const WorkflowTaskPage: FC = () => {
  const { t } = useTranslation()
  const { id = '' } = useParams<{ id: string }>()
  const [task, setTask] = useState<WorkflowTask | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [running, setRunning] = useState(false)
  const [output, setOutput] = useState('')
  const [runError, setRunError] = useState<string | null>(null)

  const setValue = (key: string, value: string) => setValues((prev) => ({ ...prev, [key]: value }))

  const onRun = async () => {
    if (!task) return
    const runId = crypto.randomUUID()
    setOutput('')
    setRunError(null)
    setRunning(true)
    const unsubscribe = window.api.workflowTasks.onRunChunk((chunk) => {
      if (chunk.runId === runId) setOutput((prev) => prev + chunk.text)
    })
    try {
      await window.api.workflowTasks.run(runId, buildInferenceRequest(task, values))
    } catch (e) {
      logger.error('Workflow run failed', e as Error)
      setRunError((e as Error).message)
    } finally {
      unsubscribe()
      setRunning(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setValues({})
    window.api.workflowTasks
      .get(id)
      .then((loaded) => {
        if (cancelled) return
        setWorkflowTaskName(loaded.workflowTaskId, loaded.name)
        setTask(loaded)
      })
      .catch((e: Error) => {
        logger.error('Failed to load workflow task', e)
        if (!cancelled) setError(e.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [id])

  if (loading) {
    return (
      <Centered>
        <Spin />
      </Centered>
    )
  }
  if (error || !task) {
    return (
      <Centered>
        <Empty description={error ?? t('workflow.task.not_found')} />
      </Centered>
    )
  }

  const renderControl = (field: WorkflowTaskField) => {
    const value = values[field.key] ?? ''
    switch (field.type) {
      case 'textarea':
        return (
          <Input.TextArea
            rows={4}
            value={value}
            placeholder={field.label}
            onChange={(e) => setValue(field.key, e.target.value)}
          />
        )
      case 'select':
        return (
          <Select
            style={{ width: '100%' }}
            value={value || undefined}
            placeholder={field.label}
            options={(field.options ?? []).map((o) => ({ label: o, value: o }))}
            onChange={(v) => setValue(field.key, v)}
          />
        )
      case 'datepicker':
        return (
          <DatePicker
            style={{ width: '100%' }}
            onChange={(_, dateString) =>
              setValue(field.key, Array.isArray(dateString) ? (dateString[0] ?? '') : dateString)
            }
          />
        )
      default:
        return (
          <Input value={value} placeholder={field.label} onChange={(e) => setValue(field.key, e.target.value)} />
        )
    }
  }

  const missingRequired = task.fields.filter((f) => f.required && !(values[f.key] ?? '').trim())

  return (
    <Container>
      <Header>
        <Name>{task.name}</Name>
        {task.description && <Description>{task.description}</Description>}
      </Header>
      <FieldList>
        {task.fields.map((field) => (
          <Field key={field.key}>
            <FieldLabel>
              {field.label}
              {field.required && <Required>*</Required>}
            </FieldLabel>
            {renderControl(field)}
          </Field>
        ))}
        <RunRow>
          <Button
            type="primary"
            icon={<Play size={14} />}
            loading={running}
            disabled={running || missingRequired.length > 0}
            onClick={onRun}>
            {running ? t('workflow.task.running') : t('workflow.task.run')}
          </Button>
        </RunRow>
      </FieldList>
      {(output || runError) && (
        <Result>
          <ResultTitle>{t('workflow.task.result')}</ResultTitle>
          {runError ? (
            <ResultError className="selectable">{runError}</ResultError>
          ) : (
            <Markdown className="selectable">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{output}</ReactMarkdown>
            </Markdown>
          )}
        </Result>
      )}
    </Container>
  )
}

const Centered = styled.div`
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
`

const Container = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  padding: 24px;
  overflow-y: auto;
  gap: 20px;
`

const Header = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`

const Name = styled.h1`
  font-size: 18px;
  font-weight: 600;
  color: var(--color-text);
  margin: 0;
`

const Description = styled.div`
  font-size: 13px;
  color: var(--color-text-secondary);
`

const FieldList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 640px;
`

const Field = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`

const FieldLabel = styled.label`
  font-size: 13px;
  color: var(--color-text);
`

const Required = styled.span`
  color: var(--color-error);
  margin-left: 4px;
`

const RunRow = styled.div`
  display: flex;
  margin-top: 4px;
`

const Result = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 720px;
`

const ResultTitle = styled.div`
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
`

const ResultError = styled.div`
  font-size: 13px;
  color: var(--color-error);
`

const Markdown = styled.div`
  font-size: 14px;
  color: var(--color-text);
  line-height: 1.6;
  padding: 14px 16px;
  border-radius: 8px;
  border: 0.5px solid var(--color-border);
  background-color: var(--color-background-soft);
  word-break: break-word;

  p:last-child {
    margin-bottom: 0;
  }
`

export default WorkflowTaskPage
