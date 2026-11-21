import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import { Activity, Archive, Check, Download, FolderOpen, Image, Upload, X } from 'lucide-react'
import {
  canSaveArchiveToDisk,
  downloadArchiveFile,
  getArchiveDownloadMode,
  removeTemporaryArchive,
  writeBurstArchive,
  type ArchiveProgress,
} from './archive'
import {
  BURST_ALGORITHM_VERSION,
  FPS_WINDOW_MS,
  MAX_PHOTOS_PER_WINDOW,
  logBurstDiagnostics,
  organizeBursts,
  type BurstOrganization,
  type PhotoMetadata,
} from './burstOrganizer'
import {
  loadLocalSession,
  saveLocalSession,
  type LocalSaveProgress,
  type SelectedPhotoFile,
} from './localSession'
import { analyzePhotoFiles } from './analyzePhotoFiles'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { estimateTemporaryMode } from './storageBudget'

type Phase = 'idle' | 'analyzing' | 'cancelling' | 'ready' | 'archiving' | 'complete'
type StorageStatus = 'loading' | 'saving' | 'saved' | 'error'

const ACCEPTED_EXTENSIONS = /\.(jpe?g|tiff?|png|webp)$/i
const BURSTS_PAGE_SIZE = 50
const REVIEW_PAGE_SIZE = 50

function isImageFile(file: File): boolean {
  return file.type.toLocaleLowerCase('en-US').startsWith('image/') || ACCEPTED_EXTENSIONS.test(file.name)
}

