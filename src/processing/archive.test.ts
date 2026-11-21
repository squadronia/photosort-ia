import { BlobReader, TextWriter, Uint8ArrayWriter, ZipReader } from '@zip.js/zip.js'
import { describe, expect, it } from 'vitest'
import { buildArchiveBlob, canSaveArchiveToDisk, createArchiveEntries, writeBurstArchive } from './archive'
import { organizeBursts, type PhotoMetadata } from './burstOrganizer'

function photo(id: string, name: string, timestamp: number | null): PhotoMetadata {
  return {
    id,
    name,
    size: 0,
    status: timestamp === null ? 'missing_capture_time' : 'ready',
    capturedAtMs: timestamp,
    captureTimeLabel: timestamp === null ? null : `2026-03-14 10:30:${timestamp}`,
    capturePrecisionMs: timestamp === null ? null : 1000,
    captureSource: timestamp === null ? null : 'DateTimeOriginal',
    cameraMake: 'Canon',
    cameraModel: 'R6',
    cameraSerial: 'body-1',
    imageWidth: 4000,
    imageHeight: 3000,
    sha256: null,
    hashError: null,
    metadataError: null,
  }
}

describe('burst archive', () => {
  it('does not claim direct-to-disk support in the VS Code browser host', () => {
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        isSecureContext: true,
        navigator: { userAgent: 'Chrome/150 Code/1.147.0 Electron/43.8.9' },
        showSaveFilePicker: async () => ({ createWritable: async () => new WritableStream() }),
      },
    })

    try {
      expect(canSaveArchiveToDisk()).toBe(false)
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: {
          isSecureContext: true,
          navigator: { userAgent: 'Chrome/150' },
          showSaveFilePicker: async () => ({ createWritable: async () => new WritableStream() }),
        },
      })
      expect(canSaveArchiveToDisk()).toBe(true)
    } finally {
      if (previousWindow) {
        Object.defineProperty(globalThis, 'window', previousWindow)
      } else {
        Reflect.deleteProperty(globalThis, 'window')
      }
    }
  })

  it('creates unique safe paths for colliding original names', () => {
    const records = [
      photo('one', 'same.jpg', 1000),
      photo('two', 'same.jpg', 1100),
      photo('three', 'same (2).jpg', 1200),
    ]
    const result = organizeBursts(records, 1000)
    const files = new Map(records.map((record) => [
      record.id,
      new File([record.id], record.name, { type: 'image/jpeg' }),
    ]))

    const entries = createArchiveEntries(result, files)

    expect(entries.map((entry) => entry.path)).toEqual([
      'PHOTOSORT/FOTOS_COMPLETAS/RAJADA_0001/same.jpg',
      'PHOTOSORT/FOTOS_COMPLETAS/RAJADA_0001/same (2).jpg',
      'PHOTOSORT/FOTOS_COMPLETAS/RAJADA_0001/same (2) (2).jpg',
    ])
    expect(entries.every((entry) => !entry.path.includes('\\'))).toBe(true)
  })

  it('writes original bytes, review folders, ZIP64 structure, and a report', async () => {
    const records = [
      photo('one', 'original.jpg', 1000),
      photo('two', 'without-exif.tiff', null),
    ]
    const files = new Map<string, File>([
      ['one', new File([new Uint8Array([0, 255, 1, 128])], 'original.jpg', { type: 'image/jpeg' })],
      ['two', new File(['unmodified bytes'], 'without-exif.tiff', { type: 'image/tiff' })],
    ])
    const result = organizeBursts(records, 500)
    const blob = await buildArchiveBlob(result, files, new AbortController().signal, () => undefined)
    const reader = new ZipReader(new BlobReader(blob))

    try {
      const entries = await reader.getEntries()
      const names = entries.map((entry) => entry.filename)
      expect(names).toContain('PHOTOSORT/FOTOS_COMPLETAS/RAJADA_0001/original.jpg')
      expect(names).toContain('PHOTOSORT/REVISAO/SEM_DATA_DE_CAPTURA/without-exif.tiff')
      expect(names).toContain('PHOTOSORT/RELATORIO.txt')

      const originalEntry = entries.find((entry) => entry.filename.endsWith('/original.jpg'))
      const reportEntry = entries.find((entry) => entry.filename.endsWith('/RELATORIO.txt'))
      if (!originalEntry || originalEntry.directory || !reportEntry || reportEntry.directory) {
        throw new Error('O ZIP não contém os arquivos esperados.')
      }
      expect([...await originalEntry.getData(new Uint8ArrayWriter())]).toEqual([0, 255, 1, 128])
      expect(await reportEntry.getData(new TextWriter())).toContain('FOTOGRAFIAS RECEBIDAS: 2')
    } finally {
      await reader.close()
    }
  })

  it('writes a valid ZIP archive through the direct-to-disk stream', async () => {
    const record = photo('streamed', 'streamed.jpg', 1000)
    const result = organizeBursts([record], 500)
    const files = new Map<string, File>([
      ['streamed', new File(['original bytes'], 'streamed.jpg', { type: 'image/jpeg' })],
    ])
    const chunks: Uint8Array[] = []
    let closed = false
    const output = new WritableStream<Uint8Array>({
      write(chunk) {
        chunks.push(chunk.slice())
      },
      close() {
        closed = true
      },
    })
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')

    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        isSecureContext: true,
        showSaveFilePicker: async () => ({
          createWritable: async () => output,
        }),
      },
    })

    try {
      await writeBurstArchive(result, files, new AbortController().signal, () => undefined)
      expect(closed).toBe(true)

      const archiveBytes = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0))
      let offset = 0
      for (const chunk of chunks) {
        archiveBytes.set(chunk, offset)
        offset += chunk.length
      }
      const reader = new ZipReader(new BlobReader(new Blob([archiveBytes])))
      try {
        const entries = await reader.getEntries()
        expect(entries.map((entry) => entry.filename)).toContain(
          'PHOTOSORT/FOTOS_COMPLETAS/RAJADA_0001/streamed.jpg',
        )
        expect(entries.map((entry) => entry.filename)).toContain('PHOTOSORT/RELATORIO.txt')
        const imageEntry = entries.find((entry) => entry.filename.endsWith('/streamed.jpg'))
        if (!imageEntry || imageEntry.directory) {
          throw new Error('O ZIP transmitido não contém a foto original.')
        }
        expect(new TextDecoder().decode(await imageEntry.getData(new Uint8ArrayWriter()))).toBe(
          'original bytes',
        )
      } finally {
        await reader.close()
      }
    } finally {
      if (previousWindow) {
        Object.defineProperty(globalThis, 'window', previousWindow)
      } else {
        Reflect.deleteProperty(globalThis, 'window')
      }
    }
  })

  it('streams Safari ZIPs through OPFS and returns a Finder-downloadable file', async () => {
    const record = photo('safari', 'safari.jpg', 1000)
    const result = organizeBursts([record], 500)
    const files = new Map<string, File>([
      ['safari', new File(['original bytes'], 'safari.jpg', { type: 'image/jpeg' })],
    ])
    const chunks: Uint8Array[] = []
    let closed = false
    const output = new WritableStream<Uint8Array>({
      write(chunk) {
        chunks.push(chunk.slice())
      },
      close() {
        closed = true
      },
    })
    const storage = {
      estimate: async () => ({ usage: 0, quota: 100 * 1024 * 1024 }),
      getDirectory: async () => ({
        getFileHandle: async () => ({
          createWritable: async () => output,
          getFile: async () => {
            const archiveBytes = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0))
            let offset = 0
            for (const chunk of chunks) {
              archiveBytes.set(chunk, offset)
              offset += chunk.length
            }
            return new File([archiveBytes], 'photosort-export.zip', { type: 'application/zip' })
          },
        }),
        removeEntry: async () => undefined,
      }),
    }
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')

    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        isSecureContext: true,
        navigator: { userAgent: 'Mozilla/5.0 Safari/605.1.15', storage },
        FileSystemFileHandle: { prototype: { createWritable: () => undefined } },
      },
    })

    try {
      expect(canSaveArchiveToDisk()).toBe(true)
      const archive = await writeBurstArchive(result, files, new AbortController().signal, () => undefined)
      expect(closed).toBe(true)
      expect(archive).toBeInstanceOf(File)
      if (!archive) throw new Error('O Safari não retornou o ZIP para download.')

      const reader = new ZipReader(new BlobReader(archive))
      try {
        const entries = await reader.getEntries()
        expect(entries.map((entry) => entry.filename)).toContain(
          'PHOTOSORT/FOTOS_COMPLETAS/RAJADA_0001/safari.jpg',
        )
        expect(entries.map((entry) => entry.filename)).toContain('PHOTOSORT/RELATORIO.txt')
      } finally {
        await reader.close()
      }
    } finally {
      if (previousWindow) {
        Object.defineProperty(globalThis, 'window', previousWindow)
      } else {
        Reflect.deleteProperty(globalThis, 'window')
      }
    }
  })

  it('refuses a Safari export when the local quota cannot hold the temporary ZIP', async () => {
    const record = photo('safari-space', 'safari.jpg', 1000)
    const result = organizeBursts([record], 500)
    const files = new Map<string, File>([
      ['safari-space', new File(['original bytes'], 'safari.jpg', { type: 'image/jpeg' })],
    ])
    let openedDirectory = false
    const storage = {
      estimate: async () => ({ usage: 100, quota: 100 }),
      getDirectory: async () => {
        openedDirectory = true
        throw new Error('O teste não deve abrir o armazenamento sem espaço.')
      },
    }
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')

    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        isSecureContext: true,
        navigator: { userAgent: 'Mozilla/5.0 Safari/605.1.15', storage },
        FileSystemFileHandle: { prototype: { createWritable: () => undefined } },
      },
    })

    try {
      await expect(
        writeBurstArchive(result, files, new AbortController().signal, () => undefined),
      ).rejects.toThrow('Não há espaço local suficiente')
      expect(openedDirectory).toBe(false)
    } finally {
      if (previousWindow) {
        Object.defineProperty(globalThis, 'window', previousWindow)
      } else {
        Reflect.deleteProperty(globalThis, 'window')
      }
    }
  })

  it('explains when the browser blocks direct-to-disk writing', async () => {
    const record = photo('blocked', 'blocked.jpg', 1000)
    const result = organizeBursts([record], 500)
    const files = new Map<string, File>([
      ['blocked', new File(['original bytes'], 'blocked.jpg', { type: 'image/jpeg' })],
    ])
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')

    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        isSecureContext: true,
        showSaveFilePicker: async () => ({
          createWritable: async () => {
            throw new DOMException('The request is not allowed in this context.', 'NotAllowedError')
          },
        }),
      },
    })

    try {
      await expect(
        writeBurstArchive(result, files, new AbortController().signal, () => undefined),
      ).rejects.toThrow('Nenhum ZIP foi concluído.')
    } finally {
      if (previousWindow) {
        Object.defineProperty(globalThis, 'window', previousWindow)
      } else {
        Reflect.deleteProperty(globalThis, 'window')
      }
    }
  })
})
