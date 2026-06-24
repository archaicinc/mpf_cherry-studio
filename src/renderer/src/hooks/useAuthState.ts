import { useCallback, useEffect, useState } from 'react'

const OPERATOR_AUTHENTICATED_KEY = 'operator-authenticated'

/**
 * Operator authentication gate state. The flag is cached in localStorage for a
 * synchronous first render, then reconciled against the main process (which
 * owns the actual tokens) so a cleared/expired token logs the operator out.
 */
export function useAuthState() {
  const [isAuthenticated, setIsAuthenticated] = useState(
    () => localStorage.getItem(OPERATOR_AUTHENTICATED_KEY) === 'true'
  )

  useEffect(() => {
    window.api.operatorAuth
      .getStatus()
      .then(({ authenticated }) => {
        localStorage.setItem(OPERATOR_AUTHENTICATED_KEY, authenticated ? 'true' : 'false')
        setIsAuthenticated(authenticated)
      })
      .catch(() => {
        // Leave the cached flag in place if the status check fails.
      })
  }, [])

  const markAuthenticated = useCallback(() => {
    localStorage.setItem(OPERATOR_AUTHENTICATED_KEY, 'true')
    setIsAuthenticated(true)
  }, [])

  const logout = useCallback(async () => {
    await window.api.operatorAuth.logout()
    localStorage.setItem(OPERATOR_AUTHENTICATED_KEY, 'false')
    setIsAuthenticated(false)
  }, [])

  return {
    isAuthenticated,
    markAuthenticated,
    logout
  }
}
