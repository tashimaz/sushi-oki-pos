import { useState } from 'react'
import type { Product, State, Variant } from '../database/model'
import { usePos } from '../store'
import { baht, bangkokDate, bangkokTime, satang } from '../services/money'
import { daily, csv } from '../services/reports'
import { readJson, saveFile } from '../services/files'
import { hardware, native, ticketText } from '../services/printing'

export function Menu({ data }: { data: State }) {
  const [editing, setEditing] = useState<string | null>(null)
  const { act, busy } = usePos()
  const current = data.products.find(p => p.id === editing)
  return <>
    <div className="spread"><h1>จัดการเมนู</h1><button className="primary" disabled={busy} onClick={() => setEditing('new')}>+ เพิ่มเมนู</button></div>
    <p className="muted">รายการตัวอย่างจะขายได้เมื่อใส่ราคาและเอาเครื่องหมายรอยืนยันราคาออก</p>
    {editing && <MenuEditor key={editing} data={data} current={current}
      variants={data.product_variants.filter(v => v.productId === editing)} close={() => setEditing(null)} />}
    <div className="panel list">
      {data.products.filter(p => !p.archived).map(p => <div className="spread" key={p.id}>
        <div><strong>{p.name}</strong><br /><small>{[data.categories.find(c => c.id === p.categoryId)?.name,
          p.sample && 'ตัวอย่าง', p.needsReview && 'รอยืนยันราคา', p.soldOut && 'หมด'].filter(Boolean).join(' · ')}</small></div>
        <div className="actions">
          <button disabled={busy} onClick={() => setEditing(p.id)}>แก้ไข</button>
          <button disabled={busy} className="danger" onClick={async () => {
            if (confirm(`นำ ${p.name} ออกจากเมนู?`) && await act(pos => pos.archiveProduct(p.id), 'นำออกจากเมนูแล้ว')) {
              if (editing === p.id) setEditing(null)
            }
          }}>ลบ</button>
        </div>
      </div>)}
    </div>
  </>
}

function MenuEditor({ data, current, variants, close }: { data: State; current?: Product; variants: Variant[]; close: () => void }) {
  const { act, busy } = usePos()
  const [name, setName] = useState(current?.name ?? '')
  const [categoryId, setCategory] = useState(current?.categoryId ?? data.categories[0].id)
  const [soldOut, setSoldOut] = useState(current?.soldOut ?? false)
  const [needsReview, setReview] = useState(current?.needsReview ?? false)
  const [sizes, setSizes] = useState<{ id?: string; key: string; name: string; price: string }[]>(variants.length ? variants.map(v => ({
    id: v.id, key: v.id, name: v.name, price: v.price === null ? '' : (v.price / 100).toFixed(2),
  })) : [{ id: undefined, key: 'default', name: 'ปกติ', price: '' }])
  const update = (key: string, change: { name?: string; price?: string }) =>
    setSizes(sizes.map(v => v.key === key ? { ...v, ...change } : v))
  return <form className="panel list" onSubmit={async e => {
    e.preventDefault()
    if (await act(pos => pos.saveProduct(current?.id, { name, categoryId, soldOut, needsReview },
      sizes.map(v => ({ id: v.id, name: v.name, price: v.price.trim() ? satang(v.price) : null }))), 'บันทึกเมนูแล้ว')) close()
  }}>
    <h2>{current ? 'แก้ไขเมนู' : 'เพิ่มเมนู'}</h2>
    <label>ชื่ออาหาร<input required maxLength={100} value={name} onChange={e => setName(e.target.value)} /></label>
    <label>หมวดหมู่<select value={categoryId} onChange={e => setCategory(e.target.value)}>
      {data.categories.map(c => <option value={c.id} key={c.id}>{c.name}</option>)}
    </select></label>
    {sizes.map((v, i) => <div className="size-row" key={v.key}>
      <label>ขนาด {i + 1}<input required maxLength={18} value={v.name} onChange={e => update(v.key, { name: e.target.value })} /></label>
      <label>ราคา (บาท)<input inputMode="decimal" value={v.price} onChange={e => update(v.key, { price: e.target.value })} /></label>
      <button type="button" disabled={sizes.length < 2} onClick={() => setSizes(sizes.filter(s => s.key !== v.key))}>ลบ</button>
    </div>)}
    <button type="button" disabled={sizes.length >= 20} onClick={() => setSizes([...sizes, { id: undefined, key: crypto.randomUUID(), name: '', price: '' }])}>+ เพิ่มขนาด</button>
    <label className="check"><input type="checkbox" checked={needsReview} onChange={e => setReview(e.target.checked)} />รอยืนยันราคา</label>
    <label className="check"><input type="checkbox" checked={soldOut} onChange={e => setSoldOut(e.target.checked)} />สินค้าหมด</label>
    <div className="actions"><button className="primary" disabled={busy}>บันทึกเมนู</button><button type="button" onClick={close}>ปิด</button></div>
  </form>
}

