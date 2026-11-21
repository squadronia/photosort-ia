// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'
import { readPhotoMetadata } from './exif'

function makeExifTiff(): File {
  const buffer = new ArrayBuffer(158)
  const view = new DataView(buffer)
  const bytes = new Uint8Array(buffer)
  bytes.set([0x49, 0x49], 0)
  view.setUint16(2, 42, true)
  view.setUint32(4, 8, true)

  const writeEntry = (
    offset: number,
    tag: number,
    type: number,
    count: number,
    value: number,
  ) => {
    view.setUint16(offset, tag, true)
    view.setUint16(offset + 2, type, true)
    view.setUint32(offset + 4, count, true)
    view.setUint32(offset + 8, value, true)
  }
  const writeAscii = (offset: number, value: string) => {
    bytes.set(new TextEncoder().encode(`${value}\0`), offset)
  }
  const writeInlineAscii = (entryOffset: number, value: string) => {
    bytes.set(new TextEncoder().encode(`${value}\0`), entryOffset + 8)
  }

  view.setUint16(8, 3, true)
  writeEntry(10, 0x010f, 2, 6, 50)
  writeEntry(22, 0x0110, 2, 3, 0)
  writeInlineAscii(22, 'R6')
  writeEntry(34, 0x8769, 4, 1, 60)
  view.setUint32(46, 0, true)
  writeAscii(50, 'Canon')

  view.setUint16(60, 5, true)
  writeEntry(62, 0x9003, 2, 20, 126)
  writeEntry(74, 0x9291, 2, 4, 0)
  writeInlineAscii(74, '123')
  writeEntry(86, 0xa002, 3, 1, 4000)
  writeEntry(98, 0xa003, 3, 1, 3000)
  writeEntry(110, 0xa431, 2, 8, 150)
  view.setUint32(122, 0, true)
  writeAscii(126, '2026:03:14 10:30:15')
  writeAscii(150, '1234567')

  return new File([buffer], 'fixture.tiff', { type: 'image/tiff' })
}

describe('readPhotoMetadata', () => {
  it('reads capture time, subseconds, camera identity, and dimensions from TIFF EXIF', async () => {
    const file = makeExifTiff()
    const metadata = await readPhotoMetadata(file, 'fixture-1')

    expect(metadata.metadataError).toBeNull()
    expect(metadata.status).toBe('ready')
    expect(metadata.captureSource).toBe('DateTimeOriginal')
    expect(metadata.capturedAtMs).toBe(Date.UTC(2026, 2, 14, 10, 30, 15) + 123)
    expect(metadata.capturePrecisionMs).toBe(1)
    expect(metadata.cameraMake).toBe('Canon')
    expect(metadata.cameraModel).toBe('R6')
    expect(metadata.cameraSerial).toBe('1234567')
    expect(metadata.imageWidth).toBe(4000)
    expect(metadata.imageHeight).toBe(3000)
  })
})
