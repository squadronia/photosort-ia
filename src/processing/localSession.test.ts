import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { organizeBursts, type PhotoMetadata } from './burstOrganizer'
import { loadLocalSession, saveLocalSession, type LocalSessionSnapshot } from './localSession'

function photo(id: string): PhotoMetadata {
  return {
    id,
    name: `${id}.jpg`,
    size: 3,
    status: 'ready',
    capturedAtMs: 1000,
    captureTimeLabel: '2026-01-01 10:00:01',
    capturePrecisionMs: 1000,
    captureSource: 'DateTimeOriginal',
    cameraMake: 'Canon',
    cameraModel: 'R6',
    cameraSerial: 'body-1',
    imageWidth: 4000,
    imageHeight: 3000,
    sha256: 'hash',
    hashError: null,
    metadataError: null,
  }
}

function snapshot(
  fileIds: string[],
  metadata: PhotoMetadata[] = [],
  result: ReturnType<typeof organizeBursts> | null = null,
): LocalSessionSnapshot {
  return {
    fileIds,
    maxGapSeconds: '2',
    ignoredFiles: 1,
    metadata,
    result,
    archiveComplete: false,
  }
}

describe('local processing sessions', () => {
  it('restores files and results for the matching account only', async () => {
    const userA = `user-a-${crypto.randomUUID()}`
    const userB = `user-b-${crypto.randomUUID()}`
    const photoA = photo('photo-a')
    const fileA = new File(['one'], 'one.jpg', { type: 'image/jpeg' })
    const fileB = new File(['two'], 'two.jpg', { type: 'image/jpeg' })
    const result = organizeBursts([photoA], 2000)
    const stateA = { ...snapshot(['a'], [photoA], result), archiveComplete: true }

    await saveLocalSession(userA, stateA, {
      addedFiles: [{ id: 'a', file: fileA }],
      replaceFiles: true,
    })
    await saveLocalSession(userB, snapshot(['b']), {
      addedFiles: [{ id: 'b', file: fileB }],
      replaceFiles: true,
    })
    await saveLocalSession(userB, { ...snapshot(['b']), maxGapSeconds: '2.5' })

    const restoredA = await loadLocalSession(userA)
    const restoredB = await loadLocalSession(userB)

    expect(restoredA?.files.map((item) => item.file.name)).toEqual(['one.jpg'])
    expect(await restoredA?.files[0].file.text()).toBe('one')
    expect(restoredA?.result).toEqual(result)
    expect(restoredA?.maxGapSeconds).toBe('2')
    expect(restoredA?.archiveComplete).toBe(true)
    expect(restoredB?.files.map((item) => item.file.name)).toEqual(['two.jpg'])
    expect(restoredB?.maxGapSeconds).toBe('2.5')
    expect(restoredB?.result).toBeNull()
  })

  it('replaces and clears one account’s stored photos without affecting another', async () => {
    const userA = `replace-a-${crypto.randomUUID()}`
    const userB = `replace-b-${crypto.randomUUID()}`
    const originalFile = new File(['old'], 'old.jpg', { type: 'image/jpeg' })
    const replacementFile = new File(['new'], 'new.jpg', { type: 'image/jpeg' })
    const otherUserFile = new File(['other'], 'other.jpg', { type: 'image/jpeg' })

    await saveLocalSession(userA, snapshot(['old']), {
      addedFiles: [{ id: 'old', file: originalFile }],
      replaceFiles: true,
    })
    await saveLocalSession(userB, snapshot(['other']), {
      addedFiles: [{ id: 'other', file: otherUserFile }],
      replaceFiles: true,
    })
    await saveLocalSession(userA, snapshot(['new']), {
      addedFiles: [{ id: 'new', file: replacementFile }],
      replaceFiles: true,
    })

    expect((await loadLocalSession(userA))?.files.map((item) => item.id)).toEqual(['new'])
    expect((await loadLocalSession(userB))?.files.map((item) => item.id)).toEqual(['other'])

    await saveLocalSession(userA, snapshot([]), { replaceFiles: true })

    expect((await loadLocalSession(userA))?.files).toEqual([])
    expect((await loadLocalSession(userB))?.files.map((item) => item.id)).toEqual(['other'])
  })

  it('reports file and byte progress while storing selected photos', async () => {
    const userId = `progress-${crypto.randomUUID()}`
    const addedFiles = [
      { id: 'first', file: new File(['one'], 'one.jpg', { type: 'image/jpeg' }) },
      { id: 'second', file: new File(['two22'], 'two.jpg', { type: 'image/jpeg' }) },
    ]
    const progress: Array<{
      completedFiles: number
      totalFiles: number
      completedBytes: number
      totalBytes: number
    }> = []

    await saveLocalSession(userId, snapshot(['first', 'second']), {
      addedFiles,
      replaceFiles: true,
      onFileProgress: (item) => progress.push(item),
    })

    expect(progress.length).toBeGreaterThan(0)
    expect(progress[progress.length - 1]).toEqual({
      completedFiles: 2,
      totalFiles: 2,
      completedBytes: 8,
      totalBytes: 8,
    })
  })
})
