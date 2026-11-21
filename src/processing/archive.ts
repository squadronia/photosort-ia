import { BlobReader, BlobWriter, ZipWriter } from '@zip.js/zip.js'
import type { BurstOrganization, PhotoMetadata, ReviewPhoto } from './burstOrganizer'
import { buildProcessingReport } from './burstOrganizer'

type WritableFileHandle = {
  createWritable(): Promise<WritableStream<Uint8Array>>
  getFile?(): Promise<File>
}

type OriginPrivateDirectory = {
  getFileHandle(name: string, options: { create: boolean }): Promise<WritableFileHandle>
  removeEntry(name: string): Promise<void>
}

type StorageManagerWithDirectory = StorageManager & {
  getDirectory?: () => Promise<OriginPrivateDirectory>
}

type FileSystemFileHandleConstructor = {
  prototype?: {
    createWritable?: unknown
  }
}

type ArchiveSink = {
  write(chunk: Uint8Array): Promise<void>
  close(): Promise<void>
  abort(reason?: unknown): Promise<void>
}

type SaveFilePickerOptions = {
  suggestedName: string
  types: Array<{
    description: string
    accept: Record<string, string[]>
  }>
}

type SaveFilePickerWindow = Window & {
  showSaveFilePicker?: (options: SaveFilePickerOptions) => Promise<WritableFileHandle>
  FileSystemFileHandle?: FileSystemFileHandleConstructor
}

async function createArchiveFileStream(
  picker: NonNullable<SaveFilePickerWindow['showSaveFilePicker']>,
): Promise<WritableStream<Uint8Array>> {
  try {
    const fileHandle = await picker.call(window, {
      suggestedName: 'PHOTOSORT.zip',
      types: [{ description: 'Arquivo ZIP', accept: { 'application/zip': ['.zip'] } }],
    })
    return await fileHandle.createWritable()
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error

    const detail = error instanceof Error ? ` Detalhe do navegador: ${error.message}` : ''
    throw new Error(
      `O navegador não conseguiu iniciar a gravação direta do ZIP. Verifique a permissão de gravação e o espaço livre; se o PhotoSort estiver em uma prévia ou iframe, abra-o em uma aba normal do Chrome ou Edge atualizado. Nenhum ZIP foi concluído.${detail}`,
    )
  }
}

export type ArchiveProgress = {
  completedBytes: number
  totalBytes: number
  percent: number
  currentName: string
}

export type ArchiveEntry = {
  path: string
  file: File
  photo: PhotoMetadata
}

const ROOT = 'PHOTOSORT'
const TEMPORARY_ARCHIVE_NAME = 'photosort-export.zip'

export type ArchiveDownloadMode = 'picker' | 'finder' | 'blob'

export function getArchiveDownloadMode(): ArchiveDownloadMode {
  const browserWindow = window as SaveFilePickerWindow
  const userAgent = browserWindow.navigator?.userAgent ?? ''
  const isVsCodeBrowser = userAgent.includes('Code/') && userAgent.includes('Electron/')

  if (isVsCodeBrowser) return 'blob'
  if (browserWindow.isSecureContext && typeof browserWindow.showSaveFilePicker === 'function') return 'picker'

  const storage = browserWindow.navigator.storage as StorageManagerWithDirectory | undefined
  const fileHandleConstructor = browserWindow.FileSystemFileHandle
  if (
    browserWindow.isSecureContext &&
    typeof storage?.getDirectory === 'function' &&
    typeof fileHandleConstructor?.prototype?.createWritable === 'function'
  ) {
    return 'finder'
  }

  return 'blob'
}

export function canSaveArchiveToDisk(): boolean {
  return getArchiveDownloadMode() !== 'blob'
}

