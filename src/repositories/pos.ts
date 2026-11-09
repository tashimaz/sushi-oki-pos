import { z } from 'zod'
import { item, money, printer, product, stateSchema, variant, type State, type Ticket } from '../database/model'
import { Storage } from '../database/storage'
import { change, totals } from '../services/money'

type Order = State['orders'][number]
type Item = State['order_items'][number]
type EditProduct = Omit<State['products'][number], 'id' | 'sample' | 'archived'>
type EditVariant = { id?: string; name: string; price: number | null }
const timestamp = () => new Date().toISOString()
const uuid = () => crypto.randomUUID()
const active = (o: Order) => o.status === 'open' || o.status === 'waiting'
export const orderAt = (s: State, table: number) => s.orders.find(o => o.table === table && active(o))
export const itemsOf = (s: State, orderId: string) => s.order_items.filter(i => i.orderId === orderId)
export const subtotalOf = (items: Item[]) => items.reduce((sum, i) => sum + i.qty * i.price, 0)
export const pendingKitchen = (i: Item) => i.qty !== i.sent || (i.qty > 0 && i.note !== i.sentNote)

function openOrder(s: State, id: string) {
  const order = s.orders.find(o => o.id === id && active(o))
  if (!order) throw new Error('ออเดอร์นี้ปิดแล้วหรือไม่พบออเดอร์')
  return order
}
function log(s: State, orderId: string, action: string, detail: string) {
  s.audit_logs.push({ id: uuid(), orderId, action, detail, at: timestamp() })
}
function queue(s: State, ticket: Ticket, copyOf: string | null = null) {
  const id = uuid()
  s.print_jobs.push({ id, ticket, copyOf, state: 'queued', error: '' })
  return id
}
function queueOrder(s: State, o: Order) {
  const items = itemsOf(s, o.id)
  const lines: Ticket['lines'] = []
  for (const i of items.filter(pendingKitchen)) {
    if (i.sent > 0 && i.sentNote !== i.note) {
      lines.push({ name: i.name, price: i.price, qty: -i.sent, note: i.sentNote })
      if (i.qty) lines.push({ name: i.name, price: i.price, qty: i.qty, note: i.note })
    } else if (i.qty !== i.sent) {
      lines.push({ name: i.name, price: i.price, qty: i.qty - i.sent, note: i.note })
    }
    i.sent = i.qty
    i.sentNote = i.note
  }
  if (!lines.length) return false
  const header = { orderId: o.id, table: o.table, at: timestamp() }
  queue(s, { ...header, kind: 'kitchen', lines })
  queue(s, { ...header, kind: 'accounting', lines: items.filter(i => i.qty > 0)
    .map(i => ({ name: i.name, price: i.price, qty: i.qty, note: i.note })) })
  log(s, o.id, 'queued', 'เข้าคิวใบครัวและใบบัญชี')
  return true
}

