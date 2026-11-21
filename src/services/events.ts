import { Upload } from 'tus-js-client'
import type { EventInsert } from '../domain/database.types'
import type { PhotoEvent, StoredPhoto } from '../domain/models'
import type { BurstPhotoAssignment, PhotoMetadata } from '../processing/burstOrganizer'
import {
  MAX_PHOTO_BYTES,
  MAX_PHOTO_SIZE_LABEL,
  RESUMABLE_UPLOAD_THRESHOLD_BYTES,
} from '../config/storage'
import { supabase } from './supabase'

const STORAGE_BUCKET = 'photos'
const UPLOAD_CONCURRENCY = 3
const PHOTO_INSERT_BATCH_SIZE = 100
const MIME_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

function getResumableUploadEndpoint(): string {
  const projectUrl = new URL(import.meta.env.VITE_SUPABASE_URL)
  const storageDomainSuffix = '.storage.supabase.co'
  if (projectUrl.hostname.endsWith(storageDomainSuffix)) {
    return `${projectUrl.origin}/storage/v1/upload/resumable`
  }

  const projectDomainSuffix = '.supabase.co'
  if (projectUrl.hostname.endsWith(projectDomainSuffix)) {
    const projectRef = projectUrl.hostname.slice(0, -projectDomainSuffix.length)
    return `https://${projectRef}${storageDomainSuffix}/storage/v1/upload/resumable`
  }

  return `${projectUrl.origin}/storage/v1/upload/resumable`
}

export type EventDraft = Pick<PhotoEvent, 'name' | 'category' | 'date' | 'description'>

export type UploadProgress = {
  completed: number
  total: number
  percent: number
  phase?: 'uploading' | 'registering'
}

export type PhotoUploadInput = {
  file: File
  metadata: PhotoMetadata
  classification: Omit<BurstPhotoAssignment, 'photo'>
}

export type CreateCloudEventResult = {
  event: PhotoEvent
  uploadedCount: number
  failures: Array<{ name: string; message: string }>
  coverError?: string
  statusError?: string
}

function requireSupabase() {
  if (!supabase) throw new Error('O Supabase não está configurado neste ambiente.')
  return supabase
}

function mapEvent(row: {
  id: string
  name: string
  category: string
  event_date: string
  description: string
  photo_count: number
  cover_photo_id: string | null
  status: PhotoEvent['status']
  created_at: string
}, coverPhotoUrl?: string): PhotoEvent {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    date: row.event_date,
    description: row.description,
    photoCount: row.photo_count,
    status: row.status,
    createdAt: row.created_at,
    ...(coverPhotoUrl ? { coverPhotoUrl } : {}),
  }
}

export async function listCloudEvents(): Promise<PhotoEvent[]> {
  const client = requireSupabase()
  const { data: events, error } = await client
    .from('events')
    .select('id, name, category, event_date, description, photo_count, cover_photo_id, status, created_at')
    .order('event_date', { ascending: false })

  if (error) throw new Error(`Não foi possível carregar os eventos do Supabase: ${error.message}`)
  const coverPhotoIds = events
    .map((event) => event.cover_photo_id)
    .filter((id): id is string => Boolean(id))
  const coverUrls = new Map<string, string>()

  if (coverPhotoIds.length) {
    const { data: photos, error: photosError } = await client
      .from('photos')
      .select('id, original_name, storage_path')
      .in('id', coverPhotoIds)

    if (photosError) throw new Error(`Não foi possível carregar as capas das corridas: ${photosError.message}`)

    if (photos.length) {
      const { data: signedUrls, error: signingError } = await client
        .storage
        .from(STORAGE_BUCKET)
        .createSignedUrls(photos.map((photo) => photo.storage_path), 15 * 60)

      if (signingError) throw new Error(`Não foi possível criar links privados para as capas: ${signingError.message}`)

      photos.forEach((photo, index) => {
        const signedUrl = signedUrls[index]?.signedUrl
        if (!signedUrl) {
          throw new Error(`Não foi possível criar um link privado para a capa "${photo.original_name}".`)
        }
        coverUrls.set(photo.id, signedUrl)
      })
    }
  }

  return events.map((event) =>
    mapEvent(event, event.cover_photo_id ? coverUrls.get(event.cover_photo_id) : undefined),
  )
}

