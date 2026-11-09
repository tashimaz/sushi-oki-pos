import { Capacitor, registerPlugin } from '@capacitor/core'
import type { Job, PrinterSettings } from '../database/model'
import { baht, bangkokTime } from './money'

type Device = { name: string; address: string }
export const native = Capacitor.isNativePlatform()
export const hardware = registerPlugin<{
  devices(): Promise<{ devices: Device[] }>
  pair(): Promise<void>
  connect(input: { address: string }): Promise<void>
  send(input: { address: string; data: string }): Promise<void>
  exportFile(input: { name: string; mime: string; content: string }): Promise<{ saved: boolean }>
}>('PosHardware')

export interface PrinterDriver {
  send(job: Job, settings: PrinterSettings): Promise<void>
}
export class PrintFailure extends Error {
  constructor(message: string, readonly uncertain = false) { super(message) }
}

export function ticketText(job: Job): string[] {
  const t = job.ticket
  const account = t.kind === 'accounting'
  return [
    'SUSHI OKI', ...(job.copyOf ? ['COPY'] : []),
    { kitchen: 'ใบครัว', accounting: 'ใบบัญชี · ยอดก่อนส่วนลด', test: 'ทดสอบเครื่องพิมพ์' }[t.kind],
    ...(t.table ? [`โต๊ะ ${t.table}`] : []),
    `ออเดอร์ ${t.orderId}`, bangkokTime(t.at), '────────────────────',
    ...(t.message ? [t.message] : []),
    ...t.lines.flatMap(i => [
      `${i.qty < 0 ? 'ยกเลิก ' : ''}${Math.abs(i.qty)} × ${i.name}`,
      ...(account ? [`  ${baht(i.price)} / หน่วย · ${baht(i.price * i.qty)}`] : []),
      ...(i.note ? [`  หมายเหตุ ${i.note}`] : []),
    ]),
    ...(account ? ['────────────────────', `ยอดรวม ${baht(t.lines.reduce((sum, i) => sum + i.price * i.qty, 0))}`] : []),
  ]
}

function wrap(ctx: CanvasRenderingContext2D, lines: string[], width: number) {
  const segmenter = new Intl.Segmenter('th', { granularity: 'grapheme' })
  return lines.flatMap(line => {
    const result: string[] = []
    let current = ''
    for (const { segment } of segmenter.segment(line)) {
      if (current && ctx.measureText(current + segment).width > width) {
        result.push(current)
        current = ''
      }
      current += segment
    }
    return [...result, current]
  })
}

async function raster(job: Job, paper: 58 | 80) {
  const width = paper === 58 ? 384 : 576
  const stride = width / 8
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new PrintFailure('อุปกรณ์ไม่รองรับการสร้างภาพใบพิมพ์')
  const font = '22px "Noto Sans Thai Variable"'
  await document.fonts.load(font, 'ซูชิโอกิ ABC')
  ctx.font = font
  const lines = wrap(ctx, ticketText(job), width - 32)
  const bytes = [27, 64]
  canvas.width = width
  for (let start = 0; start < lines.length; start += 12) {
    const chunk = lines.slice(start, start + 12)
    const height = chunk.length * 34
    canvas.height = height
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, width, height)
    ctx.font = font
    ctx.fillStyle = '#000'
    chunk.forEach((line, i) => ctx.fillText(line, 16, 25 + i * 34))
    const { data } = ctx.getImageData(0, 0, width, height)
    bytes.push(29, 118, 48, 0, stride, 0, height & 255, height >> 8)
    for (let p = 0; p < width * height; p += 8) {
      let packed = 0
      for (let bit = 0; bit < 8; bit++) if (data[(p + bit) * 4] < 160) packed |= 1 << (7 - bit)
      bytes.push(packed)
    }
  }
  bytes.push(10, 10, 10)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.slice(i, i + 8192))
  return btoa(binary)
}

export const bluetoothPrinter: PrinterDriver = {
  async send(job, settings) {
    if (!settings.address) throw new PrintFailure('เลือกเครื่องพิมพ์ก่อนส่งงาน')
    const data = await raster(job, settings.width)
    try { await hardware.send({ address: settings.address, data }) }
    catch (error) {
      const code = (error as { code?: string })?.code
      throw new PrintFailure(error instanceof Error ? error.message : String(error), code !== 'NOT_SENT')
    }
  },
}

export const mockPrinter: PrinterDriver = {
  async send(job) {
    if (!ticketText(job).length) throw new PrintFailure('ไม่มีข้อมูลใบพิมพ์')
  },
}