const backupSchema = z.object({ format: z.literal('sushi-oki-pos'), version: z.literal(1), state: stateSchema })
const menuSchema = z.object({
  format: z.literal('sushi-oki-menu'), version: z.literal(1),
  products: z.array(z.object({
    category: z.string(), name: product.shape.name, sample: z.boolean().default(false),
    needsReview: z.boolean(), variants: z.array(variant.pick({ name: true, price: true })).min(1).max(20),
  })).min(1).max(500),
})
function validateBackup(s: State) {
  const require = (ok: boolean) => { if (!ok) throw new Error('ข้อมูลสำรองมีความสัมพันธ์หรือยอดเงินไม่ถูกต้อง') }
  for (const rows of Object.values(s)) require(new Set(rows.map(row => row.id)).size === rows.length)
  require(s.tables.length === 8 && s.tables.every(t => t.id === String(t.number)))
  require(s.printer_settings.length === 1 && s.printer_settings[0].id === 'default')
  const orders = new Map(s.orders.map(o => [o.id, o]))
  const variants = new Set(s.product_variants.map(v => v.id))
  const products = new Set(s.products.map(p => p.id))
  const categories = new Set(s.categories.map(c => c.id))
  require(s.products.every(p => categories.has(p.categoryId)))
  require(s.product_variants.every(v => products.has(v.productId)))
  require(s.order_items.every(i => orders.has(i.orderId) && variants.has(i.variantId)))
  require(s.audit_logs.every(a => orders.has(a.orderId)))
  const jobs = new Map(s.print_jobs.map(j => [j.id, j]))
  require(s.print_jobs.every(j => (j.ticket.kind === 'test' || orders.has(j.ticket.orderId)) &&
    (j.copyOf === null || (j.copyOf !== j.id && jobs.has(j.copyOf)))))
  require(s.payments.every(p => orders.get(p.orderId)?.status === 'paid'))
  const activeOrders = s.orders.filter(active)
  require(new Set(activeOrders.map(o => o.table)).size === activeOrders.length)
  const billSubtotals = new Map<string, number>()
  for (const i of s.order_items) billSubtotals.set(i.orderId, (billSubtotals.get(i.orderId) ?? 0) + i.price * i.qty)
  const payments = new Map(s.payments.map(p => [p.orderId, p]))
  require(payments.size === s.payments.length)
  for (const o of s.orders.filter(o => o.status === 'paid')) {
    const p = payments.get(o.id)
    require(!!p && p.subtotal === (billSubtotals.get(o.id) ?? 0) &&
      p.total === p.subtotal - p.discount && p.change === p.received - p.total &&
      (p.method === 'cash' || p.change === 0))
  }
}

export class Pos {
  private tail: Promise<unknown> = Promise.resolve()

  constructor(private storage: Storage) {}
  async init() {
    await this.storage.migrate()
    return this.update(s => {
      for (const job of s.print_jobs.filter(j => j.state === 'sending')) {
        job.state = 'uncertain'
        job.error = 'แอปปิดระหว่างส่ง ตรวจใบพิมพ์ก่อนสั่ง COPY'
      }
    })
  }
  async read() { return (await this.storage.read()).state }

  private update<T>(action: (s: State) => T, replace?: State): Promise<{ state: State; result: T }> {
    const task = this.tail.then(async () => {
      const { state, revision } = await this.storage.read()
      const next = structuredClone(replace ?? state)
      const result = action(next)
      await this.storage.commit(revision, state, next, !!replace)
      return { state: next, result }
    })
    this.tail = task.catch(() => {})
    return task
  }

  add(table: number, variantId: string) {
    return this.update(s => {
      if (!s.tables.some(t => t.number === table)) throw new Error('ไม่พบโต๊ะ')
      const v = s.product_variants.find(v => v.id === variantId)
      const p = s.products.find(p => p.id === v?.productId)
      if (!p || !v || v.price === null || p.needsReview || p.soldOut || p.archived) {
        throw new Error('เมนูนี้ยังไม่พร้อมขาย')
      }
      let o = orderAt(s, table)
      if (o?.status === 'waiting') throw new Error('กลับไปแก้ไขออเดอร์ก่อนเพิ่มรายการ')
      if (!o) {
        o = { id: uuid(), table, opened: timestamp(), status: 'open' }
        s.orders.push(o)
        log(s, o.id, 'opened', `เปิดโต๊ะ ${table}`)
      }
      const label = v.name === 'ปกติ' ? p.name : `${p.name} · ${v.name}`
      const existing = itemsOf(s, o.id).find(i => i.qty > 0 && i.variantId === v.id &&
        i.price === v.price && i.name === label && !i.note)
      const record = item.parse(existing ? { ...existing, qty: existing.qty + 1 } : {
        id: uuid(), orderId: o.id, variantId, name: label, price: v.price, qty: 1, sent: 0, note: '', sentNote: '',
      })
      money.parse(subtotalOf(itemsOf(s, o.id)) + record.price)
      if (existing) Object.assign(existing, record)
      else s.order_items.push(record)
      log(s, o.id, 'added', `${record.name} +1`)
    })
  }

