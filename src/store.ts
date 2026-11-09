import { create } from 'zustand'
import { Storage, platformDriver } from './database/storage'
import type { State } from './database/model'
import { Pos } from './repositories/pos'
import { bluetoothPrinter, mockPrinter, native, PrintFailure } from './services/printing'

type Result<T> = { state: State; result: T }
type Store = {
  data?: State
  pos?: Pos
  busy: boolean
  error: string
  notice: string
  init(): Promise<void>
  act<T>(action: (pos: Pos) => Promise<Result<T>>, success?: string): Promise<Result<T> | undefined>
  task<T>(action: (pos: Pos) => Promise<T>, success?: string): Promise<T | undefined>
  drain(): Promise<void>
  dismiss(): void
}

export const usePos = create<Store>((set, get) => ({
  busy: false, error: '', notice: '',
  async init() {
    if (get().busy || get().pos) return
    set({ busy: true, error: '' })
    try {
      const pos = new Pos(new Storage(await platformDriver()))
      set({ pos, data: (await pos.init()).state })
      set({ busy: false })
      await get().drain()
    } catch (error) { set({ error: message(error), busy: false }) }
  },
  async task(action, success) {
    const { pos, busy } = get()
    if (!pos || busy) return
    set({ busy: true, error: '', notice: '' })
    try {
      const result = await action(pos)
      if (success) set({ notice: success })
      return result
    } catch (error) { set({ error: message(error) }) }
    finally { set({ busy: false }) }
  },
  async act(action, success) {
    const result = await get().task(async pos => {
      const result = await action(pos)
      set({ data: result.state })
      return result
    }, success)
    return result
  },
  async drain() {
    if (draining) return
    const { pos, data } = get()
    if (!pos || !data || (native && !data.printer_settings[0].address)) return
    draining = true
    try {
      while (true) {
        const claim = await pos.claim()
        set({ data: claim.state })
        const job = claim.result
        if (!job) break
        let state: 'delivered' | 'failed' | 'uncertain' = 'delivered'
        let error = ''
        try { await (native ? bluetoothPrinter : mockPrinter).send(job, claim.state.printer_settings[0]) }
        catch (reason) {
          state = reason instanceof PrintFailure && reason.uncertain ? 'uncertain' : 'failed'
          error = message(reason)
        }
        set({ data: (await pos.finish(job.id, state, error)).state })
        if (state !== 'delivered') {
          set({ error: 'คิวหยุดหลังส่งไม่สำเร็จ เปิดหน้าคิวพิมพ์เพื่อตรวจสอบ' })
          break
        }
      }
    } catch (error) { set({ error: message(error) }) }
    finally { draining = false }
  },
  dismiss() { set({ error: '', notice: '' }) },
}))
let draining = false
const message = (error: unknown) => error instanceof Error ? error.message : String(error)
