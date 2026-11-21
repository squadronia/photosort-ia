import { createContext } from 'react'
import type { User } from '@supabase/supabase-js'

export type AuthContextValue = {
  isConfigured: boolean
  isLoading: boolean
  user: User | null
  initializationError: string | null
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  updateProfileName: (name: string) => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)
