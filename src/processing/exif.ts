import { parse } from 'exifr'
import type { PhotoMetadata, PhotoMetadataStatus } from './burstOrganizer'

const EXIF_TAGS = [
  'DateTimeOriginal',
  'SubSecTimeOriginal',
  'OffsetTimeOriginal',
  'DateTimeDigitized',
  'SubSecTimeDigitized',
  'OffsetTimeDigitized',
  'DateTime',
  'SubSecTime',
  'OffsetTime',
  'Make',
  'Model',
  'BodySerialNumber',
  'SerialNumber',
  'ImageWidth',
  'ImageHeight',
  'ExifImageWidth',
  'ExifImageHeight',
]

export type ParsedTime = {
  timestampMs: number
  precisionMs: number
  label: string
}

type TimeCandidate = {
  date: unknown
  subseconds: unknown
  offset: unknown
  source: string
}

function cleanText(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const normalized = String(value).replace(/\0/g, '').trim()
  return normalized || null
}

export function findCaptureTime(tags: Record<string, unknown>): {
  parsed: ParsedTime | null
  source: string | null
  hasCaptureDate: boolean
} {
  const candidates: TimeCandidate[] = [
    {
      date: tags.DateTimeOriginal,
      subseconds: tags.SubSecTimeOriginal,
      offset: tags.OffsetTimeOriginal,
      source: 'DateTimeOriginal',
    },
    {
      date: tags.DateTimeDigitized,
      subseconds: tags.SubSecTimeDigitized,
      offset: tags.OffsetTimeDigitized,
      source: 'DateTimeDigitized',
    },
    {
      date: tags.DateTime,
      subseconds: tags.SubSecTime,
      offset: tags.OffsetTime,
      source: 'DateTime',
    },
  ]
  const hasCaptureDate = candidates.some((candidate) => cleanText(candidate.date) !== null)

  for (const candidate of candidates) {
    if (cleanText(candidate.date) === null) continue
    const parsed = parseExifDateTime(candidate.date, candidate.subseconds, candidate.offset)
    if (parsed) return { parsed, source: candidate.source, hasCaptureDate }
  }

  return { parsed: null, source: null, hasCaptureDate }
}

function parseOffset(value: string | null): number | null {
  if (!value) return null
  if (value === 'Z' || value === 'z') return 0
  const match = value.match(/^([+-])(\d{2}):?(\d{2})$/)
  if (!match) return null
  const hours = Number(match[2])
  const minutes = Number(match[3])
  if (hours > 23 || minutes > 59) return null
  const offset = (hours * 60 + minutes) * (match[1] === '+' ? 1 : -1)
  return offset
}

export function parseExifDateTime(
  dateValue: unknown,
  subsecondValue: unknown,
  offsetValue: unknown,
): ParsedTime | null {
  if (dateValue instanceof Date) {
    if (!Number.isFinite(dateValue.getTime())) return null
    const timestampMs = dateValue.getTime()
    return {
      timestampMs,
      precisionMs: 1,
      label: dateValue.toISOString().replace('T', ' ').replace('Z', ''),
    }
  }

  const rawDate = cleanText(dateValue)
  if (!rawDate) return null
  const match = rawDate.match(
    /^(\d{4})[:/-](\d{2})[:/-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:\s*(Z|[+-]\d{2}:?\d{2}))?$/i,
  )
  if (!match) return null

  const [, yearText, monthText, dayText, hourText, minuteText, secondText, inlineFraction, inlineOffset] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const hour = Number(hourText)
  const minute = Number(minuteText)
  const second = Number(secondText)
  if (
    month < 1 || month > 12 || day < 1 || day > 31 ||
    hour > 23 || minute > 59 || second > 59
  ) {
    return null
  }

  const baseMs = Date.UTC(year, month - 1, day, hour, minute, second)
  const validated = new Date(baseMs)
  if (
    validated.getUTCFullYear() !== year ||
    validated.getUTCMonth() !== month - 1 ||
    validated.getUTCDate() !== day
  ) {
    return null
  }

  const taggedFraction = cleanText(subsecondValue)?.replace(/^\./, '')
  const fraction = taggedFraction ?? inlineFraction ?? ''
  if (fraction && !/^\d+$/.test(fraction)) return null

  const fractionMs = fraction ? Number(`0.${fraction}`) * 1000 : 0
  const rawOffset = cleanText(offsetValue) ?? inlineOffset ?? null
  const offsetMinutes = parseOffset(rawOffset)
  if (rawOffset && offsetMinutes === null) return null

  const timestampMs = baseMs + fractionMs - (offsetMinutes ?? 0) * 60_000
  const label = [
    `${yearText}-${monthText}-${dayText} ${hourText}:${minuteText}:${secondText}`,
    fraction ? `.${fraction}` : '',
    rawOffset ?? '',
  ].join('')

  return {
    timestampMs,
    precisionMs: fraction ? 1000 / (10 ** fraction.length) : 1000,
    label,
  }
}

function positiveInteger(...values: unknown[]): number | null {
  for (const value of values) {
    const number = typeof value === 'number' ? value : Number(value)
    if (Number.isSafeInteger(number) && number > 0) return number
  }
  return null
}

function emptyMetadata(
  file: File,
  id: string,
  status: PhotoMetadataStatus,
  metadataError: string | null,
): PhotoMetadata {
  return {
    id,
    name: file.name,
    size: file.size,
    status,
    capturedAtMs: null,
    captureTimeLabel: null,
    capturePrecisionMs: null,
    captureSource: null,
    cameraMake: null,
    cameraModel: null,
    cameraSerial: null,
    imageWidth: null,
    imageHeight: null,
    sha256: null,
    hashError: null,
    metadataError,
  }
}

export async function readPhotoMetadata(file: File, id: string): Promise<PhotoMetadata> {
  let tags: Record<string, unknown> | undefined
  try {
    tags = await parse(file, {
      pick: EXIF_TAGS,
      reviveValues: false,
      mergeOutput: true,
    }) as Record<string, unknown> | undefined
  } catch (error) {
    return emptyMetadata(
      file,
      id,
      'invalid_metadata',
      error instanceof Error ? error.message : 'Erro ao ler os metadados EXIF.',
    )
  }

  if (!tags) {
    return emptyMetadata(file, id, 'invalid_metadata', 'O arquivo não contém EXIF legível.')
  }

  const capture = findCaptureTime(tags)

  const status: PhotoMetadataStatus = capture.parsed
    ? 'ready'
    : capture.hasCaptureDate
      ? 'invalid_metadata'
      : 'missing_capture_time'

  return {
    id,
    name: file.name,
    size: file.size,
    status,
    capturedAtMs: capture.parsed?.timestampMs ?? null,
    captureTimeLabel: capture.parsed?.label ?? null,
    capturePrecisionMs: capture.parsed?.precisionMs ?? null,
    captureSource: capture.source,
    cameraMake: cleanText(tags.Make),
    cameraModel: cleanText(tags.Model),
    cameraSerial: cleanText(tags.BodySerialNumber) ?? cleanText(tags.SerialNumber),
    imageWidth: positiveInteger(tags.ImageWidth, tags.ExifImageWidth),
    imageHeight: positiveInteger(tags.ImageHeight, tags.ExifImageHeight),
    sha256: null,
    hashError: null,
    metadataError: status === 'invalid_metadata' ? 'A data EXIF está presente, mas é inválida.' : null,
  }
}
