import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { State } from '../database/model'
import { itemsOf, orderAt, pendingKitchen, subtotalOf } from '../repositories/pos'
import { baht, bangkokDate, change, satang, totals } from '../services/money'
import { daily } from '../services/reports'
import { usePos } from '../store'

export function Dashboard({ data }: { data: State }) {
  const summary = daily(data, bangkokDate())
  const inUse = data.tables.filter(t => orderAt(data, t.number)).length
  return <>
    <div className="hero">
      <div className="eyebrow">ภาพรวมร้าน · {bangkokDate()}</div>
      <h1>ยอดขายวันนี้</h1>
      <div className="hero-value">{baht(summary.total)}</div>
      <div className="hero-stats"><span>ออเดอร์ชำระแล้ว <b>{summary.payments.length}</b></span><span>โต๊ะที่ใช้งาน <b>{inUse}/8</b></span></div>
    </div>
    <div className="actions"><Link className="button primary" to="/tables">รับออเดอร์</Link><Link className="button" to="/reports">ดูรายงาน</Link></div>
    <Tables data={data} compact />
  </>
}

export function Tables({ data, compact = false }: { data: State; compact?: boolean }) {
  return <section>
    {compact ? <h2>สถานะโต๊ะ</h2> : <h1>เลือกโต๊ะ</h1>}
    <div className="table-grid">{data.tables.map(t => {
      const o = orderAt(data, t.number)
      const status = o?.status === 'waiting' ? 'รอชำระเงิน' : o ? 'กำลังรับประทาน' : 'ว่าง'
      return <Link className={`table-card ${o?.status ?? 'vacant'}`} key={t.id} to={`/tables/${t.number}`}>
        <span className="eyebrow">โต๊ะ</span><strong>{t.number.toString().padStart(2, '0')}</strong>
        <span className="status"><i />{status}</span>
      </Link>
    })}</div>
  </section>
}

function OrderLine({ line, busy, onEdit }: {
  line: State['order_items'][number]; busy: boolean; onEdit: (qty: number, note: string) => void
}) {
  const [note, setNote] = useState(line.note)
  return <div className="order-line">
    <div className="spread"><strong>{line.name}</strong><b>{baht(line.qty * line.price)}</b></div>
    <div className="spread">
      <small>{pendingKitchen(line) ? 'มีรายการเปลี่ยนแปลง' : 'เข้าคิวครัวแล้ว'}</small>
      <div className="stepper">
        <button disabled={busy || line.qty === 0} aria-label={`ลด ${line.name}`} onClick={() => onEdit(line.qty - 1, note)}>−</button>
        <b>{line.qty}</b>
        <button disabled={busy || line.qty === 999} aria-label={`เพิ่ม ${line.name}`} onClick={() => onEdit(line.qty + 1, note)}>+</button>
      </div>
    </div>
    {line.qty > 0 && <div className="note-row">
      <input aria-label={`หมายเหตุ ${line.name}`} placeholder="เช่น ไม่ใส่วาซาบิ" value={note} maxLength={240}
        onChange={e => setNote(e.target.value)} onBlur={e => {
          if (e.relatedTarget instanceof HTMLElement && e.relatedTarget.closest('.order-line') === e.currentTarget.closest('.order-line')) return
          if (note !== line.note && !busy) onEdit(line.qty, note)
        }} />
      <button disabled={busy || note === line.note} onClick={() => onEdit(line.qty, note)}>บันทึก</button>
    </div>}
  </div>
}

