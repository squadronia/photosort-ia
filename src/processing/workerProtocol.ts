import type { PhotoMetadata } from './burstOrganizer'

export type WorkerRequest =
  | { type: 'process'; requestId: string; files: File[]; includeHash?: boolean }
  | { type: 'cancel'; requestId: string }

export type WorkerResponse =
  | {
      type: 'progress'
      requestId: string
      completed: number
      total: number
      completedBytes: number
      totalBytes: number
      currentName: string
    }
  | { type: 'complete'; requestId: string; photos: PhotoMetadata[] }
  | { type: 'cancelled'; requestId: string }
  | { type: 'error'; requestId: string; message: string }
