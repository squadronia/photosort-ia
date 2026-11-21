import type { PhotoMetadata } from './burstOrganizer'
import type { WorkerRequest, WorkerResponse } from './workerProtocol'

export type PhotoAnalysisProgress = Extract<WorkerResponse, { type: 'progress' }>

export async function analyzePhotoFiles(
  files: File[],
  options: {
    includeHash?: boolean
    onProgress?: (progress: PhotoAnalysisProgress) => void
    signal?: AbortSignal
  } = {},
): Promise<PhotoMetadata[]> {
  if (options.signal?.aborted) throw new DOMException('Análise cancelada.', 'AbortError')
  if (!files.length) return []

  const worker = new Worker(new URL('./metadata.worker.ts', import.meta.url), { type: 'module' })
  const requestId = crypto.randomUUID()

  return new Promise((resolve, reject) => {
    let settled = false
    const cleanup = () => {
      options.signal?.removeEventListener('abort', handleAbort)
      worker.terminate()
    }
    const finish = (error?: Error, photos?: PhotoMetadata[]) => {
      if (settled) return
      settled = true
      cleanup()
      if (error) reject(error)
      else resolve(photos ?? [])
    }
    const handleAbort = () => {
      worker.postMessage({ type: 'cancel', requestId } satisfies WorkerRequest)
    }

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data
      if (message.requestId !== requestId) return
      if (message.type === 'progress') {
        options.onProgress?.(message)
      } else if (message.type === 'complete') {
        finish(undefined, message.photos)
      } else if (message.type === 'cancelled') {
        finish(new DOMException('Análise cancelada.', 'AbortError'))
      } else {
        finish(new Error(message.message))
      }
    }

    worker.onerror = (event) => {
      finish(new Error(event.message || 'O processamento em segundo plano falhou.'))
    }

    options.signal?.addEventListener('abort', handleAbort, { once: true })
    const request: WorkerRequest = {
      type: 'process',
      requestId,
      files,
      includeHash: options.includeHash,
    }
    try {
      worker.postMessage(request)
    } catch (error) {
      finish(error instanceof Error ? error : new Error('Não foi possível iniciar a análise das fotografias.'))
    }
  })
}