  edit(orderId: string, id: string, qty: number, note: string) {
    return this.update(s => {
      const o = openOrder(s, orderId)
      if (o.status !== 'open') throw new Error('กลับไปแก้ไขออเดอร์ก่อน')
      const i = itemsOf(s, orderId).find(i => i.id === id)
      if (!i) throw new Error('ไม่พบรายการ')
      if (i.qty === qty && i.note === note) return
      const previous = `${i.qty} × ${i.name} [${i.note}]`
      Object.assign(i, item.parse({ ...i, qty, note }))
      money.parse(subtotalOf(itemsOf(s, orderId)))
      log(s, orderId, qty === 0 ? 'item-cancelled' : 'edited', `${previous} → ${qty} × ${i.name} [${note}]`)
    })
  }

  move(id: string, destination: number) {
    return this.update(s => {
      const o = openOrder(s, id)
      if (!s.tables.some(t => t.number === destination) || orderAt(s, destination)) throw new Error('โต๊ะปลายทางไม่ว่าง')
      log(s, id, 'moved', `โต๊ะ ${o.table} → โต๊ะ ${destination}`)
      o.table = destination
    })
  }

  cancel(id: string) {
    return this.update(s => {
      const o = openOrder(s, id)
      for (const i of itemsOf(s, id)) i.qty = 0
      queueOrder(s, o)
      o.status = 'cancelled'
      log(s, id, 'cancelled', `ยกเลิกออเดอร์โต๊ะ ${o.table}`)
    })
  }

  send(id: string) {
    return this.update(s => queueOrder(s, openOrder(s, id)))
  }

  waiting(id: string, waiting: boolean) {
    return this.update(s => {
      const o = openOrder(s, id)
      if (waiting && !itemsOf(s, id).some(i => i.qty > 0)) throw new Error('เพิ่มอาหารก่อนคิดเงิน')
      o.status = waiting ? 'waiting' : 'open'
      log(s, id, waiting ? 'checkout' : 'reopened', waiting ? 'รอชำระเงิน' : 'กลับไปแก้ไข')
    })
  }

  pay(id: string, method: 'cash' | 'qr', discount: number, mode: 'amount' | 'percent', received: number, verified: boolean) {
    return this.update(s => {
      const o = openOrder(s, id)
      if (o.status !== 'waiting' || s.payments.some(p => p.orderId === id)) throw new Error('ออเดอร์ไม่พร้อมชำระ')
      const items = itemsOf(s, id)
      if (!items.some(i => i.qty > 0)) throw new Error('ไม่มีรายการอาหาร')
      if (method === 'qr' && !verified) throw new Error('กรุณาตรวจสอบยอดรับจริงก่อนยืนยัน')
      const amount = totals(subtotalOf(items), discount, mode)
      const tendered = method === 'qr' ? amount.total : received
      const changeDue = change(amount.total, tendered)
      queueOrder(s, o)
      s.payments.push({ id: uuid(), orderId: id, at: timestamp(), method, ...amount, received: tendered, change: changeDue })
      o.status = 'paid'
      log(s, id, 'paid', `รับชำระ ${method.toUpperCase()} ${(amount.total / 100).toFixed(2)} บาท`)
    })
  }

