import { loggerService } from '@logger'
import { MPF_SERVER_CONFIG } from '@shared/config/constant'
import type { InferenceRequest, InferenceStreamEvent } from '@shared/inference'
import { IpcChannel } from '@shared/IpcChannel'
import type { WorkflowTask } from '@shared/workflowTask'
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
    const data = (await this.authedGet('/me/workflow-tasks')) as { items?: WorkflowTask[] } | null
    return data?.items ?? []
  }

  public fetchWorkflowTask = async (_: Electron.IpcMainInvokeEvent, id: string): Promise<WorkflowTask> => {
    return (await this.authedGet(`/me/workflow-tasks/${encodeURIComponent(id)}`)) as WorkflowTask
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

    let response = await this.postStream(request, await this.getValidIdToken())
    if (response.status === 401) {
      response = await this.postStream(request, await this.forceRefresh())
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

  private doGet = async (apiPath: string, idToken: string): Promise<Response> => {
    try {
      return await net.fetch(`${MPF_SERVER_CONFIG.BASE_URL}${apiPath}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${idToken}` }
      })
    } catch (error) {
      logger.error(`Request to ${apiPath} failed:`, error as Error)
      throw new OperatorAuthError('Could not reach the server')
    }
  }

  private authedGet = async (apiPath: string): Promise<unknown> => {
    let response = await this.doGet(apiPath, await this.getValidIdToken())
    if (response.status === 401) {
      // Token rejected despite the proactive check — refresh once and retry.
      response = await this.doGet(apiPath, await this.forceRefresh())
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

  /** A valid idToken, refreshing proactively when the current one is near expiry. */
  private getValidIdToken = async (): Promise<string> => {
    const stored = await this.readTokens()
    if (!stored?.idToken) {
      throw new OperatorAuthError('Not signed in')
    }
    const expiresAt = stored.obtainedAt + stored.expiresIn * 1000
    // Refresh a minute early to absorb clock skew; if no refresh token, let the
    // server be the judge (a 401 then triggers a clear "sign in again").
    if (Date.now() < expiresAt - 60_000 || !stored.refreshToken) {
      return stored.idToken
    }
    return (await this.refreshTokens(stored)).idToken
  }

  /** Force a refresh after a 401 (e.g. server-side invalidation or clock skew). */
  private forceRefresh = async (): Promise<string> => {
    const stored = await this.readTokens()
    if (!stored) {
      throw new OperatorAuthError('Not signed in')
    }
    return (await this.refreshTokens(stored)).idToken
  }

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