export function OrderPage({ data }: { data: State }) {
  const { table } = useParams()
  const number = Number(table)
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [destination, setDestination] = useState('')
  const { act, busy, drain } = usePos()
  const o = orderAt(data, number)
  if (!data.tables.some(t => t.number === number)) return <Link to="/tables">กลับไปเลือกโต๊ะ</Link>
  if (o?.status === 'waiting') return <Checkout key={o.id} data={data} order={o} />
  const lines = o ? itemsOf(data, o.id).filter(i => i.qty > 0 || i.sent > 0) : []
  const search = query.trim().normalize('NFC').toLocaleLowerCase('th')
  const menu = data.products.filter(p => !p.archived && (!category || p.categoryId === category) &&
    (p.name.normalize('NFC').toLocaleLowerCase('th').includes(search) ||
      data.product_variants.some(v => v.productId === p.id && v.name.toLocaleLowerCase('th').includes(search))))
  return <>
    <Link className="back" to="/tables">‹ โต๊ะทั้งหมด</Link>
    <div className="spread"><h1>โต๊ะ {number}</h1><span className="pill">{o ? 'กำลังรับประทาน' : 'ว่าง'}</span></div>
    <div className="order-grid">
      <section className="panel">
        <h2>เลือกอาหาร</h2>
        <input type="search" aria-label="ค้นหาเมนู" placeholder="ค้นหาชื่ออาหาร" value={query} onChange={e => setQuery(e.target.value)} />
        <div className="chips">
          <button className={category ? '' : 'selected'} onClick={() => setCategory('')}>ทั้งหมด</button>
          {data.categories.map(c => <button className={category === c.id ? 'selected' : ''} key={c.id} onClick={() => setCategory(c.id)}>{c.name}</button>)}
        </div>
        {!menu.length && <p className="muted">ไม่พบเมนู</p>}
        {menu.map(p => <div className="menu-line" key={p.id}>
          <strong>{p.name}</strong>
          {p.sample && <small className="pill">ตัวอย่าง</small>} {p.needsReview && <small className="pill">รอยืนยันราคา</small>} {p.soldOut && <small className="pill">หมด</small>}
          <div className="actions">{data.product_variants.filter(v => v.productId === p.id && (v.price !== null || p.needsReview)).map(v =>
            <button disabled={busy || p.soldOut || p.needsReview || v.price === null} key={v.id} onClick={() => void act(pos => pos.add(number, v.id))}>
              + {v.name} {v.price === null ? '· ยังไม่มีราคา' : baht(v.price)}
            </button>
          )}</div>
        </div>)}
      </section>
      <section className="panel order-summary">
        <h2>รายการที่สั่ง</h2>
        {!lines.length && <p className="muted">แตะเมนูเพื่อเริ่มออเดอร์ ระบบบันทึกทุกครั้งที่แก้ไข</p>}
        {o && lines.map(line => <OrderLine key={line.id + line.note} line={line} busy={busy} onEdit={(qty, note) =>
          void act(pos => pos.edit(o.id, line.id, qty, note))} />)}
        <div className="spread total"><strong>ยอดรวม</strong><b>{baht(subtotalOf(lines))}</b></div>
        {o && <>
          <div className="actions">
            <button disabled={busy || !lines.some(pendingKitchen)} onClick={async () => {
              if (await act(pos => pos.send(o.id), 'บันทึกใบครัวและใบบัญชีเข้าคิวแล้ว')) void drain()
            }}>ส่งครัว</button>
            <button className="primary" disabled={busy || !lines.some(i => i.qty > 0)} onClick={() => void act(pos => pos.waiting(o.id, true))}>คิดเงิน</button>
          </div>
          <div className="actions">
            <select aria-label="โต๊ะปลายทาง" value={destination} onChange={e => setDestination(e.target.value)}>
              <option value="">เลือกโต๊ะว่าง</option>
              {data.tables.filter(t => !orderAt(data, t.number)).map(t => <option key={t.id} value={t.number}>โต๊ะ {t.number}</option>)}
            </select>
            <button disabled={busy || !destination} onClick={async () => {
              if (await act(pos => pos.move(o.id, Number(destination)), 'ย้ายโต๊ะแล้ว')) navigate(`/tables/${destination}`)
            }}>ย้ายโต๊ะ</button>
          </div>
          <button className="danger" disabled={busy} onClick={async () => {
            if (confirm('ยืนยันยกเลิกออเดอร์ทั้งโต๊ะ?') && await act(pos => pos.cancel(o.id), 'ยกเลิกออเดอร์แล้ว')) {
              void drain()
              navigate('/tables')
            }
          }}>ยกเลิกออเดอร์</button>
        </>}
      </section>
    </div>
  </>
}

function Checkout({ data, order }: { data: State; order: State['orders'][number] }) {
  const navigate = useNavigate()
  const { busy, act, drain } = usePos()
  const [method, setMethod] = useState<'cash' | 'qr'>('cash')
  const [mode, setMode] = useState<'amount' | 'percent'>('amount')
  const [discount, setDiscount] = useState('')
  const [cash, setCash] = useState('')
  const [verified, setVerified] = useState(false)
  const items = itemsOf(data, order.id)
  const subtotal = subtotalOf(items)
  let amount: ReturnType<typeof totals> | undefined
  let tendered = 0
  let changeDue: number | undefined
  let error = ''
  try {
    amount = totals(subtotal, satang(discount || '0'), mode)
    if (method === 'cash' && (cash || amount.total === 0)) {
      tendered = satang(cash || '0')
      changeDue = change(amount.total, tendered)
    }
  } catch (reason) { error = reason instanceof Error ? reason.message : 'จำนวนเงินไม่ถูกต้อง' }
  return <section className="panel checkout">
    <button disabled={busy} onClick={() => void act(pos => pos.waiting(order.id, false))}>‹ กลับไปแก้ไข</button>
    <h1>คิดเงิน · โต๊ะ {order.table}</h1>
    {items.filter(i => i.qty).map(i => <div className="spread" key={i.id}><span>{i.qty} × {i.name}</span><b>{baht(i.qty * i.price)}</b></div>)}
    <div className="spread total"><strong>ก่อนส่วนลด</strong><b>{baht(subtotal)}</b></div>
    <div className="actions">
      <label>ประเภทส่วนลด<select value={mode} onChange={e => { setMode(e.target.value as typeof mode); setVerified(false) }}><option value="amount">บาท</option><option value="percent">เปอร์เซ็นต์</option></select></label>
      <label>ส่วนลด<input inputMode="decimal" placeholder="0" value={discount} onChange={e => { setDiscount(e.target.value); setVerified(false) }} /></label>
    </div>
    <div className="spread total"><strong>ยอดชำระ</strong><b>{amount ? baht(amount.total) : '—'}</b></div>
    <div className="actions">
      <button className={method === 'cash' ? 'selected' : ''} onClick={() => { setMethod('cash'); setVerified(false) }}>เงินสด</button>
      <button className={method === 'qr' ? 'selected' : ''} onClick={() => setMethod('qr')}>QR Payment</button>
    </div>
    {method === 'cash' ? <>
      <label>เงินรับ<input inputMode="decimal" value={cash} onChange={e => setCash(e.target.value)} /></label>
      <div className="spread"><span>เงินทอน</span><b>{changeDue === undefined ? '—' : baht(changeDue)}</b></div>
    </> : <label className="check"><input type="checkbox" checked={verified} onChange={e => setVerified(e.target.checked)} />ตรวจสอบยอดเงินเข้าแล้ว</label>}
    {error && <p className="error">{error}</p>}
    <button className="primary full" disabled={busy || !amount || (method === 'qr' ? !verified : changeDue === undefined)} onClick={async () => {
      if (await act(pos => pos.pay(order.id, method, satang(discount || '0'), mode, tendered, verified), 'รับชำระและปิดโต๊ะแล้ว')) {
        void drain()
        navigate('/tables')
      }
    }}>ยืนยันชำระเงินและปิดโต๊ะ</button>
  </section>
}
