import { loggerService } from '@logger'
import type { InferenceRequest } from '@shared/inference'
import type { WorkflowTask, WorkflowTaskField, WorkflowTaskFieldType } from '@shared/workflowTask'
import { Button, DatePicker, Input, InputNumber, Select, Spin, Switch } from 'antd'
import { Play, Plus, Trash2, Upload } from 'lucide-react'
import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import { useNavigate, useParams } from 'react-router-dom'
import remarkGfm from 'remark-gfm'
import styled from 'styled-components'

const logger = loggerService.withContext('WorkflowBuilderPage')

const MODEL_OPTIONS = ['claude-sonnet', 'claude-haiku']
const FIELD_TYPES: WorkflowTaskFieldType[] = ['text', 'textarea', 'datepicker', 'select']

// While editing, `select` options are kept as the raw comma-separated text the
// admin types (so commas type naturally); they're parsed to an array on upload.
interface BuilderField {
  key: string
  label: string
  type: WorkflowTaskFieldType
  required: boolean
  optionsText: string
}

/** Admin-only builder: define a workflow task, test it against the gateway, and
 * upload it to the server. */
const WorkflowBuilderPage: FC = () => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  // When an id is present the page edits an existing task (creator-only); otherwise it creates one.
  const { id } = useParams<{ id: string }>()
  const editing = Boolean(id)

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [fields, setFields] = useState<BuilderField[]>([])
  const [systemPrompt, setSystemPrompt] = useState('')
  const [promptTemplate, setPromptTemplate] = useState('')
  const [model, setModel] = useState('claude-sonnet')
  const [maxTokens, setMaxTokens] = useState<number>(4096)
  const [temperature, setTemperature] = useState<number>(0.7)
  const [topP, setTopP] = useState<number>(0.9)
  const [sampleValues, setSampleValues] = useState<Record<string, string>>({})

  const [output, setOutput] = useState('')
  const [running, setRunning] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(editing)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    let cancelled = false
    window.api.workflowTasks
      .get(id)
      .then((task) => {
        if (cancelled) return
        setName(task.name)
        setDescription(task.description)
        setFields(
          task.fields.map((f) => ({
            key: f.key,
            label: f.label,
            type: f.type,
            required: f.required,
            optionsText: (f.options ?? []).join(', ')
          }))
        )
        setSystemPrompt(task.systemPrompt ?? '')
        setPromptTemplate(task.promptTemplate ?? '')
        setModel(task.model ?? 'claude-sonnet')
        setMaxTokens(task.inferenceConfig?.maxTokens ?? 4096)
        setTemperature(task.inferenceConfig?.temperature ?? 0.7)
        setTopP(task.inferenceConfig?.topP ?? 0.9)
      })
      .catch((e: Error) => {
        logger.error('Failed to load workflow task for editing', e)
        if (!cancelled) setLoadError(e.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [id])

  const addField = () =>
    setFields((prev) => [...prev, { key: '', label: '', type: 'text', required: false, optionsText: '' }])

  const updateField = (index: number, patch: Partial<BuilderField>) =>
    setFields((prev) => prev.map((f, i) => (i === index ? { ...f, ...patch } : f)))

  const removeField = (index: number) => setFields((prev) => prev.filter((_, i) => i !== index))

  const inferenceConfig = { maxTokens, temperature, topP }

  const toTaskField = (f: BuilderField): WorkflowTaskField => ({
    key: f.key.trim(),
    label: f.label.trim(),
    type: f.type,
    required: f.required,
    ...(f.type === 'select'
      ? { options: f.optionsText.split(',').map((o) => o.trim()).filter(Boolean) }
      : {})
  })

  const buildTaskBody = (): Partial<WorkflowTask> => ({
    name: name.trim(),
    description: description.trim(),
    fields: fields.map(toTaskField),
    promptTemplate,
    systemPrompt,
    model,
    inferenceConfig
  })

  const onRun = async () => {
    const runId = crypto.randomUUID()
    setOutput('')
    setRunError(null)
    setRunning(true)
    const filled = promptTemplate.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, key: string) => sampleValues[key] ?? '')
    const request: InferenceRequest = {
      model,
      type: 'general',
      messages: [{ role: 'user', content: [{ text: filled }] }],
      inferenceConfig
    }
    if (systemPrompt.trim()) request.system = [{ text: systemPrompt }]
    const unsubscribe = window.api.workflowTasks.onRunChunk((chunk) => {
      if (chunk.runId === runId) setOutput((prev) => prev + chunk.text)
    })
    try {
      await window.api.workflowTasks.run(runId, request)
    } catch (e) {
      logger.error('Builder test run failed', e as Error)
      setRunError((e as Error).message)
    } finally {
      unsubscribe()
      setRunning(false)
    }
  }

  const onUpload = async () => {
    setUploadError(null)
    setUploading(true)
    try {
      if (editing && id) {
        await window.api.workflowTasks.update(id, buildTaskBody())
        window.toast.success(t('workflow.builder.saved'))
      } else {
        await window.api.workflowTasks.create(buildTaskBody())
        window.toast.success(t('workflow.builder.uploaded'))
      }
      navigate('/workflow-launchpad')
    } catch (e) {
      logger.error('Workflow upload failed', e as Error)
      setUploadError((e as Error).message)
    } finally {
      setUploading(false)
    }
  }

  const canUpload = name.trim().length > 0 && fields.every((f) => f.key.trim() && f.label.trim())

  const setSample = (key: string, value: string) => setSampleValues((prev) => ({ ...prev, [key]: value }))

  // Test-value input matches the field's type, like the real run page.
  const renderTestControl = (field: BuilderField) => {
    const value = sampleValues[field.key] ?? ''
    switch (field.type) {
      case 'textarea':
        return (
          <Input.TextArea rows={3} value={value} placeholder={field.key} onChange={(e) => setSample(field.key, e.target.value)} />
        )
      case 'select': {
        const opts = field.optionsText.split(',').map((o) => o.trim()).filter(Boolean)
        return (
          <Select
            style={{ width: '100%' }}
            value={value || undefined}
            placeholder={field.key}
            options={opts.map((o) => ({ label: o, value: o }))}
            onChange={(v) => setSample(field.key, v)}
          />
        )
      }
      case 'datepicker':
        return (
          <DatePicker
            style={{ width: '100%' }}
            onChange={(_, dateString) =>
              setSample(field.key, Array.isArray(dateString) ? (dateString[0] ?? '') : dateString)
            }
          />
        )
      default:
        return <Input value={value} placeholder={field.key} onChange={(e) => setSample(field.key, e.target.value)} />
    }
  }

  if (loading) {
    return (
      <Container>
        <Spin />
      </Container>
    )
  }

  if (loadError) {
    return (
      <Container>
        <ErrorText>{loadError}</ErrorText>
      </Container>
    )
  }

  return (
    <Container>
      <Title>{editing ? t('workflow.builder.edit_title') : t('workflow.builder.title')}</Title>

      <Section>
        <Label>{t('workflow.builder.name')}</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('workflow.builder.name')} />
        <Label>{t('workflow.builder.description')}</Label>
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t('workflow.builder.description')}
        />
      </Section>

      <Section>
        <SectionHeader>
          <Label>{t('workflow.builder.fields')}</Label>
          <Button size="small" icon={<Plus size={14} />} onClick={addField}>
            {t('workflow.builder.add_field')}
          </Button>
        </SectionHeader>
        {fields.map((field, index) => (
          <FieldRow key={index}>
            <Input
              style={{ width: 140 }}
              value={field.key}
              onChange={(e) => updateField(index, { key: e.target.value })}
              placeholder="key"
            />
            <Input
              style={{ width: 160 }}
              value={field.label}
              onChange={(e) => updateField(index, { label: e.target.value })}
              placeholder="label"
            />
            <Select
              style={{ width: 130 }}
              value={field.type}
              onChange={(value) => updateField(index, { type: value })}
              options={FIELD_TYPES.map((type) => ({ label: type, value: type }))}
            />
            {field.type === 'select' && (
              <Input
                style={{ width: 180 }}
                value={field.optionsText}
                onChange={(e) => updateField(index, { optionsText: e.target.value })}
                placeholder="option1, option2"
              />
            )}
            <Switch
              checked={field.required}
              onChange={(checked) => updateField(index, { required: checked })}
              checkedChildren={t('workflow.builder.required')}
              unCheckedChildren={t('workflow.builder.optional')}
            />
            <Button type="text" danger icon={<Trash2 size={14} />} onClick={() => removeField(index)} />
          </FieldRow>
        ))}
      </Section>

      <Section>
        <Label>{t('workflow.builder.system_prompt')}</Label>
        <Input.TextArea rows={3} value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} />
        <Label>{t('workflow.builder.prompt_template')}</Label>
        <Input.TextArea
          rows={5}
          value={promptTemplate}
          onChange={(e) => setPromptTemplate(e.target.value)}
          placeholder="Use {{field_key}} placeholders"
        />
      </Section>

      <Section>
        <Label>{t('workflow.builder.model')}</Label>
        <ParamsRow>
          <Select
            style={{ width: 200 }}
            value={model}
            onChange={setModel}
            options={MODEL_OPTIONS.map((m) => ({ label: m, value: m }))}
          />
          <ParamField>
            <span>maxTokens</span>
            <InputNumber min={1} max={64000} value={maxTokens} onChange={(v) => setMaxTokens(v ?? 4096)} />
          </ParamField>
          <ParamField>
            <span>temperature</span>
            <InputNumber min={0} max={2} step={0.1} value={temperature} onChange={(v) => setTemperature(v ?? 0.7)} />
          </ParamField>
          <ParamField>
            <span>topP</span>
            <InputNumber min={0} max={1} step={0.05} value={topP} onChange={(v) => setTopP(v ?? 0.9)} />
          </ParamField>
        </ParamsRow>
      </Section>

      {fields.length > 0 && (
        <Section>
          <Label>{t('workflow.builder.test_values')}</Label>
          {fields.map((field, index) => (
            <TestRow key={index}>
              <TestLabel>{field.label || field.key || `#${index + 1}`}</TestLabel>
              <TestControl>{renderTestControl(field)}</TestControl>
            </TestRow>
          ))}
        </Section>
      )}

      <Actions>
        <Button icon={<Play size={14} />} loading={running} disabled={running} onClick={onRun}>
          {running ? t('workflow.task.running') : t('workflow.builder.test_run')}
        </Button>
        <Button
          type="primary"
          icon={<Upload size={14} />}
          loading={uploading}
          disabled={uploading || !canUpload}
          onClick={onUpload}>
          {editing ? t('workflow.builder.save') : t('workflow.builder.upload')}
        </Button>
      </Actions>

      {uploadError && <ErrorText>{uploadError}</ErrorText>}

      {(output || runError) && (
        <Section>
          <Label>{t('workflow.task.result')}</Label>
          {runError ? (
            <ErrorText>{runError}</ErrorText>
          ) : (
            <Markdown>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{output}</ReactMarkdown>
            </Markdown>
          )}
        </Section>
      )}
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex-direction: column;
  gap: 20px;
  height: 100%;
  width: 100%;
  max-width: 820px;
  padding: 24px;
  overflow-y: auto;
`

const Title = styled.h1`
  font-size: 18px;
  font-weight: 600;
  color: var(--color-text);
  margin: 0;
`

const Section = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const SectionHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
`

const Label = styled.div`
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
`

const FieldRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
`

const ParamsRow = styled.div`
  display: flex;
  align-items: flex-end;
  gap: 16px;
  flex-wrap: wrap;
`

const ParamField = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--color-text-secondary);
`

const TestRow = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 8px;
`

const TestLabel = styled.div`
  width: 160px;
  flex-shrink: 0;
  padding-top: 6px;
  font-size: 13px;
  color: var(--color-text-secondary);
`

const TestControl = styled.div`
  flex: 1;
`

const Actions = styled.div`
  display: flex;
  gap: 10px;
`

const ErrorText = styled.div`
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
`

export default WorkflowBuilderPage
