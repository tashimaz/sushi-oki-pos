import type { State } from './model'

const categories = ['Sushi', 'Sashimi', 'Don', 'Curry Rice', 'Maki & Rolls', 'Salad',
  'Appetizer', 'Pho Laos', 'Drinks', 'Dessert', 'Combo Sets']
const examples = [
  ['ซูชิแซลมอน', 'ปกติ'], ['ซาชิมิแซลมอน', '6 ชิ้น', '12 ชิ้น'],
  ['ข้าวหน้าแซลมอน', 'ปกติ'], ['ข้าวแกงกะหรี่', 'ปกติ'], ['แคลิฟอร์เนียโรล', 'ปกติ'],
  ['สลัดญี่ปุ่น', 'ปกติ'], ['เกี๊ยวซ่า', 'ปกติ'], ['เฝอลาว', 'ปกติ'],
  ['น้ำแข็ง', 'S', 'L'], ['ไอศกรีม', 'ปกติ'], ['ชุดซูชิ', 'ปกติ'],
]
export const seed: State = {
  categories: categories.map((name, i) => ({ id: `category-${i}`, name })),
  products: examples.map(([name], i) => ({
    id: `sample-${i}`, name, categoryId: `category-${i}`,
    needsReview: true, sample: true, soldOut: false, archived: false,
  })),
  product_variants: examples.flatMap(([, ...names], i) => names.map((name, j) => ({
    id: `variant-${i}-${j}`, productId: `sample-${i}`, name, price: null,
  }))),
  tables: Array.from({ length: 8 }, (_, i) => ({ id: String(i + 1), number: i + 1 })),
  orders: [], order_items: [], payments: [], print_jobs: [], audit_logs: [],
  printer_settings: [{ id: 'default', address: '', width: 58 }],
  app_settings: [{ id: 'timezone', value: 'Asia/Bangkok' }],
}
