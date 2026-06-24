import { loggerService } from '@logger'
import { MPF_SERVER_CONFIG } from '@shared/config/constant'
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

  private persistTokens = async (tokens: AuthTokens): Promise<void> => {
    const bundle: StoredTokens = { ...tokens, obtainedAt: Date.now() }
    const encrypted = safeStorage.encryptString(JSON.stringify(bundle))
    const dir = path.dirname(this.tokenFilePath)
    if (!fs.existsSync(dir)) {
      await fs.promises.mkdir(dir, { recursive: true })
    }
    await fs.promises.writeFile(this.tokenFilePath, encrypted)
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
