import { loggerService } from '@logger'
import { MPF_SERVER_CONFIG } from '@shared/config/constant'
import type { InferenceRequest, InferenceStreamEvent } from '@shared/inference'
import { IpcChannel } from '@shared/IpcChannel'
import type { ModelOption, WorkflowTask } from '@shared/workflowTask'
import { net, safeStorage } from 'electron'
import fs from 'fs'
import path from 'path'

import { getConfigDir } from '../utils/file'

const logger = loggerService.withContext('OperatorAuthService')

const TOKEN_FILE_NAME = '.operator_auth_token'

interface AuthTokens {
  accessToken: string
  idToken: string
  // Absent on a refresh response — Cognito does not reissue the refresh token.
  refreshToken?: string
  expiresIn: number
  tokenType: string
}

interface StoredTokens extends AuthTokens {
  /** epoch ms when the tokens were obtained, for future expiry/refresh logic */
  obtainedAt: number
}

/** What the renderer receives: either authenticated, or a first-login challenge. */
export type LoginResult = { authenticated: true } | { challenge: 'NEW_PASSWORD_REQUIRED'; session: string }

class OperatorAuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OperatorAuthError'
  }
}

class OperatorAuthService {
  private readonly tokenFilePath: string

  constructor() {
    this.tokenFilePath = path.join(getConfigDir(), TOKEN_FILE_NAME)
  }

  public login = async (_: Electron.IpcMainInvokeEvent, email: string, password: string): Promise<LoginResult> => {
    const data = await this.post('/auth/login', { email, password })
    return this.handleAuthResponse(data)
  }

  public submitNewPassword = async (
    _: Electron.IpcMainInvokeEvent,
    email: string,
    newPassword: string,
    session: string
  ): Promise<LoginResult> => {
    const data = await this.post('/auth/new-password', { email, newPassword, session })
    return this.handleAuthResponse(data)
  }

  public getStatus = async (): Promise<{ authenticated: boolean }> => {
    try {
      await fs.promises.access(this.tokenFilePath)
      return { authenticated: true }
    } catch {
      return { authenticated: false }
    }
  }

  public logout = async (): Promise<void> => {
    try {
      await fs.promises.unlink(this.tokenFilePath)
      logger.debug('Operator logged out, tokens cleared')
    } catch {
      // No token file means there's nothing to clear.
    }
  }

  /** Workflow tasks the logged-in operator may run (admins get all). */
  public fetchWorkflowTasks = async (): Promise<WorkflowTask[]> => {
    const data = (await this.authedRequest('GET', '/me/workflow-tasks')) as { items?: WorkflowTask[] } | null
    return data?.items ?? []
  }

  public fetchWorkflowTask = async (_: Electron.IpcMainInvokeEvent, id: string): Promise<WorkflowTask> => {
    return (await this.authedRequest('GET', `/me/workflow-tasks/${encodeURIComponent(id)}`)) as WorkflowTask
  }

  /** Create (and upload) a workflow task. Admin-only — the server enforces it. */
  public createWorkflowTask = async (
    _: Electron.IpcMainInvokeEvent,
    body: Partial<WorkflowTask>
  ): Promise<WorkflowTask> => {
    return (await this.authedRequest('POST', '/me/workflow-tasks', body)) as WorkflowTask
  }

  /** Update a workflow task. Creator-only — the server enforces it (403 otherwise). */
  public updateWorkflowTask = async (
    _: Electron.IpcMainInvokeEvent,
    id: string,
    body: Partial<WorkflowTask>
  ): Promise<WorkflowTask> => {
    return (await this.authedRequest(
      'PATCH',
      `/me/workflow-tasks/${encodeURIComponent(id)}`,
      body
    )) as WorkflowTask
  }

  /** The Bedrock models the account can invoke now, for the builder's picker. Admin-only. */
  public fetchModels = async (): Promise<ModelOption[]> => {
    const data = (await this.authedRequest('GET', '/models')) as { items?: ModelOption[] } | null
    return data?.items ?? []
  }

  /** Whether the signed-in operator is an admin (from the idToken's groups). */
  public isAdmin = async (): Promise<boolean> => {
    const tokens = await this.readTokens()
    return tokens?.idToken ? this.tokenGroups(tokens.idToken).includes('admin') : false
  }

