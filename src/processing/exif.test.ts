import { describe, expect, it } from 'vitest'
import { findCaptureTime, parseExifDateTime } from './exif'

describe('parseExifDateTime', () => {
  it('keeps fractional seconds from the EXIF subsecond tag', () => {
    const parsed = parseExifDateTime('2026:03:14 10:30:15', '125', null)

    expect(parsed?.timestampMs).toBe(Date.UTC(2026, 2, 14, 10, 30, 15) + 125)
    expect(parsed?.precisionMs).toBe(1)
    expect(parsed?.label).toBe('2026-03-14 10:30:15.125')
  })

  it('uses inline fractional seconds when a separate subsecond tag is absent', () => {
    const parsed = parseExifDateTime('2026:03:14 10:30:15.25', null, null)

    expect(parsed?.timestampMs).toBe(Date.UTC(2026, 2, 14, 10, 30, 15) + 250)
    expect(parsed?.precisionMs).toBe(10)
  })

  it('preserves sub-millisecond precision from long EXIF subseconds', () => {
    const parsed = parseExifDateTime('2026:03:14 10:30:15', '123456', null)

    expect(parsed?.timestampMs).toBeCloseTo(Date.UTC(2026, 2, 14, 10, 30, 15) + 123.456, 6)
    expect(parsed?.precisionMs).toBeCloseTo(0.001, 10)
  })

  it('uses exact whole-second timestamps when SubSecTime is absent', () => {
    const parsed = parseExifDateTime('2026:03:14 10:30:15', null, null)

    expect(parsed?.timestampMs).toBe(Date.UTC(2026, 2, 14, 10, 30, 15))
    expect(parsed?.precisionMs).toBe(1000)
  })

  it('normalizes explicit timezone offsets for chronology comparisons', () => {
    const parsed = parseExifDateTime('2026:03:14 10:30:15', null, '+02:00')

    expect(parsed?.timestampMs).toBe(Date.UTC(2026, 2, 14, 8, 30, 15))
    expect(parsed?.label).toBe('2026-03-14 10:30:15+02:00')
  })

  it('rejects invalid calendar dates and malformed subseconds', () => {
    expect(parseExifDateTime('2026:02:30 10:30:15', null, null)).toBeNull()
    expect(parseExifDateTime('2026:03:14 10:30:15', '12x', null)).toBeNull()
  })

  it('prefers original capture time and falls back to the next valid EXIF timestamp', () => {
    const preferred = findCaptureTime({
      DateTimeOriginal: '2026:03:14 10:30:15',
      SubSecTimeOriginal: '5',
      DateTimeDigitized: '2026:03:14 10:31:15',
      DateTime: '2026:03:14 10:32:15',
    })
    const fallback = findCaptureTime({
      DateTimeOriginal: 'not-a-date',
      DateTimeDigitized: '2026:03:14 10:31:15',
      SubSecTimeDigitized: '25',
      DateTime: '2026:03:14 10:32:15',
    })

    expect(preferred.source).toBe('DateTimeOriginal')
    expect(preferred.parsed?.timestampMs).toBe(Date.UTC(2026, 2, 14, 10, 30, 15) + 500)
    expect(fallback.source).toBe('DateTimeDigitized')
    expect(fallback.parsed?.timestampMs).toBe(Date.UTC(2026, 2, 14, 10, 31, 15) + 250)
  })
})
