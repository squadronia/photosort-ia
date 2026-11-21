export type EventStatus = 'waiting' | 'ready' | 'processing' | 'completed' | 'error'

export type PhotoEvent = {
  id: string
  name: string
  category: string
  date: string
  description: string
  photoCount: number
  status: EventStatus
  createdAt: string
  coverPhotoUrl?: string
}

export type BurstPhotoCategory = 'unprocessed' | 'complete' | 'excess' | 'review'

export type StoredPhoto = {
  id: string
  eventId: string
  name: string
  sizeBytes: number
  createdAt: string
  signedUrl: string
  burstId: string | null
  burstCategory: BurstPhotoCategory
  burstPosition: number | null
  burstSize: number | null
  capturedAt: string | null
  cameraLabel: string | null
  reviewReason: string | null
}

export type Theme = 'dark' | 'light'

export type AppPreferences = {
  events: PhotoEvent[]
  theme: Theme
}
