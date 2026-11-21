import { describe, expect, it } from 'vitest'
import {
  classifyBurstPhotos,
  FPS_WINDOW_MS,
  organizeBursts,
  type PhotoMetadata,
} from './burstOrganizer'

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

function photosInOneSecond(count: number): PhotoMetadata[] {
  return Array.from({ length: count }, (_, index) =>
    photo(index, {
      capturedAtMs: count === 1 ? 0 : index * FPS_WINDOW_MS / (count - 1),
    }),
  )
}

describe('organizeBursts', () => {
  it.each([
    [5, 0],
    [10, 0],
    [11, 1],
    [15, 5],
    [20, 10],
  ])('classifies %i photos in one second with %i excess', (count, expectedExcess) => {
    const photos = photosInOneSecond(count)
    const result = organizeBursts(photos, 2000)

    expect(result.summary.excessPhotos).toBe(expectedExcess)
    expect(result.summary.completePhotos).toBe(count - expectedExcess)
    expect(result.summary.completePhotos + result.summary.excessPhotos).toBe(count)
    if (count > 10) {
      const start = Math.ceil(expectedExcess / 2)
      expect(result.bursts[0].selected.map((item) => item.id))
        .toEqual(photos.slice(start, start + 10).map((item) => item.id))
    }
  })

  it('uses a moving one-second window across a clock-second boundary', () => {
    const second = Date.UTC(2026, 0, 1)
    const photos = Array.from({ length: 11 }, (_, index) =>
      photo(index, { capturedAtMs: second + 950 + index * 10 }),
    )
    const result = organizeBursts(photos, 2000)

    expect(result.summary.excessPhotos).toBe(1)
    expect(result.excessDiagnostics[0].windowStartMs).toBe(second + 950)
    expect(result.excessDiagnostics[0].windowEndMs).toBe(second + 1950)
  })

  it('counts both endpoints of the configured 1,000 ms window', () => {
    const photos = Array.from({ length: 11 }, (_, index) =>
      photo(index, { capturedAtMs: index * 100 }),
    )
    const result = organizeBursts(photos, 2000)

    expect(result.summary.excessPhotos).toBe(1)
  })

  it('sorts fractional capture timestamps chronologically before applying the limit', () => {
    const second = Date.UTC(2026, 0, 1)
    const photos = Array.from({ length: 11 }, (_, index) =>
      photo(index, { capturedAtMs: second + 100 + index * 0.125 }),
    ).reverse()
    const result = organizeBursts(photos, 2000)

    expect(result.bursts[0].photos.map((item) => item.id))
      .toEqual(Array.from({ length: 11 }, (_, index) => `photo-${index}`))
    expect(result.bursts[0].selected.map((item) => item.id))
      .toEqual(Array.from({ length: 10 }, (_, index) => `photo-${index + 1}`))
    expect(result.summary.excessPhotos).toBe(1)
  })

  it('does not impose a ten-photo cap on an entire burst spanning multiple seconds', () => {
    const photos = Array.from({ length: 20 }, (_, index) =>
      photo(index, { capturedAtMs: index * 500 }),
    )
    const result = organizeBursts(photos, 2000)

    expect(result.bursts).toHaveLength(1)
    expect(result.summary.excessPhotos).toBe(0)
    expect(result.bursts[0].selected).toHaveLength(20)
  })

  it('starts a new burst when the configured grouping gap is exceeded', () => {
    const photos = [
      photo(1, { capturedAtMs: 1000 }),
      photo(2, { capturedAtMs: 1500 }),
      photo(3, { capturedAtMs: 2001 }),
    ]

    const result = organizeBursts(photos, 500)

    expect(result.bursts.map((burst) => burst.photos.length)).toEqual([2, 1])
    expect(result.summary.excessPhotos).toBe(0)
  })

  it('applies the FPS limit across burst boundaries when the grouping gap is shorter', () => {
    const photos = photosInOneSecond(15)
    const result = organizeBursts(photos, 50)

    expect(result.summary.burstCount).toBe(15)
    expect(result.summary.excessPhotos).toBe(5)
    expect(result.summary.completePhotos).toBe(10)
    expect(result.bursts.flatMap((burst) => burst.selected).map((item) => item.id))
      .toEqual(photos.slice(3, 13).map((item) => item.id))
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

  it('treats identical timestamps as distinct, deterministically ordered captures', () => {
    const photos = Array.from({ length: 11 }, (_, index) =>
      photo(index, { capturedAtMs: 1000 }),
    )
    const result = organizeBursts(photos, 1000)
    const assignments = classifyBurstPhotos(result)

    expect(result.review).toEqual([])
    expect(result.bursts[0].selected.map((item) => item.id))
      .toEqual(photos.slice(1).map((item) => item.id))
    expect(assignments.filter((item) => item.category === 'excess')).toHaveLength(1)
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

  it('creates one persistent assignment for each complete, excess, and review photo', () => {
    const photos = [
      ...photosInOneSecond(11),
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

  it('keeps overlapping windows within the limit and accounts for every photo once', () => {
    const photos = Array.from({ length: 30 }, (_, index) =>
      photo(index, { capturedAtMs: index * 75 }),
    )
    const result = organizeBursts(photos, 2000)
    const assignments = classifyBurstPhotos(result)
    const keptTimes = result.bursts.flatMap((burst) => burst.selected)
      .map((item) => item.capturedAtMs)
      .filter((time): time is number => time !== null)

    for (const start of new Set(photos.map((item) => item.capturedAtMs).filter(
      (time): time is number => time !== null,
    ))) {
      expect(keptTimes.filter((time) => time >= start && time - start <= FPS_WINDOW_MS).length)
        .toBeLessThanOrEqual(10)
    }
    expect(new Set(assignments.map((item) => item.photo.id)).size).toBe(photos.length)
    expect(assignments.filter((item) => item.category === 'complete').length +
      assignments.filter((item) => item.category === 'excess').length).toBe(photos.length)
    expect(result.excessDiagnostics).toHaveLength(result.summary.excessPhotos)
  })

  it('returns the same classification when the same selection is processed again', () => {
    const photos = photosInOneSecond(20)

    expect(organizeBursts(photos, 2000)).toEqual(organizeBursts(photos, 2000))
  })

  it('does not mark extra photos while resolving overlapping-window conflicts', () => {
    const timestamps = [0, 200, 200, 200, 300, 400, 600, 700, 800, 800, 900, 1100]
    const photos = timestamps.map((capturedAtMs, index) => photo(index, { capturedAtMs }))
    const result = organizeBursts(photos, 2000)

    expect(result.summary.excessPhotos).toBe(1)
    expect(result.summary.completePhotos).toBe(11)
    expect(result.excessDiagnostics).toHaveLength(1)
  })

  it('classifies a large set of equal-time photos without dropping originals', () => {
    const photos = Array.from({ length: 5001 }, (_, index) =>
      photo(index, { capturedAtMs: 1000 }),
    )
    const result = organizeBursts(photos, 2000)
    const assignments = classifyBurstPhotos(result)

    expect(result.summary.totalPhotos).toBe(5001)
    expect(assignments).toHaveLength(5001)
    expect(assignments.filter((item) => item.category === 'complete')).toHaveLength(10)
    expect(assignments.filter((item) => item.category === 'excess')).toHaveLength(4991)
  })

  it('counts exact duplicate hashes without deduplicating the photo records', () => {
    const photos = [
      photo(1, { name: 'nome-a.jpg', capturedAtMs: 1000, sha256: 'same-hash' }),
      photo(2, { name: 'nome-b.jpg', capturedAtMs: 1500, sha256: 'same-hash' }),
    ]
    const result = organizeBursts(photos, 1000)

    expect(result.summary.duplicateCopies).toBe(1)
    expect(result.summary.totalPhotos).toBe(2)
    expect(result.summary.completePhotos).toBe(2)
  })

  it('rejects a missing or invalid burst interval', () => {
    expect(() => organizeBursts([], 0)).toThrow('maior que zero')
    expect(() => organizeBursts([], Number.NaN)).toThrow('maior que zero')
  })
})
