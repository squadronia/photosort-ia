import { useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { isSupabaseConfigured, supabase } from '../services/supabase'
import { AuthContext, type AuthContextValue } from './authContext'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [isLoading, setIsLoading] = useState(isSupabaseConfigured)
  const [initializationError, setInitializationError] = useState<string | null>(null)

  useEffect(() => {
    if (!supabase) return

    let active = true
    void supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return
      if (error) {
        console.error('Não foi possível recuperar a sessão do Supabase.', error)
        setInitializationError(`Não foi possível validar a sessão: ${error.message}`)
      }
      setSession(data.session)
      setIsLoading(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setInitializationError(null)
      setIsLoading(false)
    })

    return () => {
      active = false
      listener.subscription.unsubscribe()
    }
  }, [])

  const value: AuthContextValue = {
    isConfigured: isSupabaseConfigured,
    isLoading,
    user: session?.user ?? null,
    initializationError,
    async signIn(email, password) {
      if (!supabase) throw new Error('A autenticação do Supabase não está configurada.')
      setInitializationError(null)
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) {
        setInitializationError(error.message)
        throw error
      }
    },
    async signOut() {
      if (!supabase) return
      const { error } = await supabase.auth.signOut()
      if (error) throw error
    },
    async updateProfileName(name) {
      if (!supabase) throw new Error('A autenticação do Supabase não está configurada.')
      const normalizedName = name.trim()
      if (!normalizedName) throw new Error('Informe um nome para o perfil.')

      const { data, error } = await supabase.auth.updateUser({
        data: {
          ...session?.user.user_metadata,
          full_name: normalizedName,
        },
      })
      if (error) throw error
      if (data.user) {
        setSession((current) => current ? { ...current, user: data.user } : current)
      }
    },
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
