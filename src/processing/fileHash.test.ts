import { describe, expect, it } from 'vitest'
import { hashBlob } from './fileHash'

describe('hashBlob', () => {
  it('calculates SHA-256 incrementally across small chunks', async () => {
    const progress: number[] = []
    const hash = await hashBlob(new Blob(['abc']), {
      chunkSize: 1,
      onProgress: (bytes) => progress.push(bytes),
    })

    expect(hash).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(progress).toEqual([1, 2, 3])
  })

  it('stops hashing when cancellation is requested', async () => {
    let cancelled = false
    const hash = await hashBlob(new Blob(['abc']), {
      chunkSize: 1,
      isCancelled: () => cancelled,
      onProgress: () => { cancelled = true },
    })

    expect(hash).toBeNull()
  })
})
