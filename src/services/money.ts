import { money } from '../database/model'

export function satang(input: string): number {
  if (!/^\d{1,8}(?:\.\d{1,2})?$/.test(input.trim())) throw new Error('กรอกจำนวนเงินให้ถูกต้อง (ทศนิยมไม่เกิน 2 ตำแหน่ง)')
  const [whole, fraction = ''] = input.trim().split('.')
  return money.parse(Number(whole) * 100 + Number(fraction.padEnd(2, '0')))
}

export function totals(subtotal: number, discount: number, mode: 'amount' | 'percent') {
  money.parse(subtotal)
  money.parse(discount)
  if (mode === 'percent' && discount > 10000) throw new Error('ส่วนลดต้องไม่เกิน 100%')
  const deduction = mode === 'percent' ? Math.round(subtotal * discount / 10000) : discount
  if (deduction > subtotal) throw new Error('ส่วนลดต้องไม่เกินยอดรวม')
  return { subtotal, discount: deduction, total: subtotal - deduction }
}
export function change(total: number, received: number) {
  money.parse(received)
  if (received < total) throw new Error('เงินรับน้อยกว่ายอดชำระ')
  return received - total
}
const format = new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB' })
export const baht = (cents: number) => format.format(cents / 100)
export const bangkokDate = (date = new Date()) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(date)
export const bangkokTime = (value: string) => new Intl.DateTimeFormat('th-TH', {
  timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short',
}).format(new Date(value))
