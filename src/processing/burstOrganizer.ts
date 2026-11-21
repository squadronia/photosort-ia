export const MAX_PHOTOS_PER_WINDOW = 10
export const FPS_WINDOW_MS = 1000
export const BURST_ALGORITHM_VERSION = 2

export type PhotoMetadataStatus = 'ready' | 'missing_capture_time' | 'invalid_metadata'
export type ReviewReason = 'missing_capture_time' | 'invalid_metadata' | 'ambiguous_sequence'

export type PhotoMetadata = {
  id: string
  name: string
  size: number
  status: PhotoMetadataStatus
  capturedAtMs: number | null
  captureTimeLabel: string | null
  capturePrecisionMs: number | null
  captureSource: string | null
  cameraMake: string | null
  cameraModel: string | null
  cameraSerial: string | null
  imageWidth: number | null
  imageHeight: number | null
  sha256: string | null
  hashError: string | null
  metadataError: string | null
}

export type BurstGroup = {
  id: string
  cameraLabel: string
  photos: PhotoMetadata[]
  selected: PhotoMetadata[]
  excess: PhotoMetadata[]
}

export type ReviewPhoto = {
  photo: PhotoMetadata
  reason: ReviewReason
}

export type BurstPhotoAssignment = {
  photo: PhotoMetadata
  burstId: string | null
  category: 'complete' | 'excess' | 'review'
  burstPosition: number | null
  burstSize: number | null
  reviewReason: ReviewReason | null
}

export type DuplicateGroup = {
  sha256: string
  photos: PhotoMetadata[]
}

export type BurstSummary = {
  totalPhotos: number
  processedPhotos: number
  burstCount: number
  completePhotos: number
  excessPhotos: number
  reviewPhotos: number
  burstsAtOrBelowLimit: number
  burstsOverLimit: number
  missingMetadataPhotos: number
  invalidMetadataPhotos: number
  ambiguousSequencePhotos: number
  duplicateCopies: number
  duplicateCheckUnavailable: number
}

export type BurstExcessDiagnostic = {
  photoId: string
  burstId: string
  capturedAtMs: number
  windowStartMs: number
  windowEndMs: number
  windowPhotoCount: number
  retainedPhotoCount: number
}

export type BurstOrganization = {
  bursts: BurstGroup[]
  review: ReviewPhoto[]
  duplicates: DuplicateGroup[]
  excessDiagnostics: BurstExcessDiagnostic[]
  summary: BurstSummary
  maxGapMs: number
  algorithmVersion: number
}

type CameraStream = {
  key: string
  label: string
  photos: PhotoMetadata[]
}

function normalize(value: string | null): string {
  return value?.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US') ?? ''
}

function getCameraIdentity(photo: PhotoMetadata): { key: string; label: string } | null {
  const make = normalize(photo.cameraMake)
  const model = normalize(photo.cameraModel)
  const serial = normalize(photo.cameraSerial)

  if (serial) {
    const label = [photo.cameraMake, photo.cameraModel, photo.cameraSerial]
      .filter(Boolean)
      .join(' ')
    return { key: `serial:${make}|${model}|${serial}`, label }
  }

  if (make && model) {
    return {
      key: `model:${make}|${model}`,
      label: [photo.cameraMake, photo.cameraModel].filter(Boolean).join(' '),
    }
  }

  return null
}

function captureTimestamp(photo: PhotoMetadata): number {
  if (photo.capturedAtMs === null || !Number.isFinite(photo.capturedAtMs)) {
    throw new Error(`A fotografia "${photo.name}" não tem um horário válido para classificação.`)
  }
  return photo.capturedAtMs
}

function firstTimestampAtOrAfter(photos: PhotoMetadata[], timestamp: number): number {
  let low = 0
  let high = photos.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (captureTimestamp(photos[middle]) < timestamp) low = middle + 1
    else high = middle
  }
  return low
}

function firstTimestampAfter(photos: PhotoMetadata[], timestamp: number): number {
  let low = 0
  let high = photos.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (captureTimestamp(photos[middle]) <= timestamp) low = middle + 1
    else high = middle
  }
  return low
}