  saveProduct(id: string | undefined, data: EditProduct, variants: EditVariant[]) {
    return this.update(s => {
      if (!s.categories.some(c => c.id === data.categoryId)) throw new Error('ไม่พบหมวดหมู่')
      if (!variants.length || variants.length > 20) throw new Error('กรุณาระบุ 1–20 ขนาด')
      const old = s.products.find(p => p.id === id)
      if (id && !old) throw new Error('ไม่พบเมนู')
      const productId = old?.id ?? uuid()
      const update = product.parse({ ...data, id: productId, sample: old?.sample ?? false,
        archived: old?.archived ?? false, needsReview: data.needsReview || variants.some(v => v.price === null) })
      const values = variants.map(v => variant.parse({ ...v, id: v.id ?? uuid(), productId }))
      if (new Set(values.map(v => v.id)).size !== values.length) throw new Error('ขนาดซ้ำ')
      for (const v of values) {
        const existing = s.product_variants.find(current => current.id === v.id)
        if (existing && existing.productId !== productId) throw new Error('ขนาดไม่ตรงกับเมนู')
        if (existing) Object.assign(existing, v)
        else s.product_variants.push(v)
      }
      for (const v of s.product_variants.filter(v => v.productId === productId && !values.some(a => a.id === v.id))) {
        v.price = null
      }
      if (old) Object.assign(old, update)
      else s.products.push(update)
    })
  }

  archiveProduct(id: string) {
    return this.update(s => {
      const p = s.products.find(p => p.id === id)
      if (p) p.archived = true
    })
  }

  importMenu(json: unknown) {
    const menu = menuSchema.parse(json)
    return this.update(s => {
      for (const entry of menu.products) {
        const category = s.categories.find(c => c.name === entry.category)
        if (!category) throw new Error(`ไม่พบหมวดหมู่ ${entry.category}`)
        if (s.products.some(p => !p.archived && p.name === entry.name && p.categoryId === category.id)) {
          throw new Error(`มีเมนู ${entry.name} อยู่แล้ว`)
        }
        const id = uuid()
        s.products.push({ id, categoryId: category.id, name: entry.name, sample: entry.sample, archived: false,
          soldOut: false, needsReview: entry.needsReview || entry.variants.some(v => v.price === null) })
        s.product_variants.push(...entry.variants.map(v => ({ ...v, id: uuid(), productId: id })))
      }
    })
  }

  settings(width: 58 | 80, address: string) {
    return this.update(s => { s.printer_settings[0] = printer.parse({ id: 'default', width, address }) })
  }
  testTicket() {
    return this.update(s => queue(s, { kind: 'test', orderId: 'TEST', at: timestamp(), table: 0,
      lines: [{ name: 'ทดสอบภาษาไทย · ซูชิโอกิ', qty: 1, price: 0, note: 'ไม่ใส่วาซาบิ' }] }))
  }
  copy(id: string) {
    return this.update(s => {
      const job = s.print_jobs.find(j => j.id === id)
      if (!job || job.state === 'sending') throw new Error('งานพิมพ์ยังไม่พร้อมทำสำเนา')
      return queue(s, job.ticket, job.copyOf ?? id)
    })
  }
  retry(id: string) {
    return this.update(s => {
      const job = s.print_jobs.find(j => j.id === id && j.state === 'failed')
      if (!job) throw new Error('งานนี้ไม่พร้อมส่งซ้ำ')
      job.state = 'queued'
      job.error = ''
    })
  }
  claim() {
    return this.update(s => {
      if (s.print_jobs.some(j => j.state === 'sending')) return
      const job = s.print_jobs.find(j => j.state === 'queued')
      if (job) job.state = 'sending'
      return job
    })
  }
  finish(id: string, state: 'delivered' | 'failed' | 'uncertain', message = '') {
    return this.update(s => {
      const job = s.print_jobs.find(j => j.id === id && j.state === 'sending')
      if (!job) throw new Error('ไม่พบงานที่กำลังส่ง')
      job.state = state
      job.error = message.slice(0, 500)
    })
  }
  async backup() {
    return { format: 'sushi-oki-pos', version: 1, state: await this.read() }
  }
  restore(json: unknown) {
    const { state } = backupSchema.parse(json)
    validateBackup(state)
    return this.update(s => {
      for (const j of s.print_jobs.filter(j => j.state === 'sending' || j.state === 'queued')) {
        j.state = 'uncertain'
        j.error = 'กู้คืนจากไฟล์สำรอง ตรวจใบพิมพ์ก่อนสั่ง COPY'
      }
    }, state)
  }
}