function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(value)} ${units[unitIndex]}`
}

function formatCaptureTime(photo: PhotoMetadata): string {
  return photo.captureTimeLabel ?? 'Horário indisponível'
}

function reviewReasonLabel(reason: string): string {
  return {
    missing_capture_time: 'Sem data de captura',
    invalid_metadata: 'Metadados inválidos',
    ambiguous_sequence: 'Sequência ambígua',
  }[reason] ?? 'Revisar'
}

export function BurstOrganizerPage({ userId }: { userId: string }) {
  const [selectedPhotos, setSelectedPhotos] = useState<SelectedPhotoFile[]>([])
  const files = selectedPhotos.map((item) => item.file)
  const [ignoredFiles, setIgnoredFiles] = useState(0)
  const [maxGapSeconds, setMaxGapSeconds] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [analysisProgress, setAnalysisProgress] = useState({
    completed: 0,
    total: 0,
    completedBytes: 0,
    totalBytes: 0,
    currentName: '',
  })
  const [archiveProgress, setArchiveProgress] = useState<ArchiveProgress | null>(null)
  const [finderArchiveFile, setFinderArchiveFile] = useState<File | null>(null)
  const [metadata, setMetadata] = useState<PhotoMetadata[]>([])
  const [result, setResult] = useState<BurstOrganization | null>(null)
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)
  const [visibleBurstCount, setVisibleBurstCount] = useState(BURSTS_PAGE_SIZE)
  const [visibleReviewCount, setVisibleReviewCount] = useState(REVIEW_PAGE_SIZE)
  const [isHydrated, setIsHydrated] = useState(false)
  const [isCheckingStorage, setIsCheckingStorage] = useState(false)
  const [isTemporaryMode, setIsTemporaryMode] = useState(false)
  const [storageStatus, setStorageStatus] = useState<StorageStatus>('loading')
  const [storageProgress, setStorageProgress] = useState<LocalSaveProgress | null>(null)
  const [storageError, setStorageError] = useState('')
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null)
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const setFileInputRef = useCallback((input: HTMLInputElement | null) => {
    fileInputRef.current = input
    input?.removeAttribute('webkitdirectory')
    input?.removeAttribute('directory')
  }, [])
  const setFolderInputRef = useCallback((input: HTMLInputElement | null) => {
    folderInputRef.current = input
    if (input) {
      input.setAttribute('webkitdirectory', '')
      input.removeAttribute('directory')
    }
  }, [])
  const analysisAbortRef = useRef<AbortController | null>(null)
  const archiveAbortRef = useRef<AbortController | null>(null)
  const selectedPhotosRef = useRef<SelectedPhotoFile[]>([])
  const ignoredFilesRef = useRef(0)
  const maxGapSecondsRef = useRef('')
  const metadataRef = useRef<PhotoMetadata[]>([])
  const resultRef = useRef<BurstOrganization | null>(null)
  const archiveCompleteRef = useRef(false)
  const hydratedRef = useRef(false)
  const temporaryModeRef = useRef(false)
  const filesNeedReplaceRef = useRef(false)
  const persistenceOperationRef = useRef(0)
  const persistenceQueueRef = useRef<Promise<void>>(Promise.resolve())
  const busy = phase === 'analyzing' || phase === 'cancelling' || phase === 'archiving'

  const persistCurrentSession = useCallback(async (options: {
    addedFiles?: SelectedPhotoFile[]
    replaceFiles?: boolean
  } = {}): Promise<boolean> => {
    if (!hydratedRef.current || temporaryModeRef.current) return false

    const operation = ++persistenceOperationRef.current
    setStorageStatus('saving')
    setStorageProgress(null)
    setStorageError('')
    let writingFiles = false
    const queuedSave = persistenceQueueRef.current.catch(() => undefined).then(async () => {
      const replaceFiles = Boolean(options.replaceFiles || filesNeedReplaceRef.current)
      const filesToSave = replaceFiles
        ? selectedPhotosRef.current
        : options.addedFiles ?? []
      writingFiles = filesToSave.length > 0 || replaceFiles
      const totalBytes = filesToSave.reduce((total, item) => total + item.file.size, 0)
      if (operation === persistenceOperationRef.current && filesToSave.length) {
        setStorageProgress({
          completedFiles: 0,
          totalFiles: filesToSave.length,
          completedBytes: 0,
          totalBytes,
        })
      }
      const updatedAt = await saveLocalSession(userId, {
        fileIds: selectedPhotosRef.current.map((item) => item.id),
        maxGapSeconds: maxGapSecondsRef.current,
        ignoredFiles: ignoredFilesRef.current,
        metadata: metadataRef.current,
        result: resultRef.current,
        archiveComplete: archiveCompleteRef.current,
      }, {
        addedFiles: filesToSave,
        replaceFiles,
        onFileProgress: (progress) => {
          if (operation === persistenceOperationRef.current) setStorageProgress(progress)
        },
      })
      if (writingFiles) filesNeedReplaceRef.current = false
      return updatedAt
    })
    const save = queuedSave.catch((reason: unknown) => {
      if (writingFiles) filesNeedReplaceRef.current = true
      throw reason
    })
    persistenceQueueRef.current = save.then(() => undefined, () => undefined)

    try {
      const updatedAt = await save
      if (operation === persistenceOperationRef.current) {
        setStorageProgress(null)
        setLastSavedAt(updatedAt)
        setStorageStatus('saved')
      }
      return true
    } catch (reason) {
      console.error('Não foi possível salvar o processamento neste navegador.', reason)
      if (operation === persistenceOperationRef.current) {
        setStorageProgress(null)
        setStorageError(reason instanceof Error ? reason.message : 'Falha ao salvar os dados locais.')
        setStorageStatus('error')
      }
      return false
    }
  }, [userId])

  useEffect(() => () => {
    analysisAbortRef.current?.abort()
    archiveAbortRef.current?.abort()
  }, [])

  useEffect(() => {
    let active = true
    hydratedRef.current = false
    temporaryModeRef.current = false

    void loadLocalSession(userId).then((session) => {
      if (!active) return

      const savedPhotos = session?.files ?? []
      const savedMetadata = session?.metadata ?? []
      let restoredResult = session?.result ?? null
      const resultNeedsRefresh = Boolean(
        restoredResult && restoredResult.algorithmVersion !== BURST_ALGORITHM_VERSION,
      )
      if (resultNeedsRefresh) {
        const savedGapMs = Number(session?.maxGapSeconds) * 1000
        restoredResult = Number.isFinite(savedGapMs) && savedGapMs > 0
          ? organizeBursts(savedMetadata, savedGapMs)
          : null
      }

      selectedPhotosRef.current = savedPhotos
      ignoredFilesRef.current = session?.ignoredFiles ?? 0
      maxGapSecondsRef.current = session?.maxGapSeconds ?? ''
      metadataRef.current = savedMetadata
      resultRef.current = restoredResult
      archiveCompleteRef.current = resultNeedsRefresh
        ? false
        : session?.archiveComplete ?? false

      setSelectedPhotos(savedPhotos)
      setIgnoredFiles(ignoredFilesRef.current)
      setMaxGapSeconds(maxGapSecondsRef.current)
      setMetadata(metadataRef.current)
      setResult(restoredResult)
      setPhase(resultRef.current
        ? archiveCompleteRef.current ? 'complete' : 'ready'
        : 'idle')
      setLastSavedAt(session?.updatedAt ?? null)
      setStorageStatus('saved')
      setIsHydrated(true)
      hydratedRef.current = true
      if (resultNeedsRefresh) void persistCurrentSession()
    }).catch((reason: unknown) => {
      if (!active) return
      console.error('Não foi possível carregar o processamento salvo neste navegador.', reason)
      setStorageError(reason instanceof Error ? reason.message : 'Falha ao carregar os dados locais.')
      setStorageStatus('error')
    })

    return () => { active = false }
  }, [userId, persistCurrentSession])

  const addFiles = async (selected: FileList | File[]) => {
    if (busy || isCheckingStorage || !hydratedRef.current || storageStatus === 'loading' || storageStatus === 'saving') {
      setError('Aguarde a verificação de espaço ou o salvamento atual terminar antes de alterar os arquivos selecionados.')
      return
    }

    const selectedFiles = Array.from(selected)
    if (!selectedFiles.length) return
    const photos = selectedFiles.filter(isImageFile)
    const skipped = selectedFiles.length - photos.length
    const addedPhotos = photos.map((file) => ({ id: crypto.randomUUID(), file }))
    const nextPhotos = [...selectedPhotosRef.current, ...addedPhotos]
    const nextIgnoredCount = ignoredFilesRef.current + skipped
    const nextTotalBytes = nextPhotos.reduce((total, item) => total + item.file.size, 0)
    let useTemporaryMode = temporaryModeRef.current

    if (addedPhotos.length && !useTemporaryMode) {
      setIsCheckingStorage(true)
      try {
        useTemporaryMode = await estimateTemporaryMode(nextTotalBytes)
      } finally {
        setIsCheckingStorage(false)
      }
    }

    if (useTemporaryMode && !canSaveArchiveToDisk()) {
      setError('O navegador encontrou fotos, mas não adicionou esta pasta: ela excede o espaço local e exige gravação por fluxo, que não está disponível neste ambiente. Use o Safari 26 ou mais recente, ou o Google Chrome ou Microsoft Edge atualizado, e selecione a pasta novamente. O contador fica em 0 para evitar iniciar um processamento que não poderá ser baixado.')
      return
    }

    selectedPhotosRef.current = nextPhotos
    ignoredFilesRef.current = nextIgnoredCount
    metadataRef.current = []
    resultRef.current = null
    archiveCompleteRef.current = false
    setFinderArchiveFile(null)
    setIgnoredFiles(nextIgnoredCount)
    setSelectedPhotos(nextPhotos)
    setMetadata([])
    setResult(null)
    setError('')
    setPhase('idle')
    if (useTemporaryMode) {
      temporaryModeRef.current = true
      setIsTemporaryMode(true)
    } else {
      void persistCurrentSession(addedPhotos.length ? { addedFiles: addedPhotos } : {})
    }

    if (skipped) {
      setError(photos.length
        ? `${skipped} arquivo(s) que não parecem ser imagem foram ignorados.`
        : `O navegador retornou ${skipped} arquivo(s), mas nenhum foi reconhecido como imagem. Selecione JPG, JPEG, TIFF, PNG, WEBP ou outro formato com tipo de imagem reconhecido.`)
    }
  }

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.currentTarget.files ?? [])
    event.currentTarget.value = ''
    if (!selected.length) {
      setError('O navegador não retornou arquivos dessa seleção. Tente escolher a pasta novamente ou arraste as imagens para a área de seleção.')
      return
    }
    void addFiles(selected)
  }

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(false)
    void addFiles(event.dataTransfer.files)
  }

  const startAnalysis = () => {
    const seconds = Number(maxGapSeconds)
    if (!hydratedRef.current || isCheckingStorage || storageStatus === 'loading' || storageStatus === 'saving') {
      setError('Aguarde até que a verificação de espaço, o carregamento ou o salvamento local termine antes de processar.')
      return
    }
    if (!files.length) {
      setError('Selecione uma pasta ou imagens antes de processar.')
      return
    }
    if (!Number.isFinite(seconds) || seconds <= 0) {
      setError('Informe um intervalo máximo maior que zero segundo.')
      return
    }

    analysisAbortRef.current?.abort()
    const controller = new AbortController()
    analysisAbortRef.current = controller
    setPhase('analyzing')
    setError('')
    setResult(null)
    setMetadata([])
    resultRef.current = null
    metadataRef.current = []
    archiveCompleteRef.current = false
    setAnalysisProgress({
      completed: 0,
      total: files.length,
      completedBytes: 0,
      totalBytes: files.reduce((total, file) => total + file.size, 0),
      currentName: '',
    })

    void analyzePhotoFiles(files, {
      includeHash: true,
      onProgress: setAnalysisProgress,
      signal: controller.signal,
    }).then((photos) => {
      try {
        const organized = organizeBursts(photos, seconds * 1000)
        logBurstDiagnostics(photos, organized)
        metadataRef.current = photos
        resultRef.current = organized
        setMetadata(photos)
        setResult(organized)
        setVisibleBurstCount(BURSTS_PAGE_SIZE)
        setVisibleReviewCount(REVIEW_PAGE_SIZE)
        setPhase('ready')
        void persistCurrentSession()
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Não foi possível classificar as fotografias.')
        setPhase('idle')
      }
    }).catch((reason: unknown) => {
      if (reason instanceof DOMException && reason.name === 'AbortError') {
        setPhase('idle')
        return
      }
      setPhase('idle')
      setError(reason instanceof Error ? reason.message : 'O processamento em segundo plano falhou.')
    }).finally(() => {
      if (analysisAbortRef.current === controller) analysisAbortRef.current = null
    })
  }

  const cancelCurrentOperation = () => {
    if (phase === 'analyzing') {
      setPhase('cancelling')
      analysisAbortRef.current?.abort()
      return
    }
    archiveAbortRef.current?.abort()
  }

  const startArchive = async () => {
    if (!result) return
    if (isTemporaryMode && !canSaveArchiveToDisk()) {
      setError('Esta seleção grande precisa de gravação por fluxo, que não está disponível neste ambiente. Use o Safari 26 ou mais recente, ou abra o PhotoSort em uma aba normal do Chrome ou Edge atualizado; os arquivos temporários desta página não podem ser transferidos.')
      setPhase('ready')
      return
    }

    const controller = new AbortController()
    archiveAbortRef.current = controller
    setFinderArchiveFile(null)
    setArchiveProgress({
      completedBytes: 0,
      totalBytes: result.summary.totalPhotos
        ? metadata.reduce((total, photo) => total + photo.size, 0)
        : 0,
      percent: 0,
      currentName: '',
    })
    setError('')
    setPhase('archiving')

    try {
      const filesById = new Map(metadata.map((photo, index) => [photo.id, files[index]]))
      const archiveFile = await writeBurstArchive(result, filesById, controller.signal, setArchiveProgress)
      setFinderArchiveFile(archiveFile)
      archiveCompleteRef.current = true
      setPhase('complete')
      await persistCurrentSession()
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') {
        setPhase('ready')
      } else {
        setError(reason instanceof Error ? reason.message : 'Não foi possível gerar o arquivo ZIP.')
        setPhase('ready')
      }
    } finally {
      archiveAbortRef.current = null
    }
  }

  const clearFiles = () => {
    analysisAbortRef.current?.abort()
    analysisAbortRef.current = null
    archiveAbortRef.current?.abort()
    selectedPhotosRef.current = []
    ignoredFilesRef.current = 0
    metadataRef.current = []
    resultRef.current = null
    archiveCompleteRef.current = false
    setFinderArchiveFile(null)
    temporaryModeRef.current = false
    setIsTemporaryMode(false)
    setSelectedPhotos([])
    setIgnoredFiles(0)
    setMetadata([])
    setResult(null)
    setAnalysisProgress({ completed: 0, total: 0, completedBytes: 0, totalBytes: 0, currentName: '' })
    setArchiveProgress(null)
    setError('')
    setPhase('idle')
    void persistCurrentSession({ replaceFiles: true })
  }

  const retryStorage = () => {
    if (!hydratedRef.current) {
      window.location.reload()
      return
    }
    void persistCurrentSession({
      addedFiles: selectedPhotosRef.current,
      replaceFiles: true,
    })
  }

  const analysisPercent = analysisProgress.totalBytes > 0
    ? Math.min(100, Math.floor(analysisProgress.completedBytes / analysisProgress.totalBytes * 100))
    : analysisProgress.total
      ? Math.floor(analysisProgress.completed / analysisProgress.total * 100)
      : 0
  const storageSavePercent = storageProgress
    ? Math.min(99, Math.floor(storageProgress.totalBytes > 0
      ? storageProgress.completedBytes / storageProgress.totalBytes * 100
      : storageProgress.totalFiles > 0
        ? storageProgress.completedFiles / storageProgress.totalFiles * 100
        : 0))
    : 0
  const totalBytes = files.reduce((total, file) => total + file.size, 0)
  const archiveDownloadMode = getArchiveDownloadMode()
  const canStreamToDisk = archiveDownloadMode !== 'blob'
  const fileControlsDisabled = !isHydrated || isCheckingStorage || busy || storageStatus === 'loading' || storageStatus === 'saving'
  const storageWarning = isTemporaryMode || storageStatus === 'error'
  const burstsToShow = result?.bursts.slice(0, visibleBurstCount) ?? []
  const reviewToShow = result?.review.slice(0, visibleReviewCount) ?? []

  return (
    <>
      <header className="page-heading burst-hero">
        <div className="burst-hero-content">
          <span className="burst-eyebrow"><Activity aria-hidden="true" size={14} /> ORGANIZAÇÃO FOTOGRÁFICA</span>
          <h1>Organizador de rajadas</h1>
          <p>Analise sequências por metadados EXIF, revise excedentes e exporte os originais em um ZIP organizado.</p>
          <div aria-label="Recursos do organizador" className="burst-hero-features">
            <span><Check aria-hidden="true" size={14} /> Processamento local</span>
            <span><Image aria-hidden="true" size={14} /> Agrupamento por EXIF</span>
            <span><Archive aria-hidden="true" size={14} /> Exportação sem recompressão</span>
          </div>
        </div>
      </header>
      <div className="notice notice-info">
        <Image size={17} />
        <span>O processamento acontece neste navegador. As imagens não são enviadas ao Supabase e não há reconhecimento facial nem avaliação estética.</span>
      </div>
      <div className={`notice ${storageWarning ? 'notice-warning' : 'notice-info'}`} role={storageWarning ? 'alert' : 'status'}>
        <Archive size={17} />
        <span>
          {isCheckingStorage
            ? 'Verificando espaço local para esta pasta…'
            : isTemporaryMode
              ? canStreamToDisk
                ? archiveDownloadMode === 'finder'
                  ? 'Modo temporário ativo: as fotos e os resultados não serão salvos. O Safari montará o ZIP no armazenamento local do site e depois permitirá baixá-lo para a pasta de downloads configurada, visível no Finder. Mantenha esta tela aberta até concluir o download.'
                  : 'Modo temporário ativo: as fotos e os resultados não serão salvos no navegador. Mantenha esta tela aberta até o ZIP ser gravado diretamente no disco; fechar ou recarregar a página descarta esta seleção.'
                : 'Esta seleção grande exige gravação por fluxo, que não está disponível neste ambiente. Use o Safari 26 ou mais recente, ou uma aba normal do Chrome ou Edge atualizado; esta seleção temporária não pode ser transferida.'
              : storageStatus === 'loading'
            ? 'Carregando os arquivos e resultados salvos para esta conta…'
            : storageStatus === 'saving'
              ? 'Salvando automaticamente os arquivos e resultados neste navegador…'
              : storageStatus === 'error'
                ? `O salvamento local não foi concluído. Você ainda pode processar e baixar o ZIP, mas os dados atuais podem desaparecer se fechar esta página. ${storageError}`
                : `Salvamento automático ativo para esta conta neste navegador. Os dados não são enviados à nuvem; limpar os dados do site também apaga essa cópia${lastSavedAt ? ` · salvo em ${new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(lastSavedAt)}` : ''}.`}
        </span>
        {storageStatus === 'error' && !isTemporaryMode && (
          <button className="text-button" onClick={retryStorage} type="button">Tentar novamente</button>
        )}
      </div>
      {storageStatus === 'saving' && (
        <div className="upload-progress" aria-live="polite" role="status">
          <div>
            <strong>{storageProgress ? 'Salvando fotos no navegador' : 'Salvando dados no navegador'}</strong>
            <span>{storageProgress
              ? `${storageProgress.completedFiles.toLocaleString('pt-BR')} de ${storageProgress.totalFiles.toLocaleString('pt-BR')} arquivos · ${formatBytes(storageProgress.completedBytes)} de ${formatBytes(storageProgress.totalBytes)} · ${storageSavePercent}%`
              : 'Aguarde a conclusão do salvamento antes de processar as imagens.'}</span>
          </div>
          {storageProgress && (
            <div className="progress-track">
              <span style={{ width: `${storageSavePercent}%` }} />
            </div>
          )}
        </div>
      )}
      <div className={`notice ${canStreamToDisk ? 'notice-info' : 'notice-warning'}`}>
        <Archive size={17} />
        <span>{archiveDownloadMode === 'picker'
          ? 'Ao baixar, o navegador abrirá a janela do sistema para escolher onde salvar o ZIP; ele será gravado diretamente, sem carregar o arquivo inteiro na memória.'
          : archiveDownloadMode === 'finder'
            ? 'No Safari, o ZIP é montado por fluxo no armazenamento local do site e, ao final, você poderá baixá-lo para a pasta configurada em Safari > Ajustes > Geral > Local de download. Esse arquivo temporário exige espaço livre adicional próximo ao tamanho do ZIP.'
            : isTemporaryMode
              ? 'Para esta seleção grande, é necessário gravar o ZIP por fluxo. Use o Safari 26 ou mais recente, ou uma aba normal do Chrome ou Edge atualizado; não feche esta página antes de decidir, pois os arquivos selecionados aqui são temporários.'
              : 'Este navegador não permite gravar ZIPs grandes por fluxo. Seleções que excedem o espaço local serão recusadas; use Safari 26 ou mais recente, Google Chrome ou Microsoft Edge atualizado.'}</span>
      </div>
      {error && <div className="notice notice-warning" role="alert">{error}</div>}

      <section className="panel burst-upload-panel">
        <div
          className={`drop-zone ${dragging ? 'drop-zone-active' : ''}`}
          onDragEnter={(event) => { event.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDragOver={(event) => event.preventDefault()}
          onDrop={onDrop}
        >
          <span className="upload-icon"><Upload size={23} /></span>
          <strong>Selecione uma pasta ou arraste fotografias</strong>
          <span>JPG, JPEG, TIFF, PNG, WEBP ou outro formato de imagem reconhecido pelo navegador.</span>
          <span>Em “Escolher pasta”, a lista pode ficar vazia porque a janela não mostra as fotos individuais. Selecione a pasta desejada e confirme em “Fazer upload” ou “Selecionar pasta”; para marcar JPG/PNG individualmente, use “Escolher imagens”.</span>
          <div className="burst-file-actions">
            <button className="button button-secondary" disabled={fileControlsDisabled} onClick={() => folderInputRef.current?.click()} type="button">
              <FolderOpen size={15} /> Escolher pasta
            </button>
            <button className="button button-secondary" disabled={fileControlsDisabled} onClick={() => fileInputRef.current?.click()} type="button">
              <Image size={15} /> Escolher imagens
            </button>
          </div>
          <input
            accept=".jpg,.jpeg,.tif,.tiff,.png,.webp,image/*"
            aria-label="Selecionar imagens"
            className="burst-hidden-input"
            disabled={fileControlsDisabled}
            multiple
            onChange={onFileChange}
            ref={setFileInputRef}
            type="file"
          />
          <input
            aria-label="Selecionar pasta de imagens"
            className="burst-hidden-input"
            disabled={fileControlsDisabled}
            multiple
            onChange={onFileChange}
            ref={setFolderInputRef}
            type="file"
          />
        </div>

        <div className="burst-selection-row">
          <div>
            <strong>{files.length.toLocaleString('pt-BR')} fotografia(s) selecionada(s)</strong>
            <span>{formatBytes(totalBytes)} no total{ignoredFiles ? ` · ${ignoredFiles} arquivo(s) não-imagem ignorado(s)` : ''}</span>
          </div>
          <button className="text-button" disabled={!files.length || fileControlsDisabled} onClick={() => setShowClearConfirm(true)} type="button">
            <X size={14} /> Limpar seleção
          </button>
        </div>

        <div className="burst-controls">
          <label className="field">
            Intervalo máximo entre fotos da mesma rajada (segundos)
            <input
              min="0.01"
              disabled={busy || isCheckingStorage || !isHydrated || storageStatus === 'loading'}
              onChange={(event) => {
                const nextValue = event.target.value
                maxGapSecondsRef.current = nextValue
                metadataRef.current = []
                resultRef.current = null
                archiveCompleteRef.current = false
                setFinderArchiveFile(null)
                setMaxGapSeconds(nextValue)
                setMetadata([])
                setResult(null)
                setPhase('idle')
                void persistCurrentSession()
              }}
              placeholder="Escolha após avaliar sua sequência"
              step="0.01"
              type="number"
              value={maxGapSeconds}
            />
          </label>
          <p>O intervalo é definido por processamento, sem valor universal predefinido. Teste com fotos reais da câmera usada.</p>
        </div>

        {phase === 'analyzing' || phase === 'cancelling' ? (
          <div className="upload-progress" aria-live="polite">
            <div>
              <strong>{phase === 'cancelling' ? 'Cancelando análise…' : 'Lendo EXIF e verificando duplicatas'}</strong>
              <span>{analysisProgress.completed.toLocaleString('pt-BR')} de {analysisProgress.total.toLocaleString('pt-BR')} fotos · {analysisPercent}%</span>
            </div>
            {analysisProgress.currentName && <span className="burst-current-file" title={analysisProgress.currentName}>{analysisProgress.currentName}</span>}
            <div className="progress-track"><span style={{ width: `${analysisPercent}%` }} /></div>
          </div>
        ) : null}

        {phase === 'archiving' && archiveProgress ? (
          <div className="upload-progress" aria-live="polite">
            <div>
              <strong>Gerando ZIP sem recomprimir as imagens</strong>
              <span>{formatBytes(archiveProgress.completedBytes)} de {formatBytes(archiveProgress.totalBytes)} · {archiveProgress.percent}%</span>
            </div>
            {archiveProgress.currentName && <span className="burst-current-file" title={archiveProgress.currentName}>{archiveProgress.currentName}</span>}
            <div className="progress-track"><span style={{ width: `${archiveProgress.percent}%` }} /></div>
          </div>
        ) : null}

        <div className="form-actions burst-actions">
          <span>Limite: {MAX_PHOTOS_PER_WINDOW} fotos por janela móvel de {FPS_WINDOW_MS / 1000} s. Excedentes e fotos ambíguas são preservados para revisão.</span>
          <div className="burst-action-buttons">
            {busy ? (
              <button className="button button-secondary" onClick={cancelCurrentOperation} type="button">
                <X size={15} /> Cancelar
              </button>
            ) : null}
            {!result ? (
              <button
                className="button button-primary"
                disabled={!files.length || busy || isCheckingStorage || storageStatus === 'loading' || storageStatus === 'saving' || !isHydrated || !(Number(maxGapSeconds) > 0)}
                onClick={startAnalysis}
                type="button"
              >
                <Check size={15} /> Processar fotos
              </button>
            ) : (
              <button
                className="button button-primary"
                disabled={busy || isCheckingStorage || storageStatus === 'saving' || storageStatus === 'loading'}
                onClick={() => void startArchive()}
                type="button"
              >
                <Archive size={15} /> {phase === 'complete' ? 'Baixar ZIP novamente' : 'Baixar arquivo ZIP'}
              </button>
            )}
            {phase === 'complete' && finderArchiveFile && (
              <>
                <button
                  className="button button-secondary"
                  onClick={() => downloadArchiveFile(finderArchiveFile)}
                  type="button"
                >
                  <Download size={15} /> Baixar para o Finder
                </button>
                <button
                  className="text-button"
                  onClick={() => {
                    void removeTemporaryArchive()
                      .then(() => setFinderArchiveFile(null))
                      .catch((reason: unknown) => {
                        setError(reason instanceof Error
                          ? reason.message
                          : 'Não foi possível liberar o ZIP temporário do navegador.')
                      })
                  }}
                  type="button"
                >
                  Liberar espaço temporário
                </button>
              </>
            )}
          </div>
        </div>
      </section>

      {result ? (
        <section className="burst-results">
          {phase === 'complete' && <div className="notice notice-info"><Check size={17} /><span>{archiveDownloadMode === 'finder' ? 'Arquivo PHOTOSORT.zip criado. Clique em “Baixar para o Finder”; o Safari usará o local de download configurado e você poderá encontrá-lo no Finder. Depois de confirmar que o download terminou, use “Liberar espaço temporário” para apagar a cópia intermediária do navegador.' : 'Arquivo PHOTOSORT.zip criado com os originais, excedentes, revisão e relatório. Se o navegador não abriu uma janela para escolher a pasta, procure o ZIP no local de downloads configurado no navegador.'}</span></div>}
          {result.summary.duplicateCheckUnavailable > 0 && (
            <div className="notice notice-warning" role="status">
              <span>{result.summary.duplicateCheckUnavailable} arquivo(s) não puderam ser verificados por SHA-256; eles continuam incluídos nos resultados.</span>
            </div>
          )}
          <div className="metric-grid burst-metric-grid">
            <MetricCard label="Fotos recebidas" value={result.summary.totalPhotos.toLocaleString('pt-BR')} hint={`${formatBytes(totalBytes)} selecionados`} />
            <MetricCard label="Rajadas identificadas" value={result.summary.burstCount.toLocaleString('pt-BR')} hint="Grupos por câmera e horário" />
            <MetricCard label="Rajadas com excedentes" value={result.summary.burstsOverLimit.toLocaleString('pt-BR')} hint="Grupos com excesso na janela móvel" />
            <MetricCard label="Fotos completas" value={result.summary.completePhotos.toLocaleString('pt-BR')} hint="Originais mantidos" />
            <MetricCard label="Fotos excedentes" value={result.summary.excessPhotos.toLocaleString('pt-BR')} hint="Imagens a mais, preservadas" />
            <MetricCard label="Fotos para revisão" value={result.summary.reviewPhotos.toLocaleString('pt-BR')} hint={`${result.summary.missingMetadataPhotos} sem data válida`} />
          </div>
          <div className="notice notice-info">
            <Check size={17} />
            <span>
              {result.summary.burstsOverLimit} rajada(s) excedente(s) (unidades) contêm {result.summary.excessPhotos} foto(s) excedente(s) no total. {result.summary.duplicateCopies} cópia(s) duplicada(s) exata(s) foram identificadas por SHA-256 e mantidas no resultado.
            </span>
          </div>

          <section className="panel burst-list-panel">
            <h2 className="section-title">Como entender o resultado</h2>
            <div className="burst-summary-help">
              <p><strong>Fotos recebidas:</strong> total de imagens aceitas nesta organização.</p>
              <p><strong>Rajadas identificadas:</strong> grupos formados por câmera e horário EXIF, usando o intervalo máximo que você definiu.</p>
              <p><strong>Fotos completas:</strong> originais mantidos sem ultrapassar {MAX_PHOTOS_PER_WINDOW} fotos em qualquer janela móvel de {FPS_WINDOW_MS} ms.</p>
              <p><strong>Rajadas com excedentes:</strong> grupos em que ao menos uma janela móvel ultrapassou o limite de {MAX_PHOTOS_PER_WINDOW} fotos.</p>
              <p><strong>Fotos excedentes:</strong> quantidade total de imagens acima do limite, preservadas na pasta de excedentes.</p>
              <p><strong>Fotos para revisão:</strong> imagens sem horário válido ou com sequência ambígua, mantidas separadas e fora das rajadas.</p>
              <p><strong>Na tabela “Rajadas identificadas”:</strong> cada linha é uma rajada; a coluna “Excedentes” mostra quantas fotos sobraram naquela unidade. O cartão “Fotos excedentes” mostra a soma de todas as linhas.</p>
            </div>
          </section>

          <section className="panel burst-list-panel">
            <div className="section-heading-row">
              <div><h2 className="section-title">Rajadas identificadas</h2><p className="muted">Cada linha representa um grupo de fotos identificado; os excedentes continuam preservados em outra pasta.</p></div>
              <span className="result-count">{result.summary.burstCount.toLocaleString('pt-BR')} rajada(s)</span>
            </div>
            {burstsToShow.length ? (
              <>
                <div className="table-scroll">
                  <table className="burst-table">
                    <thead><tr><th>Rajada</th><th>Câmera</th><th>Período</th><th>Recebidas</th><th>Completas</th><th>Fotos excedentes</th></tr></thead>
                    <tbody>
                      {burstsToShow.map((burst) => (
                        <tr key={burst.id}>
                          <td><strong>{burst.id}</strong></td>
                          <td>{burst.cameraLabel || 'Não identificada'}</td>
                          <td>{formatCaptureTime(burst.photos[0])} — {formatCaptureTime(burst.photos[burst.photos.length - 1])}</td>
                          <td>{burst.photos.length}</td>
                          <td>{burst.selected.length}</td>
                          <td>{burst.excess.length}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {visibleBurstCount < result.bursts.length && (
                  <button className="button button-secondary burst-more-button" onClick={() => setVisibleBurstCount((count) => count + BURSTS_PAGE_SIZE)} type="button">
                    Mostrar mais rajadas ({Math.min(BURSTS_PAGE_SIZE, result.bursts.length - visibleBurstCount)})
                  </button>
                )}
              </>
            ) : <p className="muted">Nenhuma rajada pôde ser formada com os metadados disponíveis.</p>}
          </section>

          <section className="panel burst-list-panel">
            <div className="section-heading-row">
              <div><h2 className="section-title">Revisão necessária</h2><p className="muted">Nenhum horário foi inventado; estes arquivos não foram unidos a rajadas.</p></div>
              <span className="result-count">{result.review.length.toLocaleString('pt-BR')} foto(s)</span>
            </div>
            {reviewToShow.length ? (
              <>
                <div className="table-scroll">
                  <table className="burst-table">
                    <thead><tr><th>Arquivo</th><th>Motivo</th><th>Horário EXIF</th></tr></thead>
                    <tbody>
                      {reviewToShow.map((item) => (
                        <tr key={item.photo.id}>
                          <td><strong title={item.photo.name}>{item.photo.name}</strong></td>
                          <td>{reviewReasonLabel(item.reason)}</td>
                          <td>{formatCaptureTime(item.photo)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {visibleReviewCount < result.review.length && (
                  <button className="button button-secondary burst-more-button" onClick={() => setVisibleReviewCount((count) => count + REVIEW_PAGE_SIZE)} type="button">
                    Mostrar mais fotos para revisão ({Math.min(REVIEW_PAGE_SIZE, result.review.length - visibleReviewCount)})
                  </button>
                )}
              </>
            ) : <p className="muted">Nenhuma foto precisa de revisão.</p>}
          </section>
          <p className="burst-accounting-note">
            Conferência: {result.summary.completePhotos} completas + {result.summary.excessPhotos} excedentes + {result.summary.reviewPhotos} para revisão = {result.summary.totalPhotos} recebidas.
          </p>
        </section>
      ) : null}
      {showClearConfirm && (
        <ConfirmDialog
          confirmLabel="Limpar processamento"
          description="As fotos selecionadas e os resultados salvos deste processamento serão removidos deste navegador. Os originais no computador e os ZIPs já baixados não serão apagados."
          onCancel={() => setShowClearConfirm(false)}
          onConfirm={() => {
            clearFiles()
            setShowClearConfirm(false)
          }}
          title="Limpar fotos e resultados?"
        />
      )}
    </>
  )
}

function MetricCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <article className="metric-card">
      <p>{label}</p>
      <strong>{value}</strong>
      <span className="metric-hint">{hint}</span>
    </article>
  )
}
