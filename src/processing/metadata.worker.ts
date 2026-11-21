import type { PhotoMetadata } from './burstOrganizer'
import { readPhotoMetadata } from './exif'
import { hashBlob } from './fileHash'
import type { WorkerRequest, WorkerResponse } from './workerProtocol'

type WorkerScope = {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null
  postMessage(message: WorkerResponse): void
}

const scope = self as unknown as WorkerScope
const cancelledRequests = new Set<string>()

async function processFiles(requestId: string, files: File[], includeHash: boolean): Promise<void> {
  const photos: PhotoMetadata[] = []
  const totalBytes = files.reduce((total, file) => total + file.size, 0)
  let completedBytes = 0

  for (let index = 0; index < files.length; index += 1) {
    if (cancelledRequests.has(requestId)) {
      cancelledRequests.delete(requestId)
      scope.postMessage({ type: 'cancelled', requestId })
      return
    }

    const file = files[index]
    scope.postMessage({
      type: 'progress',
      requestId,
      completed: index,
      total: files.length,
      completedBytes,
      totalBytes,
      currentName: file.name,
    })
    let photo = await readPhotoMetadata(file, `photo-${index}`)
    if (cancelledRequests.has(requestId)) {
      cancelledRequests.delete(requestId)
      scope.postMessage({ type: 'cancelled', requestId })
      return
    }

    if (includeHash) {
      try {
        const digest = await hashBlob(file, {
          isCancelled: () => cancelledRequests.has(requestId),
          onProgress: (bytes) => {
            scope.postMessage({
              type: 'progress',
              requestId,
              completed: index,
              total: files.length,
              completedBytes: completedBytes + bytes,
              totalBytes,
              currentName: file.name,
            })
          },
        })
        photo = { ...photo, sha256: digest, hashError: null }
      } catch (error) {
        photo = {
          ...photo,
          hashError: error instanceof Error ? error.message : 'Não foi possível verificar duplicidade.',
        }
      }
    }

    if (cancelledRequests.has(requestId)) {
      cancelledRequests.delete(requestId)
      scope.postMessage({ type: 'cancelled', requestId })
      return
    }

    photos.push(photo)
    completedBytes += file.size
    scope.postMessage({
      type: 'progress',
      requestId,
      completed: index + 1,
      total: files.length,
      completedBytes,
      totalBytes,
      currentName: file.name,
    })
  }

  cancelledRequests.delete(requestId)
  scope.postMessage({ type: 'complete', requestId, photos })
}

scope.onmessage = (event) => {
  const request = event.data
  if (request.type === 'cancel') {
    cancelledRequests.add(request.requestId)
    return
  }

  void processFiles(request.requestId, request.files, request.includeHash !== false).catch((error: unknown) => {
    cancelledRequests.delete(request.requestId)
    scope.postMessage({
      type: 'error',
      requestId: request.requestId,
      message: error instanceof Error ? error.message : 'Falha ao analisar os arquivos.',
    })
  })
}