function safeFileName(name: string): string {
  const sanitized = Array.from(name, (character) => {
    const code = character.charCodeAt(0)
    return code < 32 || /[<>:"/\\|?*]/.test(character) ? '_' : character
  }).join('')
    .replace(/^\.+/, '')
    .trim()
  return sanitized || 'fotografia'
}

function uniquePath(path: string, seen: Set<string>): string {
  if (!seen.has(path)) {
    seen.add(path)
    return path
  }
  const slash = path.lastIndexOf('/')
  const directory = path.slice(0, slash + 1)
  const fileName = path.slice(slash + 1)
  const dot = fileName.lastIndexOf('.')
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName
  const extension = dot > 0 ? fileName.slice(dot) : ''
  let suffix = 2
  let candidate = `${directory}${stem} (${suffix})${extension}`
  while (seen.has(candidate)) {
    suffix += 1
    candidate = `${directory}${stem} (${suffix})${extension}`
  }
  seen.add(candidate)
  return candidate
}

export function createArchiveEntries(
  result: BurstOrganization,
  filesById: ReadonlyMap<string, File>,
): ArchiveEntry[] {
  const entries: ArchiveEntry[] = []

  const addPhoto = (photo: PhotoMetadata, directory: string) => {
    const file = filesById.get(photo.id)
    if (!file) throw new Error(`O arquivo original "${photo.name}" não está disponível nesta sessão.`)
    entries.push({
      path: `${ROOT}/${directory}/${safeFileName(photo.name)}`,
      file,
      photo,
    })
  }

  for (const burst of result.bursts) {
    for (const photo of burst.selected) addPhoto(photo, `FOTOS_COMPLETAS/${burst.id}`)
    for (const photo of burst.excess) addPhoto(photo, `FOTOS_EXCEDENTES/${burst.id}`)
  }

  const reviewDirectories: Record<ReviewPhoto['reason'], string> = {
    missing_capture_time: 'REVISAO/SEM_DATA_DE_CAPTURA',
    invalid_metadata: 'REVISAO/METADADOS_INVALIDOS',
    ambiguous_sequence: 'REVISAO/SEQUENCIA_AMBIGUA',
  }
  for (const item of result.review) addPhoto(item.photo, reviewDirectories[item.reason])

  const seenPaths = new Set<string>()
  return entries.map((entry) => ({
    ...entry,
    path: uniquePath(entry.path, seenPaths),
  }))
}

function archiveDirectories(result: BurstOrganization): string[] {
  return [
    `${ROOT}/`,
    `${ROOT}/FOTOS_COMPLETAS/`,
    `${ROOT}/FOTOS_EXCEDENTES/`,
    `${ROOT}/REVISAO/`,
    `${ROOT}/REVISAO/SEM_DATA_DE_CAPTURA/`,
    `${ROOT}/REVISAO/METADADOS_INVALIDOS/`,
    `${ROOT}/REVISAO/SEQUENCIA_AMBIGUA/`,
    ...result.bursts.flatMap((burst) => [
      ...(burst.selected.length ? [`${ROOT}/FOTOS_COMPLETAS/${burst.id}/`] : []),
      ...(burst.excess.length ? [`${ROOT}/FOTOS_EXCEDENTES/${burst.id}/`] : []),
    ]),
  ]
}

async function populateArchive<Type>(
  writer: ZipWriter<Type>,
  result: BurstOrganization,
  entries: ArchiveEntry[],
  totalBytes: number,
  signal: AbortSignal,
  onProgress: (progress: ArchiveProgress) => void,
): Promise<Type> {
  for (const directory of archiveDirectories(result)) {
    if (signal.aborted) throw new DOMException('Exportação cancelada.', 'AbortError')
    await writer.add(directory, new BlobReader(new Blob()), { directory: true, level: 0 })
  }

  let completedBytes = 0
  for (const entry of entries) {
    if (signal.aborted) throw new DOMException('Exportação cancelada.', 'AbortError')
    await writer.add(entry.path, new BlobReader(entry.file), {
      level: 0,
      zip64: true,
      signal,
      onprogress(progress) {
        const currentBytes = Math.min(progress, entry.file.size)
        onProgress({
          completedBytes: completedBytes + currentBytes,
          totalBytes,
          percent: totalBytes === 0
            ? 100
            : Math.min(99, Math.floor(((completedBytes + currentBytes) / totalBytes) * 100)),
          currentName: entry.photo.name,
        })
      },
    })
    completedBytes += entry.file.size
    onProgress({
      completedBytes,
      totalBytes,
      percent: totalBytes === 0 ? 99 : Math.min(99, Math.floor((completedBytes / totalBytes) * 100)),
      currentName: entry.photo.name,
    })
  }

  const report = new Blob([buildProcessingReport(result)], { type: 'text/plain;charset=utf-8' })
  await writer.add(`${ROOT}/RELATORIO.txt`, new BlobReader(report), { level: 0 })
  if (signal.aborted) throw new DOMException('Exportação cancelada.', 'AbortError')

  const archive = await writer.close(undefined, { zip64: true })
  onProgress({
    completedBytes: totalBytes,
    totalBytes,
    percent: 100,
    currentName: '',
  })
  return archive
}

export async function buildArchiveBlob(
  result: BurstOrganization,
  filesById: ReadonlyMap<string, File>,
  signal: AbortSignal,
  onProgress: (progress: ArchiveProgress) => void,
): Promise<Blob> {
  const entries = createArchiveEntries(result, filesById)
  const totalBytes = entries.reduce((total, entry) => total + entry.file.size, 0)
  const blobWriter = new BlobWriter('application/zip')
  const writer = new ZipWriter<Blob>(blobWriter, { level: 0, zip64: true })
  return populateArchive(writer, result, entries, totalBytes, signal, onProgress)
}

export function downloadArchiveFile(blob: Blob, fileName = 'PHOTOSORT.zip'): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} ${units[unitIndex]}`
}

async function createFinderArchiveStream(
  totalBytes: number,
  entryCount: number,
): Promise<{ stream: WritableStream<Uint8Array>; directory: OriginPrivateDirectory; fileHandle: WritableFileHandle }> {
  const storage = window.navigator.storage as StorageManagerWithDirectory | undefined
  if (typeof storage?.getDirectory !== 'function') {
    throw new Error('O Safari não disponibilizou o armazenamento local necessário para montar o ZIP.')
  }

  const requiredBytes = totalBytes + Math.max(1_048_576, entryCount * 1024)
  const estimate = await storage.estimate()
  if (
    typeof estimate.quota === 'number' &&
    typeof estimate.usage === 'number' &&
    estimate.quota - estimate.usage < requiredBytes
  ) {
    throw new Error(
      `Não há espaço local suficiente para montar o ZIP temporário no Safari. Libere espaço no dispositivo; são necessários aproximadamente ${formatBytes(requiredBytes)} para esta exportação.`,
    )
  }

  try {
    const directory = await storage.getDirectory()
    const fileHandle = await directory.getFileHandle(TEMPORARY_ARCHIVE_NAME, { create: true })
    if (typeof fileHandle.createWritable !== 'function' || typeof fileHandle.getFile !== 'function') {
      throw new Error('A gravação de arquivos temporários não está disponível nesta versão do Safari.')
    }
    return { stream: await fileHandle.createWritable(), directory, fileHandle }
  } catch (error) {
    const detail = error instanceof Error ? ` Detalhe do navegador: ${error.message}` : ''
    throw new Error(
      `O Safari não conseguiu preparar o ZIP temporário. Atualize o Safari e verifique o espaço livre no Mac.${detail}`,
    )
  }
}

export async function removeTemporaryArchive(): Promise<void> {
  const storage = window.navigator.storage as StorageManagerWithDirectory | undefined
  if (typeof storage?.getDirectory !== 'function') {
    throw new Error('O armazenamento temporário não está disponível neste navegador.')
  }
  const directory = await storage.getDirectory()
  await directory.removeEntry(TEMPORARY_ARCHIVE_NAME)
}

export async function writeBurstArchive(
  result: BurstOrganization,
  filesById: ReadonlyMap<string, File>,
  signal: AbortSignal,
  onProgress: (progress: ArchiveProgress) => void,
): Promise<File | null> {
  const entries = createArchiveEntries(result, filesById)
  const totalBytes = entries.reduce((total, entry) => total + entry.file.size, 0)
  const downloadMode = getArchiveDownloadMode()
  const picker = downloadMode === 'picker'
    ? (window as SaveFilePickerWindow).showSaveFilePicker
    : undefined
  let blobWriter: BlobWriter | null = null
  let sink: ArchiveSink | null = null
  let output: WritableStream<Uint8Array> | null = null
  let originPrivateDirectory: OriginPrivateDirectory | null = null
  let originPrivateFileHandle: WritableFileHandle | null = null

  if (picker) {
    const fileStream = await createArchiveFileStream(picker)
    const fileWriter = fileStream.getWriter()
    sink = fileWriter
    output = new WritableStream<Uint8Array>({
      write(chunk) {
        return fileWriter.write(chunk)
      },
      close() {
        return fileWriter.close()
      },
      abort(reason) {
        return fileWriter.abort(reason)
      },
    })
  } else if (downloadMode === 'finder') {
    const temporaryArchive = await createFinderArchiveStream(totalBytes, entries.length)
    originPrivateDirectory = temporaryArchive.directory
    originPrivateFileHandle = temporaryArchive.fileHandle
    const fileWriter = temporaryArchive.stream.getWriter()
    sink = fileWriter
    output = new WritableStream<Uint8Array>({
      write(chunk) {
        return fileWriter.write(chunk)
      },
      close() {
        return fileWriter.close()
      },
      abort(reason) {
        return fileWriter.abort(reason)
      },
    })
  } else {
    blobWriter = new BlobWriter('application/zip')
  }


  try {
    if (blobWriter) {
      const archive = await populateArchive(
        new ZipWriter<Blob>(blobWriter, { level: 0, zip64: true }),
        result,
        entries,
        totalBytes,
        signal,
        onProgress,
      )
      downloadArchiveFile(archive)
    } else {
      if (!output) throw new Error('O destino para o arquivo ZIP não foi criado.')
      await populateArchive(
        new ZipWriter<void>(output, { level: 0, zip64: true }),
        result,
        entries,
        totalBytes,
        signal,
        onProgress,
      )
      if (downloadMode === 'finder') {
        if (!originPrivateFileHandle?.getFile) {
          throw new Error('O Safari concluiu o ZIP, mas não conseguiu prepará-lo para download.')
        }
        return await originPrivateFileHandle.getFile()
      }
    }
    return null
  } catch (error) {
    if (sink) {
      try {
        await sink.abort(error)
      } catch (abortError) {
        console.error('Não foi possível interromper a gravação do ZIP após uma falha.', abortError)
      }
    }
    if (originPrivateDirectory) {
      try {
        await originPrivateDirectory.removeEntry(TEMPORARY_ARCHIVE_NAME)
      } catch (cleanupError) {
        console.error('Não foi possível remover o ZIP temporário incompleto.', cleanupError)
      }
    }
    throw error
  }
}
