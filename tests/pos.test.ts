import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Storage, sqlJsDriver } from '../src/database/storage'
import { Pos, orderAt, itemsOf, subtotalOf } from '../src/repositories/pos'
import { bangkokDate, change, satang, totals } from '../src/services/money'
import { csv, daily } from '../src/services/reports'
import { mockPrinter, ticketText } from '../src/services/printing'

let sql: SqlJsStatic
let storage: Storage
let pos: Pos
const salmon = 'variant-0-0'

beforeAll(async () => { sql = await initSqlJs() })
beforeEach(async () => {
  storage = new Storage(sqlJsDriver(sql))
  pos = new Pos(storage)
  await pos.init()
})
async function enable(price = 7990) {
  await pos.saveProduct('sample-0', { name: 'ซูชิแซลมอน', categoryId: 'category-0', soldOut: false, needsReview: false },
    [{ id: salmon, name: 'ปกติ', price }])
}
async function add(table = 1) {
  const { state } = await pos.add(table, salmon)
  return orderAt(state, table)!.id
}

describe('money and reporting', () => {
  it('parses exact satang and rejects ambiguous amounts', () => {
    expect(satang(' 39.05 ')).toBe(3905)
    expect(() => satang('1.001')).toThrow()
    expect(() => satang('1e3')).toThrow()
  })
  it('rounds discounts once and rejects discounts above the total', () => {
    expect(totals(10005, 1250, 'percent')).toEqual({ subtotal: 10005, discount: 1251, total: 8754 })
    expect(totals(10005, 1250, 'amount').total).toBe(8755)
    expect(() => totals(10005, 10006, 'amount')).toThrow()
    expect(() => totals(10005, 10001, 'percent')).toThrow()
  })
  it('validates cash and computes change', () => {
    expect(change(7990, 10000)).toBe(2010)
    expect(() => change(7990, 7989)).toThrow()
  })
  it('uses Bangkok midnight for business dates', () => {
    expect(bangkokDate(new Date('2026-01-01T16:59:59Z'))).toBe('2026-01-01')
    expect(bangkokDate(new Date('2026-01-01T17:00:00Z'))).toBe('2026-01-02')
  })
})

describe('SQLite order workflow', () => {
  it('seeds eight tables and blocks unverified samples', async () => {
    expect((await pos.read()).tables).toHaveLength(8)
    await expect(pos.add(1, salmon)).rejects.toThrow('ยังไม่พร้อมขาย')
    expect((await pos.read()).orders).toHaveLength(0)
  })
  it('stores each change, preserves sale prices and recovers on reopen', async () => {
    await enable()
    const id = await add()
    await add()
    const item = itemsOf(await pos.read(), id)[0]
    await pos.edit(id, item.id, 3, 'ไม่ใส่วาซาบิ')
    await enable(8500)
    await add()
    const reopened = new Pos(storage)
    const { state } = await reopened.init()
    expect(orderAt(state, 1)?.id).toBe(id)
    expect(itemsOf(state, id)).toMatchObject([{ qty: 3, price: 7990, note: 'ไม่ใส่วาซาบิ' }, { qty: 1, price: 8500 }])
    expect(subtotalOf(itemsOf(state, id))).toBe(32470)
  })
  it('keeps table occupancy consistent and rejects moving to an occupied table', async () => {
    await enable()
    const first = await add()
    await add(2)
    await expect(pos.move(first, 2)).rejects.toThrow()
    const { state } = await pos.move(first, 3)
    expect(orderAt(state, 1)).toBeUndefined()
    expect(orderAt(state, 3)?.id).toBe(first)
    expect(state.audit_logs.at(-1)?.action).toBe('moved')
  })
  it('audits item cancellation and releases a cancelled table', async () => {
    await enable()
    const id = await add()
    const item = itemsOf(await pos.read(), id)[0]
    await pos.edit(id, item.id, 0, '')
    const { state } = await pos.cancel(id)
    expect(orderAt(state, 1)).toBeUndefined()
    expect(state.audit_logs.map(a => a.action)).toContain('item-cancelled')
    expect(state.orders[0].status).toBe('cancelled')
  })
  it('checks QR manually and commits at most one payment during concurrent requests', async () => {
    await enable()
    const id = await add()
    await pos.waiting(id, true)
    await expect(pos.pay(id, 'qr', 0, 'amount', 0, false)).rejects.toThrow('ตรวจสอบ')
    const results = await Promise.allSettled([
      pos.pay(id, 'qr', 0, 'amount', 0, true),
      pos.pay(id, 'cash', 0, 'amount', 10000, false),
    ])
    expect(results.map(r => r.status)).toEqual(['fulfilled', 'rejected'])
    const state = await pos.read()
    expect(state.payments).toHaveLength(1)
    expect(state.print_jobs).toHaveLength(2)
    expect(orderAt(state, 1)).toBeUndefined()
    expect(state.orders[0].status).toBe('paid')
    await expect(pos.cancel(id)).rejects.toThrow()
    expect(daily(state, bangkokDate()).qr).toBe(7990)
    expect(csv(state, bangkokDate())).toContain('"79.90"')
  })
  it('rejects stale writers without applying any part of a transaction', async () => {
    const { state, revision } = await storage.read()
    await enable()
    const stale = structuredClone(state)
    stale.printer_settings[0].width = 80
    await expect(storage.commit(revision, state, stale)).rejects.toThrow()
    expect((await pos.read()).printer_settings[0].width).toBe(58)
  })
})

