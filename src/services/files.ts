import { hardware, native } from './printing'

export async function saveFile(name: string, mime: string, content: string) {
  if (native) return (await hardware.exportFile({ name, mime, content })).saved
  const url = URL.createObjectURL(new Blob([content], { type: mime }))
  const link = Object.assign(document.createElement('a'), { href: url, download: name })
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return true
}

export async function readJson(file: File): Promise<unknown> {
  if (file.size > 30 * 1024 * 1024) throw new Error('ไฟล์มีขนาดเกิน 30 MB')
  return JSON.parse(await file.text())
}
