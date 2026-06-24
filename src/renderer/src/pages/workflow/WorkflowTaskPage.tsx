import { loggerService } from '@logger'
import type { WorkflowTask } from '@shared/workflowTask'
import { Empty, Spin } from 'antd'
import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router-dom'
import styled from 'styled-components'

import { setWorkflowTaskName } from './workflowTaskNames'

const logger = loggerService.withContext('WorkflowTaskPage')

/** Runs a single workflow task. Phase B renders the task + its fields; the
 * interactive form and gateway run are added in later phases. */
const WorkflowTaskPage: FC = () => {
  const { t } = useTranslation()
  const { id = '' } = useParams<{ id: string }>()
  const [task, setTask] = useState<WorkflowTask | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
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

  return (
    <Container>
      <Header>
        <Name>{task.name}</Name>
        {task.description && <Description>{task.description}</Description>}
      </Header>
      <FieldList>
        {task.fields.map((field) => (
          <FieldRow key={field.key}>
            <FieldLabel>
              {field.label}
              {field.required && <Required>*</Required>}
            </FieldLabel>
            <FieldType>{field.type}</FieldType>
          </FieldRow>
        ))}
      </FieldList>
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
  gap: 8px;
  max-width: 640px;
`

const FieldRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-radius: 8px;
  border: 0.5px solid var(--color-border);
  background-color: var(--color-background-soft);
`

const FieldLabel = styled.div`
  font-size: 13px;
  color: var(--color-text);
`

const Required = styled.span`
  color: var(--color-error);
  margin-left: 4px;
`

const FieldType = styled.div`
  font-size: 12px;
  color: var(--color-text-secondary);
`

export default WorkflowTaskPage
