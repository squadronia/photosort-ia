import type { AppPreferences, PhotoEvent, Theme } from '../domain/models'

const STORAGE_KEY = 'photosort.preferences.v1'

const defaults: AppPreferences = {
  events: [],
  theme: 'light',
}

function isTheme(value: unknown): value is Theme {
  return value === 'dark' || value === 'light'
}

function isPhotoEvent(value: unknown): value is PhotoEvent {
  if (!value || typeof value !== 'object') return false

  const event = value as Record<string, unknown>
  const statuses: readonly string[] = ['waiting', 'ready', 'processing', 'completed', 'error']

  return (
    typeof event.id === 'string' &&
    typeof event.name === 'string' &&
    typeof event.category === 'string' &&
    typeof event.date === 'string' &&
    typeof event.description === 'string' &&
    typeof event.photoCount === 'number' &&
    Number.isInteger(event.photoCount) &&
    event.photoCount >= 0 &&
    typeof event.status === 'string' &&
    statuses.includes(event.status) &&
    event.isDemo !== true &&
    typeof event.createdAt === 'string'
  )
}

function readPreferences(): AppPreferences {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (!saved) return defaults

    const value: unknown = JSON.parse(saved)
    if (!value || typeof value !== 'object') return defaults

    const candidate = value as Partial<AppPreferences>
    const events = Array.isArray(candidate.events)
      ? candidate.events.filter(isPhotoEvent)
      : defaults.events

    return {
      events: events.map((event) => ({
        id: event.id,
        name: event.name,
        category: event.category,
        date: event.date,
        description: event.description,
        photoCount: event.photoCount,
        status: event.status,
        createdAt: event.createdAt,
      })),
      theme: isTheme(candidate.theme) ? candidate.theme : defaults.theme,
    }
  } catch (error) {
    console.error('Não foi possível carregar as preferências locais.', error)
    return defaults
  }
}

export function loadPreferences(): AppPreferences {
  return readPreferences()
}

export function savePreferences(preferences: AppPreferences): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences))
  } catch (error) {
    console.error('Não foi possível salvar as preferências locais.', error)
  }
}
