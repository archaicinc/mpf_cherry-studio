import WindowControls from '@renderer/components/WindowControls'
import { Alert, Button, Form, Input } from 'antd'
import type { FC } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

interface LoginPageProps {
  onSuccess: () => void
}

interface LoginFormValues {
  email: string
  password: string
}

const LoginPage: FC<LoginPageProps> = ({ onSuccess }) => {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Set when the server requires a permanent password on first login.
  const [challenge, setChallenge] = useState<{ email: string; session: string } | null>(null)

  const handleLogin = async (values: LoginFormValues) => {
    setLoading(true)
    setError(null)
    try {
      const result = await window.api.operatorAuth.login(values.email, values.password)
      if ('challenge' in result) {
        setChallenge({ email: values.email, session: result.session })
        return
      }
      onSuccess()
    } catch (e) {
      setError((e as Error).message || t('operatorLogin.error.generic'))
    } finally {
      setLoading(false)
    }
  }

  const handleNewPassword = async (values: { newPassword: string }) => {
    if (!challenge) return
    setLoading(true)
    setError(null)
    try {
      const result = await window.api.operatorAuth.submitNewPassword(
        challenge.email,
        values.newPassword,
        challenge.session
      )
      if ('challenge' in result) {
        setError(t('operatorLogin.error.generic'))
        return
      }
      onSuccess()
    } catch (e) {
      setError((e as Error).message || t('operatorLogin.error.generic'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex h-screen w-screen flex-col">
      <div className="drag flex w-full shrink-0 items-center justify-end" style={{ height: 'var(--navbar-height)' }}>
        <WindowControls />
      </div>
      <div className="flex flex-1 items-center justify-center px-2 pb-2">
        <div style={{ width: 360, maxWidth: '100%' }}>
          <h1 style={{ textAlign: 'center', marginBottom: 24 }}>{t('operatorLogin.title')}</h1>
          {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />}
          {challenge ? (
            <Form layout="vertical" requiredMark={false} onFinish={handleNewPassword}>
              <p>{t('operatorLogin.newPassword.hint')}</p>
              <Form.Item
                name="newPassword"
                label={t('operatorLogin.newPassword.label')}
                rules={[{ required: true, message: t('operatorLogin.newPassword.required') }]}>
                <Input.Password size="large" autoFocus />
              </Form.Item>
              <Button type="primary" htmlType="submit" size="large" block loading={loading}>
                {t('operatorLogin.newPassword.submit')}
              </Button>
            </Form>
          ) : (
            <Form layout="vertical" requiredMark={false} onFinish={handleLogin}>
              <Form.Item
                name="email"
                label={t('operatorLogin.email.label')}
                rules={[{ required: true, message: t('operatorLogin.email.required') }]}>
                <Input size="large" autoComplete="username" autoFocus />
              </Form.Item>
              <Form.Item
                name="password"
                label={t('operatorLogin.password.label')}
                rules={[{ required: true, message: t('operatorLogin.password.required') }]}>
                <Input.Password size="large" autoComplete="current-password" />
              </Form.Item>
              <Button type="primary" htmlType="submit" size="large" block loading={loading}>
                {t('operatorLogin.submit')}
              </Button>
            </Form>
          )}
        </div>
      </div>
    </div>
  )
}

export default LoginPage
