import type { BurstOrganization, PhotoMetadata } from './burstOrganizer'

const DATABASE_NAME = 'photosort-local-processing'
const DATABASE_VERSION = 1
const SESSION_STORE = 'sessions'
const FILE_STORE = 'files'

export type SelectedPhotoFile = {
  id: string
  file: File
}

export type LocalSessionSnapshot = {
  fileIds: string[]
  maxGapSeconds: string
  ignoredFiles: number
  metadata: PhotoMetadata[]
  result: BurstOrganization | null
  archiveComplete: boolean
}

export type LoadedLocalSession = LocalSessionSnapshot & {
  files: SelectedPhotoFile[]
  updatedAt: number
}

type StoredSession = LocalSessionSnapshot & {
  userId: string
  updatedAt: number
}

type StoredFile = {
  key: string
  userId: string
  id: string
  order: number
  file: File
}

export type LocalSaveProgress = {
  completedFiles: number
  totalFiles: number
  completedBytes: number
  totalBytes: number
}

type SaveOptions = {
  addedFiles?: SelectedPhotoFile[]
  replaceFiles?: boolean
  onFileProgress?: (progress: LocalSaveProgress) => void
}

let databasePromise: Promise<IDBDatabase> | null = null

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Falha ao acessar o armazenamento local.'))
  })
}

function transactionResult(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error ?? new Error('A gravação local foi cancelada.'))
    transaction.onerror = () => reject(transaction.error ?? new Error('Falha ao gravar os dados locais.'))
  })
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('Este navegador não oferece armazenamento local compatível para salvar o processamento.'))
  }
  if (databasePromise) return databasePromise

  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      database.createObjectStore(SESSION_STORE, { keyPath: 'userId' })
      const files = database.createObjectStore(FILE_STORE, { keyPath: 'key' })
      files.createIndex('byUserId', 'userId', { unique: false })
    }
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close()
      resolve(request.result)
    }
    request.onerror = () => reject(request.error ?? new Error('Não foi possível abrir o armazenamento local.'))
    request.onblocked = () => reject(new Error('O armazenamento local está ocupado por outra aba. Feche outras abas do PhotoSort e tente novamente.'))
  }).catch((error: unknown) => {
    databasePromise = null
    throw error
  })

  databasePromise = opening
  return opening
}

function deleteUserFiles(store: IDBObjectStore, userId: string): void {
  const request = store.index('byUserId').openCursor(IDBKeyRange.only(userId))
  request.onsuccess = () => {
    const cursor = request.result
    if (!cursor) return
    store.delete(cursor.primaryKey)
    cursor.continue()
  }
}

function validateSnapshot(snapshot: LocalSessionSnapshot, files: SelectedPhotoFile[]): void {
  if (!Number.isInteger(snapshot.ignoredFiles) || snapshot.ignoredFiles < 0) {
    throw new Error('A contagem de arquivos ignorados não é válida.')
  }

  const ids = new Set(snapshot.fileIds)
  if (ids.size !== snapshot.fileIds.length) {
    throw new Error('A seleção contém identificadores de arquivo repetidos.')
  }
  if (files.some((item) => !ids.has(item.id))) {
    throw new Error('Não foi possível relacionar todos os arquivos selecionados ao salvamento.')
  }
}

export async function saveLocalSession(
  userId: string,
  snapshot: LocalSessionSnapshot,
  options: SaveOptions = {},
): Promise<number> {
  if (!userId.trim()) throw new Error('Não foi possível identificar a conta para salvar o processamento.')
  const addedFiles = options.addedFiles ?? []
  validateSnapshot(snapshot, addedFiles)
  if (options.replaceFiles && addedFiles.length !== snapshot.fileIds.length) {
    throw new Error('A substituição local precisa incluir todos os arquivos da seleção.')
  }

  const database = await openDatabase()
  const transaction = database.transaction([SESSION_STORE, FILE_STORE], 'readwrite')
  const completion = transactionResult(transaction)
  const session: StoredSession = {
    ...snapshot,
    userId,
    updatedAt: Date.now(),
  }

  try {
    const fileStore = transaction.objectStore(FILE_STORE)
    if (options.replaceFiles) deleteUserFiles(fileStore, userId)

    const totalBytes = addedFiles.reduce((total, item) => total + item.file.size, 0)
    let completedFiles = 0
    let completedBytes = 0
    let lastReportedPercent = -1
    for (const item of addedFiles) {
      const order = snapshot.fileIds.indexOf(item.id)
      if (order < 0) throw new Error('Um arquivo novo não pertence à seleção que será salva.')
      const request = fileStore.put({
        key: `${userId}:${item.id}`,
        userId,
        id: item.id,
        order,
        file: item.file,
      } satisfies StoredFile)
      request.addEventListener('success', () => {
        completedFiles += 1
        completedBytes += item.file.size
        const percent = totalBytes > 0
          ? Math.floor((completedBytes / totalBytes) * 100)
          : Math.floor((completedFiles / addedFiles.length) * 100)
        if (percent === lastReportedPercent) return
        lastReportedPercent = percent
        options.onFileProgress?.({
          completedFiles,
          totalFiles: addedFiles.length,
          completedBytes,
          totalBytes,
        })
      }, { once: true })
    }
    transaction.objectStore(SESSION_STORE).put(session)
  } catch (error) {
    transaction.abort()
    await completion.catch(() => undefined)
    throw error
  }

  await completion
  return session.updatedAt
}

export async function loadLocalSession(userId: string): Promise<LoadedLocalSession | null> {
  if (!userId.trim()) throw new Error('Não foi possível identificar a conta para carregar o processamento.')

  const database = await openDatabase()
  const transaction = database.transaction([SESSION_STORE, FILE_STORE], 'readonly')
  const completion = transactionResult(transaction)
  const sessionRequest = transaction.objectStore(SESSION_STORE).get(userId) as IDBRequest<StoredSession | undefined>
  const filesRequest = transaction
    .objectStore(FILE_STORE)
    .index('byUserId')
    .getAll(IDBKeyRange.only(userId)) as IDBRequest<StoredFile[]>

  const [session, storedFiles] = await Promise.all([
    requestResult(sessionRequest),
    requestResult(filesRequest),
    completion,
  ] as const)

  if (!session) {
    if (storedFiles.length) {
      throw new Error('Há arquivos locais sem um registro de processamento. Limpe os dados do site ou contate o suporte.')
    }
    return null
  }

  const filesById = new Map(storedFiles.map((item) => [item.id, item]))
  const files = session.fileIds.map((id) => {
    const stored = filesById.get(id)
    if (!stored) {
      throw new Error('Nem todos os arquivos salvos estão disponíveis neste navegador. Não limpe os dados do site; selecione novamente os arquivos ausentes.')
    }
    return { id: stored.id, file: stored.file }
  })

  if (files.length !== storedFiles.length) {
    throw new Error('A lista de arquivos salvos não corresponde ao processamento. Não limpe os dados do site; contate o suporte.')
  }
  if (
    session.result &&
    (session.metadata.length !== files.length || session.result.summary.totalPhotos !== files.length)
  ) {
    throw new Error('O resultado salvo não corresponde às fotografias disponíveis neste navegador.')
  }

  return {
    ...session,
    files,
  }
}
