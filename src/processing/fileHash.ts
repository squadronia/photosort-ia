import { bytesToHex } from '@noble/hashes/utils.js'
import { sha256 } from '@noble/hashes/sha2.js'

export async function hashBlob(
  blob: Blob,
  options: {
    chunkSize?: number
    isCancelled?: () => boolean
    onProgress?: (processedBytes: number) => void
  } = {},
): Promise<string | null> {
  const chunkSize = options.chunkSize ?? 4 * 1024 * 1024
  if (!Number.isSafeInteger(chunkSize) || chunkSize <= 0) {
    throw new Error('O tamanho do bloco de hash deve ser maior que zero.')
  }

  const hash = sha256.create()
  for (let offset = 0; offset < blob.size; offset += chunkSize) {
    if (options.isCancelled?.()) return null
    const bytes = await blob.slice(offset, offset + chunkSize).arrayBuffer()
    hash.update(new Uint8Array(bytes))
    options.onProgress?.(Math.min(offset + bytes.byteLength, blob.size))
  }

  return bytesToHex(hash.digest())
}
