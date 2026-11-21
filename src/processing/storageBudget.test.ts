import { describe, expect, it } from 'vitest'
import { shouldUseTemporaryMode } from './storageBudget'

describe('temporary processing mode', () => {
  it('uses temporary mode when the selection exceeds available browser storage', () => {
    expect(shouldUseTemporaryMode(5.4 * 1024 ** 3, {
      quota: 733_226_959,
      usage: 2_101,
    })).toBe(true)
  })

  it('keeps local persistence when the selection fits with storage headroom', () => {
    expect(shouldUseTemporaryMode(500 * 1024 ** 2, {
      quota: 733_226_959,
      usage: 2_101,
    })).toBe(false)
  })

  it('uses the conservative fallback when quota information is unavailable', () => {
    expect(shouldUseTemporaryMode(5.4 * 1024 ** 3)).toBe(true)
  })
})
