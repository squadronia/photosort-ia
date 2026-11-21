import type { BurstPhotoCategory, EventStatus } from './models'

type EventRow = {
  id: string
  owner_id: string
  name: string
  category: string
  event_date: string
  description: string
  photo_count: number
  cover_photo_id: string | null
  status: EventStatus
  is_demo: boolean
  created_at: string
  updated_at: string
}

export type EventInsert = {
  id?: string
  owner_id?: string
  name: string
  category: string
  event_date: string
  description?: string
  photo_count?: number
  cover_photo_id?: string | null
  status?: EventStatus
  is_demo?: boolean
}

type EventUpdate = Partial<Omit<EventRow, 'id' | 'owner_id' | 'created_at'>>

type PhotoRow = {
  id: string
  owner_id: string
  event_id: string
  original_name: string
  storage_path: string
  content_type: string
  byte_size: number
  burst_id: string | null
  burst_category: BurstPhotoCategory
  burst_position: number | null
  burst_size: number | null
  captured_at: string | null
  camera_label: string | null
  review_reason: string | null
  sha256: string | null
  created_at: string
}

type PhotoInsert = {
  id?: string
  owner_id?: string
  event_id: string
  original_name: string
  storage_path: string
  content_type: string
  byte_size: number
  burst_id?: string | null
  burst_category?: BurstPhotoCategory
  burst_position?: number | null
  burst_size?: number | null
  captured_at?: string | null
  camera_label?: string | null
  review_reason?: string | null
  sha256?: string | null
}

export type Database = {
  public: {
    Tables: {
      events: {
        Row: EventRow
        Insert: EventInsert
        Update: EventUpdate
        Relationships: []
      }
      photos: {
        Row: PhotoRow
        Insert: PhotoInsert
        Update: Partial<PhotoInsert>
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: {
      event_status: EventStatus
    }
    CompositeTypes: Record<string, never>
  }
}
