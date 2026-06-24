import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useAuthState } from '../useAuthState'

const getStatus = vi.fn()
const logout = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  ;(window as unknown as { api: unknown }).api = {
    operatorAuth: { getStatus, logout, login: vi.fn(), submitNewPassword: vi.fn() }
  }
})

describe('useAuthState', () => {
  it('starts unauthenticated and reconciles status from main', async () => {
    getStatus.mockResolvedValue({ authenticated: false })
    const { result } = renderHook(() => useAuthState())
    expect(result.current.isAuthenticated).toBe(false)
    await waitFor(() => expect(getStatus).toHaveBeenCalledTimes(1))
  })

  it('reads the cached authenticated flag synchronously', async () => {
    localStorage.setItem('operator-authenticated', 'true')
    getStatus.mockResolvedValue({ authenticated: true })
    const { result } = renderHook(() => useAuthState())
    expect(result.current.isAuthenticated).toBe(true)
    await waitFor(() => expect(getStatus).toHaveBeenCalled())
  })

  it('markAuthenticated sets the flag and persists it', async () => {
    getStatus.mockResolvedValue({ authenticated: true })
    const { result } = renderHook(() => useAuthState())
    act(() => result.current.markAuthenticated())
    expect(result.current.isAuthenticated).toBe(true)
    expect(localStorage.getItem('operator-authenticated')).toBe('true')
  })

  it('logout clears the flag and notifies main', async () => {
    localStorage.setItem('operator-authenticated', 'true')
    getStatus.mockResolvedValue({ authenticated: true })
    logout.mockResolvedValue(undefined)
    const { result } = renderHook(() => useAuthState())
    await act(async () => {
      await result.current.logout()
    })
    expect(logout).toHaveBeenCalledTimes(1)
    expect(result.current.isAuthenticated).toBe(false)
    expect(localStorage.getItem('operator-authenticated')).toBe('false')
  })
})