export async function listCloudPhotos({
  page,
  pageSize,
  eventId,
  searchTerm,
}: {
  page: number
  pageSize: number
  eventId?: string
  searchTerm?: string
}): Promise<{ photos: StoredPhoto[]; total: number }> {
  const client = requireSupabase()
  let query = client
    .from('photos')
    .select('id, event_id, original_name, storage_path, byte_size, created_at, burst_id, burst_category, burst_position, burst_size, captured_at, camera_label, review_reason', { count: 'exact' })

  if (eventId) {
    query = query
      .eq('event_id', eventId)
      .order('burst_id', { ascending: true, nullsFirst: true })
      .order('burst_category', { ascending: true })
      .order('burst_position', { ascending: true, nullsFirst: true })
      .order('captured_at', { ascending: true, nullsFirst: true })
      .order('created_at', { ascending: true })
  } else {
    query = query.order('created_at', { ascending: false })
  }
  query = query.range(page * pageSize, (page + 1) * pageSize - 1)
  if (searchTerm?.trim()) query = query.ilike('original_name', `%${searchTerm.trim()}%`)
  const { data, error, count } = await query

  if (error) throw new Error(`Não foi possível carregar as fotografias: ${error.message}`)
  if (!data.length) return { photos: [], total: count ?? 0 }

  const { data: signedUrls, error: signingError } = await client
    .storage
    .from(STORAGE_BUCKET)
    .createSignedUrls(data.map((photo) => photo.storage_path), 15 * 60)

  if (signingError) throw new Error(`Não foi possível criar links privados para as fotografias: ${signingError.message}`)

  return {
    photos: data.map((photo, index) => {
      const signedUrl = signedUrls[index]?.signedUrl
      if (!signedUrl) {
        throw new Error(`Não foi possível criar um link privado para "${photo.original_name}".`)
      }
      return {
        id: photo.id,
        eventId: photo.event_id,
        name: photo.original_name,
        sizeBytes: photo.byte_size,
        createdAt: photo.created_at,
        signedUrl,
        burstId: photo.burst_id,
        burstCategory: photo.burst_category,
        burstPosition: photo.burst_position,
        burstSize: photo.burst_size,
        capturedAt: photo.captured_at,
        cameraLabel: photo.camera_label,
        reviewReason: photo.review_reason,
      }
    }),
    total: count ?? 0,
  }
}

export async function getCloudStorageUsage(): Promise<{ fileCount: number; bytes: number }> {
  const client = requireSupabase()
  const pageSize = 1000
  let page = 0
  let fileCount = 0
  let bytes = 0

  while (true) {
    const from = page * pageSize
    const { data, count, error } = await client
      .from('photos')
      .select('byte_size', { count: 'exact' })
      .range(from, from + pageSize - 1)

    if (error) throw new Error(`Não foi possível consultar o armazenamento: ${error.message}`)
    fileCount = count ?? fileCount
    bytes += data.reduce((total, photo) => total + photo.byte_size, 0)
    if (data.length < pageSize || from + data.length >= fileCount) break
    page += 1
  }

  return { fileCount, bytes }
}

async function uploadFile(
  userId: string,
  eventId: string,
  photo: PhotoUploadInput,
  onProgress: (uploadedBytes: number, totalBytes: number) => void,
): Promise<{ id: string; path: string }> {
  const client = requireSupabase()
  const { file, classification } = photo
  const id = crypto.randomUUID()
  const extension = MIME_EXTENSIONS[file.type]
  const eventFolder = classification.category === 'review'
    ? `REVISAO/${classification.reviewReason ?? 'geral'}`
    : `${classification.burstId ?? 'SEM_RAJADA'}/${classification.category === 'complete' ? 'COMPLETAS' : 'EXCEDENTES'}`
  const path = `${userId}/${eventId}/${eventFolder}/${id}.${extension}`

  if (file.size <= RESUMABLE_UPLOAD_THRESHOLD_BYTES) {
    const { error } = await client.storage
      .from(STORAGE_BUCKET)
      .upload(path, file, {
        cacheControl: '3600',
        contentType: file.type,
        upsert: false,
      })

    if (error) throw new Error(`Falha ao enviar "${file.name}": ${error.message}`)
    onProgress(file.size, file.size)
    return { id, path }
  }

  const { data, error } = await client.auth.getSession()
  if (error) throw new Error(`Não foi possível validar a sessão antes do upload: ${error.message}`)

  const accessToken = data.session?.access_token
  if (!accessToken) {
    throw new Error('Sua sessão expirou. Entre novamente antes de continuar o upload.')
  }

  return new Promise((resolve, reject) => {
    const uploader = new Upload(file, {
      endpoint: getResumableUploadEndpoint(),
      chunkSize: RESUMABLE_UPLOAD_THRESHOLD_BYTES,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      headers: {
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        authorization: `Bearer ${accessToken}`,
      },
      uploadDataDuringCreation: true,
      metadata: {
        bucketName: STORAGE_BUCKET,
        objectName: path,
        contentType: file.type,
        cacheControl: '3600',
      },
      onError(uploadError) {
        reject(new Error(`Falha ao enviar "${file.name}": ${uploadError.message}`))
      },
      onProgress,
      onSuccess() {
        resolve({ id, path })
      },
      storeFingerprintForResuming: false,
    })

    uploader.start()
  })
}