function selectGreedily(photos: PhotoMetadata[], reverse: boolean): {
  selected: boolean[]
  excessDiagnostics: Array<Omit<BurstExcessDiagnostic, 'burstId'>>
  selectedCount: number
  centerScore: number
} {
  const selected = Array.from({ length: photos.length }, () => false)
  const excessDiagnostics: Array<Omit<BurstExcessDiagnostic, 'burstId'>> = []
  const active: number[] = []
  let activeStart = 0

  for (let step = 0; step < photos.length; step += 1) {
    const index = reverse ? photos.length - step - 1 : step
    const timestamp = captureTimestamp(photos[index])
    while (activeStart < active.length) {
      const activeTimestamp = captureTimestamp(photos[active[activeStart]])
      const gap = reverse ? activeTimestamp - timestamp : timestamp - activeTimestamp
      if (gap <= FPS_WINDOW_MS) break
      activeStart += 1
    }

    if (active.length - activeStart < MAX_PHOTOS_PER_WINDOW) {
      selected[index] = true
      active.push(index)
      continue
    }

    const windowStartMs = reverse
      ? timestamp
      : captureTimestamp(photos[active[activeStart]])
    const windowEndMs = windowStartMs + FPS_WINDOW_MS
    excessDiagnostics.push({
      photoId: photos[index].id,
      capturedAtMs: timestamp,
      windowStartMs,
      windowEndMs,
      windowPhotoCount:
        firstTimestampAfter(photos, windowEndMs) -
        firstTimestampAtOrAfter(photos, windowStartMs),
      retainedPhotoCount: active.length - activeStart + 1,
    })
  }

  let selectedCount = 0
  let centerScore = 0
  for (let index = 0; index < selected.length; index += 1) {
    if (!selected[index]) continue
    selectedCount += 1
    centerScore += photos.length - Math.abs(2 * index - (photos.length - 1))
  }

  return { selected, excessDiagnostics, selectedCount, centerScore }
}

function selectBurstPhotos(photos: PhotoMetadata[]): {
  selected: PhotoMetadata[]
  excess: PhotoMetadata[]
  excessDiagnostics: Array<Omit<BurstExcessDiagnostic, 'burstId'>>
} {
  const isExcess = Array.from({ length: photos.length }, () => false)
  const excessDiagnostics: Array<Omit<BurstExcessDiagnostic, 'burstId'>> = []
  for (let componentStart = 0; componentStart < photos.length;) {
    let componentEnd = componentStart + 1
    while (
      componentEnd < photos.length &&
      captureTimestamp(photos[componentEnd]) - captureTimestamp(photos[componentEnd - 1]) <= FPS_WINDOW_MS
    ) {
      componentEnd += 1
    }

    const component = photos.slice(componentStart, componentEnd)
    const firstTime = captureTimestamp(component[0])
    const lastTime = captureTimestamp(component[component.length - 1])

    if (lastTime - firstTime <= FPS_WINDOW_MS) {
      if (component.length > MAX_PHOTOS_PER_WINDOW) {
        const excessCount = component.length - MAX_PHOTOS_PER_WINDOW
        const selectedStart = Math.ceil(excessCount / 2)
        const selectedEnd = selectedStart + MAX_PHOTOS_PER_WINDOW
        for (let index = 0; index < component.length; index += 1) {
          if (index >= selectedStart && index < selectedEnd) continue
          const photo = component[index]
          const timestamp = captureTimestamp(photo)
          isExcess[componentStart + index] = true
          excessDiagnostics.push({
            photoId: photo.id,
            capturedAtMs: timestamp,
            windowStartMs: firstTime,
            windowEndMs: firstTime + FPS_WINDOW_MS,
            windowPhotoCount: component.length,
            retainedPhotoCount: component.length,
          })
        }
      }
      componentStart = componentEnd
      continue
    }

    const forward = selectGreedily(component, false)
    const reverse = selectGreedily(component, true)
    const choice = reverse.selectedCount > forward.selectedCount ||
      (reverse.selectedCount === forward.selectedCount && reverse.centerScore > forward.centerScore)
      ? reverse
      : forward
    for (let index = 0; index < component.length; index += 1) {
      isExcess[componentStart + index] = !choice.selected[index]
    }
    for (const diagnostic of choice.excessDiagnostics) {
      excessDiagnostics.push(diagnostic)
    }
    componentStart = componentEnd
  }

  return {
    selected: photos.filter((_, index) => !isExcess[index]),
    excess: photos.filter((_, index) => isExcess[index]),
    excessDiagnostics,
  }
}

