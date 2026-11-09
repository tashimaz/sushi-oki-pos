import { useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter, Link, NavLink, Route, Routes, useParams } from 'react-router-dom'
import '@fontsource-variable/noto-sans-thai'
import { Dashboard, OrderPage, Tables } from './features/sales'
import { Menu, Printing, Reports, Settings } from './features/admin'
import { usePos } from './store'
import type { State } from './database/model'
import './style.css'

const navigation = [
  ['/', '⌂', 'หน้าหลัก'], ['/tables', '▦', 'โต๊ะ'], ['/menu', '≡', 'เมนู'],
  ['/reports', '▥', 'รายงาน'], ['/printing', '▤', 'พิมพ์'], ['/settings', '⚙', 'ตั้งค่า'],
]
function TableRoute({ data }: { data: State }) {
  const { table } = useParams()
  return <OrderPage key={table} data={data} />
}

function App() {
  const { data, init, busy, error, notice, dismiss } = usePos()
  useEffect(() => { void init() }, [init])
  return <HashRouter>
    <header className="top"><div className="top-inner">
      <Link className="brand" to="/"><span className="mark">寿</span><span>SUSHI OKI<small>POINT OF SALE</small></span></Link>
      <span className="local"><i />ข้อมูลในเครื่อง</span>
    </div></header>
    {(error || notice) && <div role={error ? 'alert' : 'status'} className={`toast ${error ? 'bad' : ''}`}>
      <span>{error || notice}</span><button onClick={dismiss} aria-label="ปิดข้อความ">×</button>
    </div>}
    <main>
      {data ? <Routes>
        <Route path="/" element={<Dashboard data={data} />} />
        <Route path="/tables" element={<Tables data={data} />} />
        <Route path="/tables/:table" element={<TableRoute data={data} />} />
        <Route path="/menu" element={<Menu data={data} />} />
        <Route path="/reports" element={<Reports data={data} />} />
        <Route path="/printing" element={<Printing data={data} />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Link to="/">กลับหน้าหลัก</Link>} />
      </Routes> : <div className="panel">{busy ? 'กำลังเปิดฐานข้อมูล…' :
        <button onClick={() => void init()}>เปิดฐานข้อมูลอีกครั้ง</button>}</div>}
    </main>
    <nav aria-label="เมนูหลัก"><div className="nav-inner">
      {navigation.map(([path, icon, label]) => <NavLink to={path} end={path === '/'} key={path}><span aria-hidden="true">{icon}</span>{label}</NavLink>)}
    </div></nav>
  </HashRouter>
}

createRoot(document.getElementById('root')!).render(<App />)