export async function createCloudEvent(
  userId: string,
  draft: EventDraft,
  photos: PhotoUploadInput[],
  onProgress: (progress: UploadProgress) => void,
): Promise<CreateCloudEventResult> {
  const client = requireSupabase()
  for (const { file } of photos) {
    const fileNameLength = Array.from(file.name).length
    if (fileNameLength < 1 || fileNameLength > 255) {
      throw new Error(`O nome do arquivo "${file.name}" precisa ter entre 1 e 255 caracteres.`)
    }
    if (!MIME_EXTENSIONS[file.type] || file.size === 0 || file.size > MAX_PHOTO_BYTES) {
      throw new Error(`"${file.name}" não pode ser enviado. Use JPG, PNG ou WEBP com até ${MAX_PHOTO_SIZE_LABEL}.`)
    }
  }

  const insert: EventInsert = {
    owner_id: userId,
    name: draft.name,
    category: draft.category,
    event_date: draft.date,
    description: draft.description,
  }
  const { data: row, error: createError } = await client
    .from('events')
    .insert(insert)
    .select('id, name, category, event_date, description, photo_count, status, created_at')
    .single()

  if (createError) throw new Error(`Não foi possível criar o evento no Supabase: ${createError.message}`)

  const failures: CreateCloudEventResult['failures'] = []
  let nextFileIndex = 0
  let completed = 0
  let uploadedCount = 0
  const totalBytes = photos.reduce((sum, photo) => sum + photo.file.size, 0)
  const uploadedBytes = new Map<number, number>()
  const uploadedPhotos = new Map<number, { id: string; path: string }>()

  const reportProgress = () => {
    const bytes = [...uploadedBytes.values()].reduce((sum, value) => sum + value, 0)
    onProgress({
      completed,
      total: photos.length,
      percent: totalBytes === 0 ? 90 : Math.min(90, Math.floor((bytes / totalBytes) * 90)),
      phase: 'uploading',
    })
  }

  const worker = async () => {
    while (nextFileIndex < photos.length) {
      const index = nextFileIndex
      nextFileIndex += 1
      const photo = photos[index]
      const { file } = photo
      try {
        const stored = await uploadFile(userId, row.id, photo, (bytes) => {
          uploadedBytes.set(index, bytes)
          reportProgress()
        })
        uploadedPhotos.set(index, stored)
        uploadedBytes.set(index, file.size)
        uploadedCount += 1
      } catch (error) {
        uploadedBytes.delete(index)
        failures.push({
          name: file.name,
          message: error instanceof Error ? error.message : 'Erro inesperado durante o upload.',
        })
      } finally {
        completed += 1
        reportProgress()
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(UPLOAD_CONCURRENCY, photos.length) }, () => worker()),
  )

  const successfulUploads = [...uploadedPhotos.entries()]
    .sort(([firstIndex], [secondIndex]) => firstIndex - secondIndex)

  onProgress({
    completed,
    total: photos.length,
    percent: photos.length ? 90 : 100,
    phase: 'registering',
  })

  for (let offset = 0; offset < successfulUploads.length; offset += PHOTO_INSERT_BATCH_SIZE) {
    const batch = successfulUploads.slice(offset, offset + PHOTO_INSERT_BATCH_SIZE)
    const rows = batch.map(([index, stored]) => {
      const { file, metadata, classification } = photos[index]
      const cameraLabel = [metadata.cameraMake, metadata.cameraModel].filter(Boolean).join(' ').trim()
      return {
        id: stored.id,
        owner_id: userId,
        event_id: row.id,
        original_name: file.name,
        storage_path: stored.path,
        content_type: file.type,
        byte_size: file.size,
        burst_id: classification.burstId,
        burst_category: classification.category,
        burst_position: classification.burstPosition,
        burst_size: classification.burstSize,
        captured_at: metadata.capturedAtMs === null
          ? null
          : new Date(metadata.capturedAtMs).toISOString(),
        camera_label: cameraLabel || null,
        review_reason: classification.reviewReason,
        sha256: metadata.sha256,
      }
    })
    const { error: insertError } = await client.from('photos').insert(rows)

    if (insertError) {
      for (let cleanupOffset = 0; cleanupOffset < batch.length; cleanupOffset += 100) {
        const cleanupBatch = batch.slice(cleanupOffset, cleanupOffset + 100)
        const { error: cleanupError } = await client.storage
          .from(STORAGE_BUCKET)
          .remove(cleanupBatch.map(([, stored]) => stored.path))

        cleanupBatch.forEach(([index, stored]) => {
          const file = photos[index].file
          failures.push({
            name: file.name,
            message: cleanupError
              ? `O registro falhou (${insertError.message}) e o arquivo também não pôde ser removido (${cleanupError.message}): ${stored.path}`
              : `O registro falhou (${insertError.message}); o arquivo enviado foi removido.`,
          })
          uploadedPhotos.delete(index)
        })
      }
    } else {
      uploadedCount += batch.length
    }

    onProgress({
      completed: Math.min(offset + batch.length, successfulUploads.length),
      total: photos.length,
      percent: successfulUploads.length
        ? 90 + Math.floor((Math.min(offset + batch.length, successfulUploads.length) / successfulUploads.length) * 10)
        : 100,
      phase: 'registering',
    })
  }

  const firstUploaded = [...uploadedPhotos.entries()]
    .sort(([firstIndex], [secondIndex]) => firstIndex - secondIndex)[0]?.[1]
  let statusError: string | undefined
  const finalStatus = uploadedCount
    ? failures.length ? 'error' : 'ready'
    : failures.length ? 'error' : 'waiting'

  if (failures.length) {
    const { data: updatedEvent, error: statusUpdateError } = await client
      .from('events')
      .update({ status: 'error' })
      .eq('id', row.id)
      .select('id')
      .maybeSingle()
    if (statusUpdateError) {
      statusError = `Não foi possível marcar a corrida com falhas: ${statusUpdateError.message}`
    } else if (!updatedEvent) {
      statusError = 'A corrida teve falhas no envio, mas não foi possível confirmar seu estado.'
    }
  }

  let coverPhotoUrl: string | undefined
  let coverError: string | undefined

  if (firstUploaded) {
    const { data: updatedEvent, error: coverUpdateError } = await client
      .from('events')
      .update({ cover_photo_id: firstUploaded.id })
      .eq('id', row.id)
      .select('id')
      .maybeSingle()

    if (coverUpdateError) {
      coverError = `Não foi possível registrar a capa da corrida: ${coverUpdateError.message}`
    } else if (!updatedEvent) {
      coverError = 'A corrida foi cadastrada, mas não foi possível confirmar a capa.'
    } else {
      const { data: signedCover, error: coverSigningError } = await client
        .storage
        .from(STORAGE_BUCKET)
        .createSignedUrl(firstUploaded.path, 15 * 60)

      if (coverSigningError) {
        coverError = `A capa foi registrada, mas não foi possível exibi-la: ${coverSigningError.message}`
      } else {
        coverPhotoUrl = signedCover.signedUrl
      }
    }
  }

  return {
    event: mapEvent(
      {
        ...row,
        photo_count: uploadedCount,
        cover_photo_id: firstUploaded?.id ?? null,
        status: finalStatus,
      },
      coverPhotoUrl,
    ),
    uploadedCount,
    failures,
    ...(coverError ? { coverError } : {}),
    ...(statusError ? { statusError } : {}),
  }
}