function findDuplicateGroups(photos: PhotoMetadata[]): DuplicateGroup[] {
  const grouped = new Map<string, PhotoMetadata[]>()

  for (const photo of photos) {
    if (!photo.sha256) continue
    const duplicates = grouped.get(photo.sha256) ?? []
    duplicates.push(photo)
    grouped.set(photo.sha256, duplicates)
  }

  return [...grouped.entries()]
    .filter(([, duplicates]) => duplicates.length > 1)
    .map(([sha256, duplicates]) => ({ sha256, photos: duplicates }))
}

function compareCaptureTime(first: PhotoMetadata, second: PhotoMetadata): number {
  return (first.capturedAtMs ?? Number.POSITIVE_INFINITY) -
    (second.capturedAtMs ?? Number.POSITIVE_INFINITY)
}

export function organizeBursts(
  photos: PhotoMetadata[],
  maxGapMs: number,
): BurstOrganization {
  if (!Number.isFinite(maxGapMs) || maxGapMs <= 0) {
    throw new Error('O intervalo entre fotos deve ser um número maior que zero.')
  }

  const review: ReviewPhoto[] = []
  const streams = new Map<string, CameraStream>()

  for (const photo of photos) {
    if (photo.status === 'missing_capture_time') {
      review.push({ photo, reason: 'missing_capture_time' })
      continue
    }
    if (photo.status === 'invalid_metadata') {
      review.push({ photo, reason: 'invalid_metadata' })
      continue
    }
    if (photo.capturedAtMs === null || !Number.isFinite(photo.capturedAtMs)) {
      review.push({ photo, reason: 'invalid_metadata' })
      continue
    }

    const camera = getCameraIdentity(photo)
    if (!camera) {
      review.push({ photo, reason: 'ambiguous_sequence' })
      continue
    }

    const stream = streams.get(camera.key) ?? {
      key: camera.key,
      label: camera.label,
      photos: [],
    }
    stream.photos.push(photo)
    streams.set(camera.key, stream)
  }

  const unorderedBursts: Array<Omit<BurstGroup, 'id'>> = []
  const unorderedExcessDiagnostics: Array<{
    photoId: string
    capturedAtMs: number
    windowStartMs: number
    windowEndMs: number
    windowPhotoCount: number
    retainedPhotoCount: number
  }> = []

  for (const stream of streams.values()) {
    const ordered = [...stream.photos].sort((first, second) =>
      compareCaptureTime(first, second) ||
      first.name.localeCompare(second.name) ||
      first.id.localeCompare(second.id),
    )
    const streamSelection = selectBurstPhotos(ordered)
    const selectedIds = new Set(streamSelection.selected.map((photo) => photo.id))
    for (const diagnostic of streamSelection.excessDiagnostics) {
      unorderedExcessDiagnostics.push(diagnostic)
    }

    let current: PhotoMetadata[] = []

    const finishBurst = () => {
      if (!current.length) return
      unorderedBursts.push({
        cameraLabel: stream.label,
        photos: current,
        selected: current.filter((photo) => selectedIds.has(photo.id)),
        excess: current.filter((photo) => !selectedIds.has(photo.id)),
      })
      current = []
    }

    for (let index = 0; index < ordered.length;) {
      const photo = ordered[index]
      const timestamp = photo.capturedAtMs
      if (timestamp === null) {
        review.push({ photo, reason: 'invalid_metadata' })
        index += 1
        continue
      }

      const previous = current[current.length - 1]
      if (previous && timestamp - (previous.capturedAtMs ?? timestamp) > maxGapMs) {
        finishBurst()
      }
      current.push(photo)
      index += 1
    }

    finishBurst()
  }

  unorderedBursts.sort((first, second) =>
    compareCaptureTime(first.photos[0], second.photos[0]) ||
    first.cameraLabel.localeCompare(second.cameraLabel),
  )

  const bursts = unorderedBursts.map((burst, index) => ({
    ...burst,
    id: `RAJADA_${String(index + 1).padStart(4, '0')}`,
  }))
  const burstByPhotoId = new Map<string, BurstGroup>()
  for (const burst of bursts) {
    for (const photo of burst.photos) burstByPhotoId.set(photo.id, burst)
  }
  const excessDiagnostics = unorderedExcessDiagnostics.map((diagnostic) => {
    const burst = burstByPhotoId.get(diagnostic.photoId)
    if (!burst) throw new Error('Uma fotografia excedente não foi relacionada à sua rajada.')
    return { ...diagnostic, burstId: burst.id }
  })

  const missingMetadataPhotos = review.filter((item) => item.reason === 'missing_capture_time').length
  const invalidMetadataPhotos = review.filter((item) => item.reason === 'invalid_metadata').length
  const ambiguousSequencePhotos = review.filter((item) => item.reason === 'ambiguous_sequence').length
  const duplicateCheckUnavailable = photos.filter((photo) => photo.hashError !== null).length
  const duplicates = findDuplicateGroups(photos)
  const summary: BurstSummary = {
    totalPhotos: photos.length,
    processedPhotos: photos.length,
    burstCount: bursts.length,
    completePhotos: bursts.reduce((total, burst) => total + burst.selected.length, 0),
    excessPhotos: bursts.reduce((total, burst) => total + burst.excess.length, 0),
    reviewPhotos: review.length,
    burstsAtOrBelowLimit: bursts.filter((burst) => !burst.excess.length).length,
    burstsOverLimit: bursts.filter((burst) => burst.excess.length > 0).length,
    missingMetadataPhotos,
    invalidMetadataPhotos,
    ambiguousSequencePhotos,
    duplicateCopies: duplicates.reduce((total, group) => total + group.photos.length - 1, 0),
    duplicateCheckUnavailable,
  }

  if (
    summary.completePhotos + summary.excessPhotos + summary.reviewPhotos !==
    summary.totalPhotos
  ) {
    throw new Error('A classificação não preservou exatamente todas as fotografias.')
  }

  return {
    bursts,
    review,
    duplicates,
    excessDiagnostics,
    summary,
    maxGapMs,
    algorithmVersion: BURST_ALGORITHM_VERSION,
  }
}