const events: Record<string, string> = {
  opened: 'เปิดโต๊ะ', added: 'เพิ่มรายการ', edited: 'แก้ไข', 'item-cancelled': 'ยกเลิกรายการ',
  moved: 'ย้ายโต๊ะ', cancelled: 'ยกเลิกออเดอร์', queued: 'เข้าคิวพิมพ์', checkout: 'คิดเงิน',
  reopened: 'กลับไปแก้ไข', paid: 'ชำระเงิน',
}
export function Reports({ data }: { data: State }) {
  const [day, setDay] = useState(bangkokDate)
  const { task, busy } = usePos()
  const r = daily(data, day)
  return <>
    <h1>รายงานยอดขาย</h1>
    <div className="actions"><label>วันที่<input type="date" value={day} onChange={e => setDay(e.target.value)} /></label>
      <button disabled={busy || !day} onClick={() => void task(() => saveFile(`sushi-oki-${day}.csv`, 'text/csv', csv(data, day)))}>ส่งออก CSV</button>
    </div>
    <div className="metric-grid">{[['ยอดสุทธิ', baht(r.total)], ['จำนวนบิล', r.payments.length], ['เงินสด', baht(r.cash)], ['QR Payment', baht(r.qr)]]
      .map(([name, value]) => <div className="panel" key={name}><small>{name}</small><h2>{value}</h2></div>)}</div>
    <div className="panel list"><h2>เมนูขายดี</h2>
      {r.ranking.length ? r.ranking.map(([name, qty]) => <div className="spread" key={name}><span>{name}</span><b>{qty} ชิ้น</b></div>) : <p className="muted">ยังไม่มียอดขายในวันที่เลือก</p>}
    </div>
    <div className="panel list"><h2>ประวัติบิล</h2>
      {r.payments.length === 0 && <p className="muted">ไม่มีบิลในวันที่เลือก</p>}
      {[...r.payments].reverse().map(p => {
        const o = data.orders.find(o => o.id === p.orderId)
        return <details key={p.id}>
          <summary>โต๊ะ {o?.table} · {bangkokTime(p.at)} · {baht(p.total)} · {p.method.toUpperCase()}</summary>
          <small className="wrap">{p.orderId}</small>
          {data.order_items.filter(i => i.orderId === p.orderId && i.qty > 0).map(i =>
            <div className="spread" key={i.id}><span>{i.qty} × {i.name}{i.note && ` (${i.note})`}</span><span>{baht(i.qty * i.price)}</span></div>)}
          <p>ส่วนลด {baht(p.discount)} · รับ {baht(p.received)} · ทอน {baht(p.change)}</p>
        </details>
      })}
    </div>
    <div className="panel list"><h2>รายการยกเลิกและประวัติการแก้ไข</h2>
      {!r.audit.length && <p className="muted">ไม่มีเหตุการณ์ในวันที่เลือก</p>}
      {[...r.audit].reverse().map(a => <div className="event" key={a.id}>
        <strong>{events[a.action] ?? a.action}</strong> · {a.detail}<br /><small>{bangkokTime(a.at)} · {a.orderId}</small>
      </div>)}
    </div>
  </>
}

