function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = (error) => {
      URL.revokeObjectURL(url)
      reject(error)
    }
    img.src = url
  })
}

function toJpeg(img: HTMLImageElement, maxDimension: number, quality: number, name: string): Promise<File | null> {
  const scale = Math.min(1, maxDimension / Math.max(img.width, img.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(img.width * scale))
  canvas.height = Math.max(1, Math.round(img.height * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) return Promise.resolve(null)

  // JPEG has no transparency: paint white first so transparent PNGs don't turn black.
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

  return new Promise((resolve) => {
    canvas.toBlob(
      blob => resolve(blob ? new File([blob], name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg', lastModified: Date.now() }) : null),
      'image/jpeg',
      quality
    )
  })
}

/** Approximate size of a file once base64-encoded into a data URL. */
export function encodedSize(bytes: number): number {
  return Math.ceil(bytes / 3) * 4
}

/**
 * Downscales an image until its encoded size fits `maxEncodedChars`.
 * Starts large and sharp (so screenshots stay readable) and steps down only as needed.
 * Returns null when the image cannot be made small enough.
 */
export async function fitImage(file: File, maxEncodedChars: number): Promise<File | null> {
  if (!file.type.startsWith('image/')) return file

  const img = await loadImage(file)
  const steps: Array<[number, number]> = [[1600, 0.85], [1280, 0.8], [1024, 0.75], [800, 0.7], [600, 0.6]]

  for (const [dimension, quality] of steps) {
    const out = await toJpeg(img, dimension, quality, file.name)
    if (out && encodedSize(out.size) <= maxEncodedChars) return out
  }
  return null
}