export function logBurstDiagnostics(
  photos: PhotoMetadata[],
  result: BurstOrganization,
): void {
  const validCaptureTimePhotos = photos.filter((photo) =>
    photo.status === 'ready' &&
    photo.capturedAtMs !== null &&
    Number.isFinite(photo.capturedAtMs),
  ).length

  console.info('[PhotoSort] Resumo da análise de rajadas', {
    analyzedPhotos: photos.length,
    validCaptureTimePhotos,
    burstCount: result.summary.burstCount,
    keptPhotos: result.summary.completePhotos,
    excessPhotos: result.summary.excessPhotos,
    reviewPhotos: result.summary.reviewPhotos,
    fpsLimit: MAX_PHOTOS_PER_WINDOW,
    fpsWindowMs: FPS_WINDOW_MS,
    configuredGroupingGapMs: result.maxGapMs,
  })

  for (const burst of result.bursts) {
    const times = burst.photos.map((photo) => {
      if (photo.capturedAtMs === null) {
        throw new Error(`A fotografia "${photo.name}" não tem horário válido dentro de uma rajada.`)
      }
      return photo.capturedAtMs
    })
    const intervals = times.slice(1).map((time, index) => time - times[index])
    let minIntervalMs: number | null = null
    let maxIntervalMs: number | null = null
    for (const interval of intervals) {
      minIntervalMs = minIntervalMs === null ? interval : Math.min(minIntervalMs, interval)
      maxIntervalMs = maxIntervalMs === null ? interval : Math.max(maxIntervalMs, interval)
    }
    console.debug('[PhotoSort] Intervalos da rajada', {
      burstId: burst.id,
      camera: burst.cameraLabel,
      firstCaptureMs: times[0],
      lastCaptureMs: times[times.length - 1],
      photoCount: times.length,
      minIntervalMs,
      maxIntervalMs,
    })
  }

  for (const diagnostic of result.excessDiagnostics) {
    console.debug('[PhotoSort] Fotografia excedente', {
      photoId: diagnostic.photoId,
      burstId: diagnostic.burstId,
      capturedAtMs: diagnostic.capturedAtMs,
      reason: `Mais de ${MAX_PHOTOS_PER_WINDOW} fotografias na janela móvel de ${FPS_WINDOW_MS} ms.`,
      windowStartMs: diagnostic.windowStartMs,
      windowEndMs: diagnostic.windowEndMs,
      windowPhotoCount: diagnostic.windowPhotoCount,
      retainedPhotoCount: diagnostic.retainedPhotoCount,
    })
  }
}