const states = {
  queued: 'รอส่ง', sending: 'กำลังส่ง', delivered: native ? 'ส่งข้อมูลแล้ว · รอตรวจใบพิมพ์' : 'จำลองการส่งแล้ว',
  failed: 'ยังไม่ได้ส่ง', uncertain: 'ผลไม่แน่นอน · ตรวจใบพิมพ์',
}
export function Printing({ data }: { data: State }) {
  const { act, busy, task, drain } = usePos()
  const settings = data.printer_settings[0]
  const [devices, setDevices] = useState<{ name: string; address: string }[]>([])
  const [width, setWidth] = useState(settings.width)
  const [address, setAddress] = useState(settings.address)
  return <>
    <h1>คิวพิมพ์</h1>
    <section className="panel list">
      <h2>{native ? 'เครื่องพิมพ์ Bluetooth' : 'เครื่องพิมพ์จำลอง'}</h2>
      {native && <>
        <div className="actions">
          <button disabled={busy} onClick={() => void task(() => hardware.pair())}>เปิดการจับคู่ Android</button>
          <button disabled={busy} onClick={async () => {
            const result = await task(() => hardware.devices())
            if (result) setDevices(result.devices)
          }}>ค้นหาอุปกรณ์ที่จับคู่</button>
        </div>
        <label>เครื่องพิมพ์<select value={address} onChange={e => setAddress(e.target.value)}>
          <option value="">เลือกเครื่องพิมพ์</option>
          {address && !devices.some(d => d.address === address) && <option value={address}>{address}</option>}
          {devices.map(d => <option key={d.address} value={d.address}>{d.name} · {d.address}</option>)}
        </select></label>
        <button disabled={busy || !address} onClick={() => void task(() => hardware.connect({ address }), 'เปิดการเชื่อมต่อ Bluetooth ได้')}>ทดสอบการเชื่อมต่อ</button>
      </>}
      <label>ความกว้างกระดาษ<select value={width} onChange={e => setWidth(e.target.value === '80' ? 80 : 58)}><option value="58">58 มม.</option><option value="80">80 มม.</option></select></label>
      <div className="actions">
        <button disabled={busy} onClick={() => void act(pos => pos.settings(width, address), 'บันทึกการตั้งค่าแล้ว')}>บันทึกการตั้งค่า</button>
        <button disabled={busy || (native && !settings.address)} onClick={async () => {
          if (await act(pos => pos.testTicket())) void drain()
        }}>พิมพ์ทดสอบ</button>
        <button disabled={busy || (native && !settings.address)} onClick={() => void drain()}>ส่งงานในคิว</button>
      </div>
    </section>
    <div className="panel list">
      <h2>ประวัติและงานค้าง · {data.print_jobs.filter(j => j.state === 'queued').length} รอส่ง</h2>
      {!data.print_jobs.length && <p className="muted">ยังไม่มีงานพิมพ์</p>}
      {[...data.print_jobs].reverse().map(j => <details key={j.id}>
        <summary>{j.ticket.kind === 'kitchen' ? 'ใบครัว' : j.ticket.kind === 'accounting' ? 'ใบบัญชี' : 'ทดสอบ'}{j.copyOf && ' COPY'} · {states[j.state]} · {bangkokTime(j.ticket.at)}</summary>
        {j.error && <p className="error">{j.error}</p>}
        <pre>{ticketText(j).join('\n')}</pre>
        <div className="actions">
          {j.state === 'failed' && <button disabled={busy} onClick={async () => { if (await act(pos => pos.retry(j.id))) void drain() }}>ลองส่งงานเดิมอีกครั้ง</button>}
          {(j.state === 'delivered' || j.state === 'uncertain') && <button disabled={busy} onClick={async () => {
            if (confirm('ตรวจใบพิมพ์แล้วและต้องการพิมพ์ COPY?') && await act(pos => pos.copy(j.id))) void drain()
          }}>พิมพ์ COPY</button>}
        </div>
      </details>)}
    </div>
  </>
}

export function Settings() {
  const { task, act, busy } = usePos()
  return <>
    <h1>ตั้งค่าและข้อมูล</h1>
    <div className="panel list">
      <h2>สำรองฐานข้อมูล</h2>
      <p className="muted">ไฟล์ JSON มีเมนู ออเดอร์ ยอดขาย คิวพิมพ์ และการตั้งค่า</p>
      <button disabled={busy} onClick={() => void task(async pos => saveFile(`sushi-oki-backup-${bangkokDate()}.json`, 'application/json',
        JSON.stringify(await pos.backup(), null, 2)))}>บันทึกไฟล์สำรอง</button>
      <label>กู้คืนจากไฟล์ JSON<input type="file" accept=".json,application/json" disabled={busy} onChange={async e => {
        const file = e.target.files?.[0]
        e.target.value = ''
        if (file && confirm('กู้คืนโดยแทนที่ข้อมูลในเครื่องทั้งหมด?')) {
          await act(async pos => pos.restore(await readJson(file)), 'กู้คืนข้อมูลแล้ว')
        }
      }} /></label>
    </div>
    <div className="panel list">
      <h2>นำเข้าเมนู</h2>
      <a href="./sample-menu.json" download>ไฟล์นำเข้าเมนูตัวอย่าง</a>
      <label>ไฟล์เมนู JSON<input type="file" accept=".json,application/json" disabled={busy} onChange={async e => {
        const file = e.target.files?.[0]
        e.target.value = ''
        if (file) await act(async pos => pos.importMenu(await readJson(file)), 'นำเข้าเมนูแล้ว')
      }} /></label>
    </div>
  </>
}
