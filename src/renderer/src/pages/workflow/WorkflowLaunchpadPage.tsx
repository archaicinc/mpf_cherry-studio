import { loggerService } from '@logger'
import type { WorkflowTask } from '@shared/workflowTask'
import { Button, Empty, Spin } from 'antd'
import { Plus, Workflow } from 'lucide-react'
import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import styled from 'styled-components'

import { setWorkflowTaskName } from './workflowTaskNames'

const logger = loggerService.withContext('WorkflowLaunchpadPage')

/** Full-page picker of the operator's assigned workflow tasks (admins see all). */
const WorkflowLaunchpadPage: FC = () => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [tasks, setTasks] = useState<WorkflowTask[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)

  useEffect(() => {
    window.api.operatorAuth.isAdmin().then(setIsAdmin).catch(() => setIsAdmin(false))
  }, [])

  useEffect(() => {
    let cancelled = false
    window.api.workflowTasks
      .list()
      .then((items) => {
        if (cancelled) return
        items.forEach((task) => setWorkflowTaskName(task.workflowTaskId, task.name))
        setTasks(items)
      })
      .catch((e: Error) => {
        logger.error('Failed to load workflow tasks', e)
        if (!cancelled) setError(e.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <Container>
      <Header>
        <Title>{t('workflow.launchpad.title')}</Title>
        {isAdmin && (
          <Button type="primary" icon={<Plus size={14} />} onClick={() => navigate('/workflow-builder')}>
            {t('workflow.launchpad.create')}
          </Button>
        )}
      </Header>
      {loading ? (
        <Centered>
          <Spin />
        </Centered>
      ) : error ? (
        <Centered>
          <Empty description={error} />
        </Centered>
      ) : tasks.length === 0 ? (
        <Centered>
          <Empty description={t('workflow.launchpad.empty')} />
        </Centered>
      ) : (
        <Grid>
          {tasks.map((task) => (
            <Card key={task.workflowTaskId} onClick={() => navigate(`/workflow-task/${task.workflowTaskId}`)}>
              <CardIcon>
                <Workflow size={24} />
              </CardIcon>
              <CardName>{task.name}</CardName>
              {task.description && <CardDesc>{task.description}</CardDesc>}
            </Card>
          ))}
        </Grid>
      )}
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  padding: 24px;
  overflow-y: auto;
`

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
`

const Title = styled.h1`
  font-size: 18px;
  font-weight: 600;
  color: var(--color-text);
  margin: 0;
`

const Centered = styled.div`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
`

const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 16px;
`

const Card = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px;
  border-radius: 12px;
  border: 0.5px solid var(--color-border);
  background-color: var(--color-background-soft);
  cursor: pointer;
  transition: border-color 0.2s;

  &:hover {
    border-color: var(--color-primary);
  }
`

const CardIcon = styled.div`
  color: var(--color-primary);
`

const CardName = styled.div`
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text);
`

const CardDesc = styled.div`
  font-size: 12px;
  color: var(--color-text-secondary);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
`

export default WorkflowLaunchpadPage
