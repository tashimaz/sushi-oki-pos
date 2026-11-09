import { z } from 'zod'

const id = z.string().min(1).max(100)
const name = z.string().trim().min(1).max(120)
export const money = z.number().int().min(0).max(1_000_000_000)
const instant = z.iso.datetime()
const row = { id }
export const category = z.object({ ...row, name })
export const product = z.object({
  ...row, name, categoryId: id, soldOut: z.boolean(), archived: z.boolean(),
  needsReview: z.boolean(), sample: z.boolean(),
})
export const variant = z.object({ ...row, productId: id, name, price: money.nullable(), archived: z.boolean().optional() })
export const order = z.object({
  ...row, table: z.number().int().min(1).max(8), opened: instant,
  status: z.enum(['open', 'waiting', 'paid', 'cancelled']),
})
export const item = z.object({
  ...row, orderId: id, variantId: id, name, price: money,
  qty: z.number().int().min(0).max(999), sent: z.number().int().min(0).max(999),
  note: z.string().max(240), sentNote: z.string().max(240),
})
export const payment = z.object({
  ...row, orderId: id, at: instant, method: z.enum(['cash', 'qr']),
  subtotal: money, discount: money, total: money, received: money, change: money,
})
export const printLine = z.object({ name, qty: z.number().int(), price: money, note: z.string().max(240) })
export const ticket = z.object({
  kind: z.enum(['kitchen', 'accounting', 'test']), at: instant, orderId: id,
  table: z.number().int().min(0).max(8), lines: z.array(printLine), message: z.string().max(200).optional(),
})
export const job = z.object({
  ...row, ticket, state: z.enum(['queued', 'sending', 'delivered', 'failed', 'uncertain']),
  copyOf: id.nullable(), error: z.string().max(500),
})
export const audit = z.object({
  ...row, orderId: id, at: instant, action: id, detail: z.string().max(2000),
})
export const printer = z.object({
  ...row, width: z.union([z.literal(58), z.literal(80)]), address: z.string().max(100),
})
export const rows = {
  categories: category,
  products: product,
  product_variants: variant,
  tables: z.object({ ...row, number: z.number().int().min(1).max(8) }),
  orders: order,
  order_items: item,
  payments: payment,
  print_jobs: job,
  printer_settings: printer,
  audit_logs: audit,
  app_settings: z.object({ ...row, value: z.string() }),
}
export type Collection = keyof typeof rows
export type State = { [K in Collection]: z.infer<(typeof rows)[K]>[] }
export type Ticket = z.infer<typeof ticket>
export type Job = z.infer<typeof job>
export type PrinterSettings = z.infer<typeof printer>
export type Product = z.infer<typeof product>
export type Variant = z.infer<typeof variant>
export const collections = Object.keys(rows) as Collection[]
export const stateSchema = z.object({
  categories: z.array(category), products: z.array(product), product_variants: z.array(variant),
  tables: z.array(rows.tables), orders: z.array(order), order_items: z.array(item),
  payments: z.array(payment), print_jobs: z.array(job), printer_settings: z.array(printer),
  audit_logs: z.array(audit), app_settings: z.array(rows.app_settings),
})