describe('printing and recovery', () => {
  it('queues both tickets once and sends only new units to the kitchen', async () => {
    await enable()
    const id = await add()
    await Promise.all([pos.send(id), pos.send(id)])
    expect((await pos.read()).print_jobs).toHaveLength(2)
    await add()
    const { state } = await pos.send(id)
    const tickets = state.print_jobs.map(j => j.ticket)
    expect(tickets.map(t => t.kind)).toEqual(['kitchen', 'accounting', 'kitchen', 'accounting'])
    expect(tickets.map(t => t.lines[0].qty)).toEqual([1, 1, 1, 2])
    expect(ticketText(state.print_jobs[0]).join(' ')).not.toContain('฿')
    expect(ticketText(state.print_jobs[1]).join(' ')).toContain('79.90')
  })
  it('notifies the kitchen of a move without reprinting food', async () => {
    await enable()
    const id = await add()
    await pos.send(id)
    const { state } = await pos.move(id, 2)
    expect(state.print_jobs.at(-1)?.ticket).toMatchObject({
      kind: 'kitchen', table: 2, message: 'ย้ายโต๊ะ 1 → โต๊ะ 2', lines: [],
    })
  })
  it('sends cancellation and reissue when a dispatched note changes', async () => {
    await enable()
    const id = await add()
    const before = await pos.send(id)
    await pos.edit(id, before.state.order_items[0].id, 1, 'ไม่ใส่ผัก')
    const { state } = await pos.send(id)
    expect(state.print_jobs[2].ticket.lines).toMatchObject([{ qty: -1, note: '' }, { qty: 1, note: 'ไม่ใส่ผัก' }])
  })
  it('preserves failed jobs, retries safely and labels explicit copies', async () => {
    const queued = await pos.testTicket()
    const id = queued.result
    const claimed = (await pos.claim()).result!
    expect(claimed.id).toBe(id)
    await pos.finish(id, 'failed', 'Bluetooth disconnected before send')
    await pos.testTicket()
    expect((await pos.claim()).result).toBeUndefined()
    await pos.retry(id)
    const next = (await pos.claim()).result!
    expect(next.id).toBe(id)
    await mockPrinter.send(next, queued.state.printer_settings[0])
    await pos.finish(id, 'delivered')
    const { state, result } = await pos.copy(id)
    expect(result).not.toBe(id)
    expect(ticketText(state.print_jobs.at(-1)!)).toContain('COPY')
  })
  it('recovers interrupted printing as uncertain without retrying the original', async () => {
    await pos.testTicket()
    await pos.claim()
    const reopened = new Pos(storage)
    const { state } = await reopened.init()
    expect(state.print_jobs[0].state).toBe('uncertain')
    expect((await reopened.claim()).result).toBeUndefined()
    await expect(reopened.retry(state.print_jobs[0].id)).rejects.toThrow()
  })
  it('restores valid backup atomically and rejects invalid references', async () => {
    await enable()
    const id = await add()
    await pos.send(id)
    const backup = await pos.backup()
    await pos.cancel(id)
    const { state } = await pos.restore(backup)
    expect(orderAt(state, 1)?.id).toBe(id)
    expect(state.print_jobs.every(j => j.state === 'uncertain')).toBe(true)
    backup.state.order_items[0].orderId = 'nonexistent'
    expect(() => pos.restore(backup)).toThrow()
    expect(orderAt(await pos.read(), 1)?.id).toBe(id)
  })
})