  /** Email of the signed-in user (from the idToken), or '' if unavailable. */
  public getCurrentUserEmail = async (): Promise<string> => {
    const tokens = await this.readTokens()
    return tokens?.idToken ? this.tokenClaim(tokens.idToken, 'email') : ''
  }

  private tokenClaim = (idToken: string, claim: string): string => {
    try {
      const payload = idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
      const claims = JSON.parse(Buffer.from(payload, 'base64').toString('utf-8')) as Record<string, unknown>
      const value = claims[claim]
      return typeof value === 'string' ? value : ''
    } catch {
      return ''
    }
  }

  private tokenGroups = (idToken: string): string[] => {
    try {
      const payload = idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
      const claims = JSON.parse(Buffer.from(payload, 'base64').toString('utf-8'))
      const groups = (claims as { 'cognito:groups'?: unknown })['cognito:groups']
      return Array.isArray(groups) ? (groups as string[]) : []
    } catch {
      return []
    }
  }

  /**
   * Run a workflow task through the inference gateway, streaming the result.
   * Done from main (net.fetch, no CORS); each text delta is forwarded to the
   * calling renderer via WorkflowTasks_RunChunk. Resolves when the stream ends.
   */
  public runWorkflowTask = async (
    event: Electron.IpcMainInvokeEvent,
    runId: string,
    request: InferenceRequest
  ): Promise<void> => {
    if (!MPF_SERVER_CONFIG.INFERENCE_STREAM_URL) {
      throw new OperatorAuthError('Inference endpoint is not configured')
    }

    // Anthropic models reject temperature and top_p together; drop top_p, keep temperature.
    const cfg = request.inferenceConfig
    const payload: InferenceRequest =
      cfg && cfg.temperature !== undefined && cfg.topP !== undefined
        ? { ...request, inferenceConfig: { maxTokens: cfg.maxTokens, temperature: cfg.temperature } }
        : request

    let response = await this.postStream(payload, await this.getValidAccessToken())
    if (response.status === 401) {
      response = await this.postStream(payload, await this.forceRefreshAccessToken())
    }
    if (!response.ok || !response.body) {
      throw new OperatorAuthError(`HTTP ${response.status}`)
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      // Server emits newline-delimited JSON events.
      let newline: number
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        if (!line) continue
        const parsed = this.parseStreamLine(line)
        if (parsed?.type === 'delta') {
          if (!event.sender.isDestroyed()) {
            event.sender.send(IpcChannel.WorkflowTasks_RunChunk, { runId, text: parsed.text })
          }
        } else if (parsed?.type === 'error') {
          throw new OperatorAuthError(parsed.message)
        }
      }
    }
  }

  private postStream = async (request: InferenceRequest, idToken: string): Promise<Response> => {
    try {
      return await net.fetch(MPF_SERVER_CONFIG.INFERENCE_STREAM_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify(request)
      })
    } catch (error) {
      logger.error('Inference request failed:', error as Error)
      throw new OperatorAuthError('Could not reach the inference server')
    }
  }

  private parseStreamLine = (line: string): InferenceStreamEvent | null => {
    try {
      return JSON.parse(line) as InferenceStreamEvent
    } catch {
      return null
    }
  }

  private readTokens = async (): Promise<StoredTokens | null> => {
    try {
      const encrypted = await fs.promises.readFile(this.tokenFilePath)
      return JSON.parse(safeStorage.decryptString(encrypted)) as StoredTokens
    } catch {
      return null
    }
  }

  private doRequest = async (
    method: string,
    apiPath: string,
    idToken: string,
    body?: unknown
  ): Promise<Response> => {
    try {
      return await net.fetch(`${MPF_SERVER_CONFIG.BASE_URL}${apiPath}`, {
        method,
        headers: {
          Authorization: `Bearer ${idToken}`,
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {})
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {})
      })
    } catch (error) {
      logger.error(`Request to ${apiPath} failed:`, error as Error)
      throw new OperatorAuthError('Could not reach the server')
    }
  }

  private authedRequest = async (method: string, apiPath: string, body?: unknown): Promise<unknown> => {
    let response = await this.doRequest(method, apiPath, await this.getValidIdToken(), body)
    if (response.status === 401) {
      // Token rejected despite the proactive check — refresh once and retry.
      response = await this.doRequest(method, apiPath, await this.forceRefresh(), body)
    }
    const data = await response.json().catch(() => null)
    if (!response.ok) {
      const message = (data as { error?: { message?: string } } | null)?.error?.message ?? `HTTP ${response.status}`
      throw new OperatorAuthError(message)
    }
    return data
  }

  private handleAuthResponse = async (data: unknown): Promise<LoginResult> => {
    const body = data as Partial<AuthTokens> & Partial<{ challenge: string; session: string }>
    if (body?.challenge === 'NEW_PASSWORD_REQUIRED') {
      return { challenge: 'NEW_PASSWORD_REQUIRED', session: body.session ?? '' }
    }
    if (!body?.accessToken || !body?.idToken) {
      throw new OperatorAuthError('Server did not return valid tokens')
    }
    await this.persistTokens(body as AuthTokens)
    return { authenticated: true }
  }

  private persistTokens = async (tokens: AuthTokens): Promise<StoredTokens> => {
    const bundle: StoredTokens = { ...tokens, obtainedAt: Date.now() }
    const encrypted = safeStorage.encryptString(JSON.stringify(bundle))
    const dir = path.dirname(this.tokenFilePath)
    if (!fs.existsSync(dir)) {
      await fs.promises.mkdir(dir, { recursive: true })
    }
    await fs.promises.writeFile(this.tokenFilePath, encrypted)
    return bundle
  }

  /** Exchange the stored refresh token for a fresh idToken via the server. */
  private refreshTokens = async (stored: StoredTokens): Promise<StoredTokens> => {
    if (!stored.refreshToken) {
      throw new OperatorAuthError('Session expired, please sign in again')
    }
    const data = (await this.post('/auth/refresh', { refreshToken: stored.refreshToken })) as Partial<AuthTokens>
    if (!data?.idToken || !data?.accessToken) {
      throw new OperatorAuthError('Session expired, please sign in again')
    }
    // Cognito does not reissue the refresh token, so carry the existing one forward.
    return this.persistTokens({ ...(data as AuthTokens), refreshToken: stored.refreshToken })
  }

  /** A valid token bundle, refreshing proactively when the current one is near expiry. */
  private getValidTokens = async (): Promise<StoredTokens> => {
    const stored = await this.readTokens()
    if (!stored?.idToken) {
      throw new OperatorAuthError('Not signed in')
    }
    const expiresAt = stored.obtainedAt + stored.expiresIn * 1000
    // Refresh a minute early to absorb clock skew; if no refresh token, let the
    // server be the judge (a 401 then triggers a clear "sign in again").
    if (Date.now() < expiresAt - 60_000 || !stored.refreshToken) {
      return stored
    }
    return this.refreshTokens(stored)
  }

  /** The idToken for the API Gateway JWT authorizer (carries email/custom claims). */
  private getValidIdToken = async (): Promise<string> => (await this.getValidTokens()).idToken

  /** The access token for the inference gateway, which verifies tokenUse:"access". */
  private getValidAccessToken = async (): Promise<string> => (await this.getValidTokens()).accessToken

  /** Force a refresh after a 401 (e.g. server-side invalidation or clock skew). */
  private forceRefreshTokens = async (): Promise<StoredTokens> => {
    const stored = await this.readTokens()
    if (!stored) {
      throw new OperatorAuthError('Not signed in')
    }
    return this.refreshTokens(stored)
  }

  private forceRefresh = async (): Promise<string> => (await this.forceRefreshTokens()).idToken

  private forceRefreshAccessToken = async (): Promise<string> => (await this.forceRefreshTokens()).accessToken

  private post = async (apiPath: string, body: unknown): Promise<unknown> => {
    let response: Response
    try {
      response = await net.fetch(`${MPF_SERVER_CONFIG.BASE_URL}${apiPath}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
    } catch (error) {
      logger.error(`Request to ${apiPath} failed:`, error as Error)
      throw new OperatorAuthError('Could not reach the server')
    }
    const data = await response.json().catch(() => null)
    if (!response.ok) {
      const message = (data as { error?: { message?: string } } | null)?.error?.message ?? `HTTP ${response.status}`
      throw new OperatorAuthError(message)
    }
    return data
  }
}

export default new OperatorAuthService()