export async function deleteCloudEvent(eventId: string): Promise<void> {
  const client = requireSupabase()
  const pageSize = 1000
  let offset = 0

  while (true) {
    const { data: photos, error: listError } = await client
      .from('photos')
      .select('storage_path')
      .eq('event_id', eventId)
      .order('created_at', { ascending: true })
      .range(offset, offset + pageSize - 1)

    if (listError) {
      throw new Error(`Não foi possível preparar a exclusão do evento: ${listError.message}`)
    }

    const paths = photos.map((photo) => photo.storage_path)
    for (let index = 0; index < paths.length; index += 100) {
      const { error } = await client.storage.from(STORAGE_BUCKET).remove(paths.slice(index, index + 100))
      if (error) {
        throw new Error(
          `A exclusão dos arquivos falhou. O evento e seus registros foram preservados para permitir nova tentativa: ${error.message}`,
        )
      }
    }

    if (photos.length < pageSize) break
    offset += photos.length
  }

  const { data, error } = await client
    .from('events')
    .delete()
    .eq('id', eventId)
    .select('id')
    .maybeSingle()

  if (error) {
    throw new Error(
      `Os arquivos foram removidos, mas o registro do evento não pôde ser removido. Tente novamente: ${error.message}`,
    )
  }
  if (!data) throw new Error('Evento não encontrado ou sem permissão para exclusão.')
}
