import { useState, type FormEvent } from 'react'
import { LockKeyhole, ShieldCheck } from 'lucide-react'
import { BrandLogo } from '../components/BrandLogo'
import type { Theme } from '../domain/models'

export function LoginPage({
  onSignIn,
  setupError,
  theme,
}: {
  onSignIn: (email: string, password: string) => Promise<void>
  setupError: string | null
  theme: Theme
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setIsSubmitting(true)
    try {
      await onSignIn(email.trim(), password)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível entrar. Verifique seus dados e tente novamente.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="login-page">
      <section className="login-card">
        <a aria-label="PhotoSort" className="brand login-brand" href="/">
          <BrandLogo className="brand-logo" theme={theme} />
        </a>
        <span className="login-icon"><LockKeyhole size={21} /></span>
        <h1>Acesso privado</h1>
        <p>Entre com a conta autorizada para acessar seu workspace fotográfico.</p>
        <form className="login-form" onSubmit={submit}>
          <label className="field">E-mail<input autoComplete="username" onChange={(event) => setEmail(event.target.value)} required type="email" value={email} /></label>
          <label className="field">Senha<input autoComplete="current-password" onChange={(event) => setPassword(event.target.value)} required type="password" value={password} /></label>
          {(error || setupError) && <p className="login-error" role="alert">{error || setupError}</p>}
          <button aria-busy={isSubmitting} className="button button-primary login-submit" disabled={isSubmitting} type="submit">
            {isSubmitting && <span aria-hidden="true" className="login-spinner" />}
            {isSubmitting ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
        <div className="login-security"><ShieldCheck size={15} /> Contas são provisionadas de forma privada no Supabase.</div>
      </section>
    </main>
  )
}
