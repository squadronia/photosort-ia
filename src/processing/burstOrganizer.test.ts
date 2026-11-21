import { describe, expect, it } from 'vitest'
import { classifyBurstPhotos, organizeBursts, type PhotoMetadata } from './burstOrganizer'

function photo(index: number, overrides: Partial<PhotoMetadata> = {}): PhotoMetadata {
  return {
    id: `photo-${index}`,
    name: `foto-${String(index).padStart(3, '0')}.jpg`,
    size: 100,
    status: 'ready',
    capturedAtMs: index * 100,
    captureTimeLabel: `2026-01-01 10:00:${String(index).padStart(2, '0')}.100`,
    capturePrecisionMs: 1,
    captureSource: 'DateTimeOriginal',
    cameraMake: 'Canon',
    cameraModel: 'R6',
    cameraSerial: 'body-1',
    imageWidth: 4000,
    imageHeight: 3000,
    sha256: null,
    hashError: null,
    metadataError: null,
    ...overrides,
  }
}

describe('organizeBursts', () => {
  it.each([3, 10])('keeps every photo in a burst of %i', (count) => {
    const photos = Array.from({ length: count }, (_, index) => photo(index))
    const result = organizeBursts(photos, count * 100)

    expect(result.bursts).toHaveLength(1)
    expect(result.bursts[0].selected).toEqual(photos)
    expect(result.bursts[0].excess).toEqual([])
  })

  it('keeps the centered ten for a burst of 11 and moves the earlier tie-break photo to excess', () => {
    const photos = Array.from({ length: 11 }, (_, index) => photo(index))
    const result = organizeBursts(photos, 1100)

    expect(result.bursts[0].selected.map((item) => item.id))
      .toEqual(photos.slice(1).map((item) => item.id))
    expect(result.bursts[0].excess.map((item) => item.id)).toEqual(['photo-0'])
  })

  it('applies the centered tie-break consistently to 17 and 20 photos', () => {
    const photos17 = Array.from({ length: 17 }, (_, index) => photo(index))
    const photos20 = Array.from({ length: 20 }, (_, index) => photo(index))

    const result17 = organizeBursts(photos17, 1700)
    const result20 = organizeBursts(photos20, 2000)

    expect(result17.bursts[0].selected.map((item) => item.id))
      .toEqual(photos17.slice(4, 14).map((item) => item.id))
    expect(result20.bursts[0].selected.map((item) => item.id))
      .toEqual(photos20.slice(5, 15).map((item) => item.id))
    expect(result17.summary.excessPhotos).toBe(7)
    expect(result20.summary.excessPhotos).toBe(10)
  })

  it('starts a new burst when the configured capture-time gap is exceeded', () => {
    const photos = [
      photo(1, { capturedAtMs: 1000 }),
      photo(2, { capturedAtMs: 1500 }),
      photo(3, { capturedAtMs: 2001 }),
    ]

    const result = organizeBursts(photos, 500)

    expect(result.bursts.map((burst) => burst.photos.length)).toEqual([2, 1])
  })

  it('keeps camera streams separate even when their times overlap', () => {
    const photos = [
      photo(1, { cameraSerial: 'body-1', capturedAtMs: 1000 }),
      photo(2, { cameraSerial: 'body-2', capturedAtMs: 1050 }),
    ]

    const result = organizeBursts(photos, 500)

    expect(result.bursts).toHaveLength(2)
    expect(result.summary.reviewPhotos).toBe(0)
  })

  it('routes equal timestamps from the same camera to review instead of merging them', () => {
    const photos = [
      photo(1, { capturedAtMs: 1000 }),
      photo(2, { capturedAtMs: 1100 }),
      photo(3, { capturedAtMs: 1100 }),
      photo(4, { capturedAtMs: 1200 }),
    ]

    const result = organizeBursts(photos, 1000)

    expect(result.review.map((item) => item.photo.id)).toEqual(['photo-2', 'photo-3'])
    expect(result.review.every((item) => item.reason === 'ambiguous_sequence')).toBe(true)
    expect(result.bursts.map((burst) => burst.photos.map((item) => item.id)))
      .toEqual([['photo-1'], ['photo-4']])
  })

  it('routes missing timestamps and unknown cameras to review and preserves the total', () => {
    const photos = [
      photo(1, { status: 'missing_capture_time', capturedAtMs: null }),
      photo(2, { cameraMake: null, cameraModel: null, cameraSerial: null, capturedAtMs: 200 }),
      photo(3, { status: 'invalid_metadata', capturedAtMs: null }),
    ]

    const result = organizeBursts(photos, 1000)

    expect(result.summary.missingMetadataPhotos).toBe(1)
    expect(result.summary.invalidMetadataPhotos).toBe(1)
    expect(result.summary.ambiguousSequencePhotos).toBe(1)
    expect(result.summary.completePhotos + result.summary.excessPhotos + result.summary.reviewPhotos)
      .toBe(photos.length)
  })

  it('creates a persistent assignment for every complete, excess, and review photo', () => {
    const photos = [
      ...Array.from({ length: 11 }, (_, index) => photo(index)),
      photo(11, { cameraMake: null, cameraModel: null, cameraSerial: null }),
    ]
    const result = organizeBursts(photos, 2000)
    const assignments = classifyBurstPhotos(result)

    expect(assignments).toHaveLength(photos.length)
    expect(assignments.filter((item) => item.category === 'complete')).toHaveLength(10)
    expect(assignments.filter((item) => item.category === 'excess')).toMatchObject([
      { photo: { id: 'photo-0' }, burstPosition: 1, burstSize: 11 },
    ])
    expect(assignments.find((item) => item.photo.id === 'photo-11')).toMatchObject({
      category: 'review',
      burstId: null,
      reviewReason: 'ambiguous_sequence',
    })
  })

  it('classifies a batch larger than 5,000 without dropping originals', () => {
    const photos = Array.from({ length: 5001 }, (_, index) => photo(index))
    const result = organizeBursts(photos, 2000)
    const assignments = classifyBurstPhotos(result)

    expect(result.summary.totalPhotos).toBe(5001)
    expect(assignments).toHaveLength(5001)
    expect(assignments.filter((item) => item.category === 'complete')).toHaveLength(10)
    expect(assignments.filter((item) => item.category === 'excess')).toHaveLength(4991)
  })

  it('counts exact duplicate hashes without removing any file', () => {
    const photos = [
      photo(1, { sha256: 'same-hash' }),
      photo(2, { sha256: 'same-hash' }),
      photo(3, { sha256: 'other-hash', hashError: 'unavailable' }),
    ]

    const result = organizeBursts(photos, 1000)

    expect(result.summary.duplicateCopies).toBe(1)
    expect(result.summary.duplicateCheckUnavailable).toBe(1)
    expect(result.summary.totalPhotos).toBe(3)
  })

  it('rejects a missing or invalid burst interval', () => {
    expect(() => organizeBursts([], 0)).toThrow('maior que zero')
    expect(() => organizeBursts([], Number.NaN)).toThrow('maior que zero')
  })
})
