import { beforeEach, describe, expect, it, vi } from 'vitest'

const fetchMock = vi.fn()
const encryptString = vi.fn((s: string) => Buffer.from(s))
const decryptString = vi.fn((b: Buffer) => b.toString())
const access = vi.fn()
const unlink = vi.fn(async () => {})
const writeFile = vi.fn(async () => {})
const mkdir = vi.fn(async () => {})
const readFile = vi.fn()

vi.mock('electron', () => ({
  net: { fetch: fetchMock },
  safeStorage: { encryptString, decryptString }
}))

vi.mock('fs', () => {
  const mock = {
    existsSync: vi.fn(() => true),
    promises: { access, unlink, writeFile, mkdir, readFile }
  }
  return { ...mock, default: mock }
})

vi.mock('../../utils/file', () => ({ getConfigDir: () => '/mock/config' }))

const { default: service } = await import('../OperatorAuthService')

const BASE = 'https://i6wmu0e2zi.execute-api.ap-northeast-1.amazonaws.com'
const evt = {} as Electron.IpcMainInvokeEvent

function response(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

const fullTokens = { accessToken: 'a', idToken: 'i', refreshToken: 'r', expiresIn: 3600, tokenType: 'Bearer' }

describe('OperatorAuthService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    encryptString.mockImplementation((s: string) => Buffer.from(s))
    decryptString.mockImplementation((b: Buffer) => b.toString())
  })

  it('persists tokens and reports authenticated on successful login', async () => {
    fetchMock.mockResolvedValue(response(200, fullTokens))
    const result = await service.login(evt, 'o@x.com', 'pw')
    expect(result).toEqual({ authenticated: true })
    expect(fetchMock).toHaveBeenCalledWith(`${BASE}/auth/login`, expect.objectContaining({ method: 'POST' }))
    expect(writeFile).toHaveBeenCalledTimes(1)
  })

  it('returns the NEW_PASSWORD_REQUIRED challenge without persisting tokens', async () => {
    fetchMock.mockResolvedValue(response(200, { challenge: 'NEW_PASSWORD_REQUIRED', session: 'sess' }))
    const result = await service.login(evt, 'o@x.com', 'pw')
    expect(result).toEqual({ challenge: 'NEW_PASSWORD_REQUIRED', session: 'sess' })
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('throws the server error message on a failed login', async () => {
    fetchMock.mockResolvedValue(
      response(401, { error: { code: 'UNAUTHORIZED', message: 'Incorrect email or password' } })
    )
    await expect(service.login(evt, 'o@x.com', 'bad')).rejects.toThrow('Incorrect email or password')
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('completes the new-password challenge and persists tokens', async () => {
    fetchMock.mockResolvedValue(response(200, { accessToken: 'a', idToken: 'i', expiresIn: 3600, tokenType: 'Bearer' }))
    const result = await service.submitNewPassword(evt, 'o@x.com', 'Np1!', 'sess')
    expect(result).toEqual({ authenticated: true })
    expect(fetchMock).toHaveBeenCalledWith(`${BASE}/auth/new-password`, expect.objectContaining({ method: 'POST' }))
    expect(writeFile).toHaveBeenCalledTimes(1)
  })

  it('reports authenticated=false when no token file exists', async () => {
    access.mockRejectedValue(new Error('ENOENT'))
    expect(await service.getStatus()).toEqual({ authenticated: false })
  })

  it('reports authenticated=true when a token file exists', async () => {
    access.mockResolvedValue(undefined)
    expect(await service.getStatus()).toEqual({ authenticated: true })
  })

  it('clears tokens on logout', async () => {
    await service.logout()
    expect(unlink).toHaveBeenCalledTimes(1)
  })

  it('fetchWorkflowTasks sends an authed GET with the idToken and returns items', async () => {
    readFile.mockResolvedValue(Buffer.from(JSON.stringify({ idToken: 'idtok' })))
    fetchMock.mockResolvedValue(response(200, { items: [{ workflowTaskId: 'wf_1', name: 'T' }] }))
    const items = await service.fetchWorkflowTasks()
    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE}/me/workflow-tasks`,
      expect.objectContaining({ method: 'GET', headers: { Authorization: 'Bearer idtok' } })
    )
    expect(items).toHaveLength(1)
  })

  it('fetchWorkflowTasks throws when not signed in', async () => {
    readFile.mockRejectedValue(new Error('ENOENT'))
    await expect(service.fetchWorkflowTasks()).rejects.toThrow('Not signed in')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fetchWorkflowTask requests the per-id route', async () => {
    readFile.mockResolvedValue(Buffer.from(JSON.stringify({ idToken: 'idtok' })))
    fetchMock.mockResolvedValue(response(200, { workflowTaskId: 'wf_2', name: 'T2' }))
    const task = await service.fetchWorkflowTask(evt, 'wf_2')
    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE}/me/workflow-tasks/wf_2`,
      expect.objectContaining({ method: 'GET' })
    )
    expect(task.workflowTaskId).toBe('wf_2')
  })

  it('runWorkflowTask throws when the inference endpoint is not configured', async () => {
    // MPF_SERVER_CONFIG.INFERENCE_STREAM_URL defaults to '' until filled post-deploy
    const request = { model: 'claude-sonnet', type: 'workflow_task' as const, messages: [] }
    await expect(service.runWorkflowTask(evt, 'r1', request)).rejects.toThrow('not configured')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