export function classifyBurstPhotos(result: BurstOrganization): BurstPhotoAssignment[] {
  const assignments: BurstPhotoAssignment[] = []
  const assignedIds = new Set<string>()

  for (const burst of result.bursts) {
    const completeIds = new Set(burst.selected.map((photo) => photo.id))
    for (const [index, photo] of burst.photos.entries()) {
      if (assignedIds.has(photo.id)) throw new Error(`A fotografia "${photo.name}" foi classificada mais de uma vez.`)
      assignedIds.add(photo.id)
      assignments.push({
        photo,
        burstId: burst.id,
        category: completeIds.has(photo.id) ? 'complete' : 'excess',
        burstPosition: index + 1,
        burstSize: burst.photos.length,
        reviewReason: null,
      })
    }
  }

  for (const item of result.review) {
    if (assignedIds.has(item.photo.id)) throw new Error(`A fotografia "${item.photo.name}" foi classificada mais de uma vez.`)
    assignedIds.add(item.photo.id)
    assignments.push({
      photo: item.photo,
      burstId: null,
      category: 'review',
      burstPosition: null,
      burstSize: null,
      reviewReason: item.reason,
    })
  }

  if (assignedIds.size !== result.summary.totalPhotos) {
    throw new Error('A classificação não incluiu todas as fotografias.')
  }

  return assignments
}

export function buildProcessingReport(result: BurstOrganization): string {
  const { summary } = result
  const lines = [
    'RELATÓRIO PHOTOSORT',
    '',
    `FOTOGRAFIAS RECEBIDAS: ${summary.totalPhotos}`,
    `FOTOGRAFIAS PROCESSADAS: ${summary.processedPhotos}`,
    `RAJADAS IDENTIFICADAS: ${summary.burstCount}`,
    `FOTOS COMPLETAS: ${summary.completePhotos}`,
    `FOTOS EXCEDENTES: ${summary.excessPhotos}`,
    `FOTOS PARA REVISÃO: ${summary.reviewPhotos}`,
    `RAJADAS SEM EXCEDENTES: ${summary.burstsAtOrBelowLimit}`,
    `RAJADAS COM EXCEDENTES: ${summary.burstsOverLimit}`,
    `SEM HORÁRIO DE CAPTURA VÁLIDO: ${summary.missingMetadataPhotos}`,
    `METADADOS INVÁLIDOS: ${summary.invalidMetadataPhotos}`,
    `SEQUÊNCIAS AMBÍGUAS: ${summary.ambiguousSequencePhotos}`,
    `CÓPIAS DUPLICADAS (SHA-256): ${summary.duplicateCopies}`,
    `ARQUIVOS SEM VERIFICAÇÃO DE DUPLICIDADE: ${summary.duplicateCheckUnavailable}`,
    `INTERVALO MÁXIMO DE AGRUPAMENTO: ${(result.maxGapMs / 1000).toLocaleString('pt-BR')} s`,
    `LIMITE DE FPS: ${MAX_PHOTOS_PER_WINDOW} fotos em janela móvel de ${FPS_WINDOW_MS} ms.`,
    'Janelas incluem os extremos: [início, início + 1.000 ms]; cada foto é classificada uma única vez.',
    'Em uma sequência contida em uma janela, são mantidas as 10 posições centrais; em sobreposição, maximiza-se a seleção e prioriza-se a centralidade.',
    '',
    'As imagens originais foram preservadas sem recompressão.',
    'Nenhuma data de modificação de arquivo foi usada como horário de captura.',
    '',
    'RAJADAS',
  ]

  for (const burst of result.bursts) {
    lines.push(
      '',
      `${burst.id} | câmera: ${burst.cameraLabel || 'não identificada'} | ${burst.photos.length} foto(s)`,
      `Mantidas (${burst.selected.length}): ${burst.selected.map((photo) => photo.name).join(', ') || 'nenhuma'}`,
      `Excedentes (${burst.excess.length}): ${burst.excess.map((photo) => photo.name).join(', ') || 'nenhuma'}`,
    )
  }

  lines.push('', 'REVISÃO')
  for (const item of result.review) {
    const reason = {
      missing_capture_time: 'sem data de captura',
      invalid_metadata: 'metadados inválidos',
      ambiguous_sequence: 'sequência ambígua',
    }[item.reason]
    lines.push(`${item.photo.name} — ${reason}`)
  }

  lines.push('', 'ARQUIVOS DUPLICADOS')
  if (!result.duplicates.length) lines.push('Nenhuma cópia exata encontrada.')
  for (const group of result.duplicates) {
    lines.push(`${group.photos.map((photo) => photo.name).join(' | ')} — SHA-256 ${group.sha256}`)
  }

  return lines.join('\r\n')
}
