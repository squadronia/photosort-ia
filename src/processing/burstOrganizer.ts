export const MAX_PHOTOS_PER_BURST = 10

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

export type BurstOrganization = {
  bursts: BurstGroup[]
  review: ReviewPhoto[]
  duplicates: DuplicateGroup[]
  summary: BurstSummary
  maxGapMs: number
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

function selectBurstPhotos(photos: PhotoMetadata[]): {
  selected: PhotoMetadata[]
  excess: PhotoMetadata[]
} {
  if (photos.length <= MAX_PHOTOS_PER_BURST) {
    return { selected: photos, excess: [] }
  }

  const excessCount = photos.length - MAX_PHOTOS_PER_BURST
  const start = Math.ceil(excessCount / 2)
  const end = start + MAX_PHOTOS_PER_BURST

  return {
    selected: photos.slice(start, end),
    excess: photos.filter((_, index) => index < start || index >= end),
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

  for (const stream of streams.values()) {
    const ordered = [...stream.photos].sort((first, second) =>
      compareCaptureTime(first, second) ||
      first.name.localeCompare(second.name) ||
      first.id.localeCompare(second.id),
    )
    let current: PhotoMetadata[] = []

    const finishBurst = () => {
      if (!current.length) return
      const { selected, excess } = selectBurstPhotos(current)
      unorderedBursts.push({
        cameraLabel: stream.label,
        photos: current,
        selected,
        excess,
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

      let end = index + 1
      while (end < ordered.length && ordered[end].capturedAtMs === timestamp) end += 1

      if (end - index > 1) {
        finishBurst()
        for (const tiedPhoto of ordered.slice(index, end)) {
          review.push({ photo: tiedPhoto, reason: 'ambiguous_sequence' })
        }
        index = end
        continue
      }

      const previous = current[current.length - 1]
      if (previous && timestamp - (previous.capturedAtMs ?? timestamp) > maxGapMs) {
        finishBurst()
      }
      current.push(photo)
      index = end
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
    burstsAtOrBelowLimit: bursts.filter((burst) => burst.photos.length <= MAX_PHOTOS_PER_BURST).length,
    burstsOverLimit: bursts.filter((burst) => burst.photos.length > MAX_PHOTOS_PER_BURST).length,
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

  return { bursts, review, duplicates, summary, maxGapMs }
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
    `RAJADAS COM ATÉ 10 FOTOS: ${summary.burstsAtOrBelowLimit}`,
    `RAJADAS COM MAIS DE 10 FOTOS: ${summary.burstsOverLimit}`,
    `SEM HORÁRIO DE CAPTURA VÁLIDO: ${summary.missingMetadataPhotos}`,
    `METADADOS INVÁLIDOS: ${summary.invalidMetadataPhotos}`,
    `SEQUÊNCIAS AMBÍGUAS: ${summary.ambiguousSequencePhotos}`,
    `CÓPIAS DUPLICADAS (SHA-256): ${summary.duplicateCopies}`,
    `ARQUIVOS SEM VERIFICAÇÃO DE DUPLICIDADE: ${summary.duplicateCheckUnavailable}`,
    `INTERVALO MÁXIMO DA RAJADA: ${(result.maxGapMs / 1000).toLocaleString('pt-BR')} s`,
    `SELEÇÃO ACIMA DE 10: start = ceil((N - 10) / 2); em empate, o excedente é removido do início.`,
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
