import { createClient } from '@supabase/supabase-js'
import type { Database } from '../domain/database.types'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim()
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()

if (Boolean(supabaseUrl) !== Boolean(supabaseKey)) {
  throw new Error('Configure tanto VITE_SUPABASE_URL quanto VITE_SUPABASE_ANON_KEY.')
}

if (supabaseUrl) {
  const parsedUrl = new URL(supabaseUrl)
  const localDevelopment = parsedUrl.hostname === 'localhost' || parsedUrl.hostname === '127.0.0.1'
  if (parsedUrl.protocol !== 'https:' && !localDevelopment) {
    throw new Error('A URL do Supabase deve usar HTTPS fora do desenvolvimento local.')
  }
}

export const supabase = supabaseUrl && supabaseKey
  ? createClient<Database>(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      },
    })
  : null

export const isSupabaseConfigured = supabase !== null
