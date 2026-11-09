import type { State } from '../database/model'
import { bangkokDate } from './money'

export function daily(s: State, day: string) {
  const payments = s.payments.filter(p => bangkokDate(new Date(p.at)) === day)
  const orderIds = new Set(payments.map(p => p.orderId))
  const ranking = new Map<string, number>()
  for (const i of s.order_items.filter(i => i.qty > 0 && orderIds.has(i.orderId))) {
    ranking.set(i.name, (ranking.get(i.name) ?? 0) + i.qty)
  }
  const cash = payments.filter(p => p.method === 'cash').reduce((sum, p) => sum + p.total, 0)
  const qr = payments.filter(p => p.method === 'qr').reduce((sum, p) => sum + p.total, 0)
  const audit = s.audit_logs.filter(a => bangkokDate(new Date(a.at)) === day)
  return { payments, cash, qr, total: cash + qr, ranking: [...ranking].sort((a, b) => b[1] - a[1]), audit }
}

export function csv(s: State, day: string) {
  const { payments } = daily(s, day)
  const orders = new Map(s.orders.map(o => [o.id, o]))
  const lines = [
    ['เลขออเดอร์', 'โต๊ะ', 'วันเวลา Asia/Bangkok', 'ช่องทาง', 'ยอดก่อนลด', 'ส่วนลด', 'ยอดสุทธิ', 'รับเงิน', 'เงินทอน'],
    ...payments.map(p => [
      p.orderId, orders.get(p.orderId)?.table, new Date(p.at).toLocaleString('sv-SE', { timeZone: 'Asia/Bangkok' }),
      p.method, ...[p.subtotal, p.discount, p.total, p.received, p.change].map(value => (value / 100).toFixed(2)),
    ]),
  ]
  return '\ufeff' + lines.map(row => row.map(value => {
    const cell = String(value ?? '')
    const safe = /^[\s]*[=+\-@]/.test(cell) ? "'" + cell : cell
    return '"' + safe.replaceAll('"', '""') + '"'
  }).join(',')).join('\r\n')
}
