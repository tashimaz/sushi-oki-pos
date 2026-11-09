import { Capacitor, registerPlugin } from '@capacitor/core'
import { openDB } from 'idb'
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js'
import wasm from 'sql.js/dist/sql-wasm.wasm?url'
import { collections, stateSchema, type State } from './model'
import { seed } from './seed'

type Value = number | string | null
type Statement = { sql: string; args?: Value[]; changed?: boolean }
type Raw = Record<string, Record<string, string>[]>
export interface SqlDriver {
  read(queries: Record<string, string>): Promise<Raw>
  write(statements: Statement[]): Promise<void>
}
export const nativeDb = registerPlugin<{
  read(input: { queries: Record<string, string> }): Promise<Raw>
  write(input: { statements: Statement[] }): Promise<void>
}>('PosDatabase')

export function sqlJsDriver(sql: SqlJsStatic, indexed?: Awaited<ReturnType<typeof openDB>>): SqlDriver {
  let bytes: Uint8Array | undefined
  const open = (data?: Uint8Array): Database => new sql.Database(data)
  return {
    async read(queries) {
      const db = open(indexed ? await indexed.get('sqlite', 'pos') : bytes)
      try {
        return Object.fromEntries(Object.entries(queries).map(([key, query]) => [
          key, db.exec(query).flatMap(result => result.values.map(row =>
            Object.fromEntries(result.columns.map((col, i) => [col, String(row[i])])))),
        ]))
      } finally { db.close() }
    },
    async write(statements) {
      const transaction = indexed?.transaction('sqlite', 'readwrite')
      const db = open(transaction ? await transaction.store.get('pos') : bytes)
      try {
        db.run('BEGIN')
        for (const { sql, args, changed } of statements) {
          db.run(sql, args)
          if (changed && db.getRowsModified() !== 1) throw new Error('ข้อมูลถูกแก้ไขจากอีกหน้าต่าง กรุณาโหลดใหม่')
        }
        db.run('COMMIT')
        const updated = db.export()
        if (transaction) {
          await transaction.store.put(updated, 'pos')
          await transaction.done
        } else bytes = updated
      } catch (error) {
        if (transaction) {
          try { transaction.abort() } catch { /* Already ended */ }
          await transaction.done.catch(() => {})
        }
        throw error
      } finally { db.close() }
    },
  }
}

export async function platformDriver(): Promise<SqlDriver> {
  if (Capacitor.isNativePlatform()) {
    return {
      read: queries => nativeDb.read({ queries }),
      write: statements => nativeDb.write({ statements }),
    }
  }
  const [sql, indexed] = await Promise.all([
    initSqlJs({ locateFile: () => wasm }),
    openDB('sushi-oki', 1, { upgrade: db => db.createObjectStore('sqlite') }),
  ])
  return sqlJsDriver(sql, indexed)
}

const columns = {
  orders: ', table_no INTEGER NOT NULL, active INTEGER NOT NULL',
  payments: ', order_id TEXT NOT NULL UNIQUE',
}
function save(table: keyof State, record: State[keyof State][number]): Statement {
  const values: Value[] = [record.id, JSON.stringify(record)]
  const fields = ['id', 'body']
  if (table === 'orders' && 'table' in record) {
    fields.push('table_no', 'active')
    values.push(record.table, Number(record.status === 'open' || record.status === 'waiting'))
  }
  if (table === 'payments' && 'orderId' in record) {
    fields.push('order_id')
    values.push(record.orderId)
  }
  return {
    sql: `INSERT INTO ${table} (${fields.join(',')}) VALUES (${values.map(() => '?').join(',')})
      ON CONFLICT(id) DO UPDATE SET ${fields.slice(1).map(field => `${field}=excluded.${field}`).join(',')}`,
    args: values,
  }
}

export class Storage {
  constructor(private driver: SqlDriver) {}

  async migrate() {
    await this.driver.write([{ sql: 'CREATE TABLE IF NOT EXISTS pos_metadata (id INTEGER PRIMARY KEY, version INTEGER NOT NULL, revision INTEGER NOT NULL)' }])
    const { metadata } = await this.driver.read({ metadata: 'SELECT version FROM pos_metadata WHERE id=1' })
    if (metadata[0]?.version === '1') return
    if (metadata.length) throw new Error('ฐานข้อมูลมาจากแอปรุ่นที่ใหม่กว่า')
    await this.driver.write([
      ...collections.map(table => ({
        sql: `CREATE TABLE IF NOT EXISTS ${table} (id TEXT PRIMARY KEY NOT NULL, body TEXT NOT NULL${columns[table as keyof typeof columns] ?? ''})`,
      })),
      { sql: 'CREATE UNIQUE INDEX IF NOT EXISTS one_active_order ON orders(table_no) WHERE active=1' },
      { sql: 'INSERT OR IGNORE INTO pos_metadata VALUES (1,1,0)', changed: true },
      ...collections.flatMap(table => seed[table].map(row => save(table, row))),
    ])
  }

  async read() {
    const queries = Object.fromEntries(collections.map(table => [table, `SELECT body FROM ${table} ORDER BY rowid`]))
    const raw = await this.driver.read({ ...queries, metadata: 'SELECT revision FROM pos_metadata WHERE id=1' })
    return {
      revision: Number(raw.metadata[0].revision),
      state: stateSchema.parse(Object.fromEntries(collections.map(table =>
        [table, raw[table].map(row => JSON.parse(row.body))]))),
    }
  }

  async commit(revision: number, previous: State, next: State, replace = false) {
    const statements: Statement[] = [{
      sql: 'UPDATE pos_metadata SET revision=revision+1 WHERE id=1 AND revision=?',
      args: [revision], changed: true,
    }]
    for (const table of collections) {
      if (replace) statements.push({ sql: `DELETE FROM ${table}` })
      const before = new Map(previous[table].map(row => [row.id, JSON.stringify(row)]))
      for (const record of next[table]) {
        if (replace || JSON.stringify(record) !== before.get(record.id)) statements.push(save(table, record))
      }
    }
    await this.driver.write(statements)
  }
}
