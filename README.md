# SUSHI OKI POS

ระบบรับออเดอร์หน้าร้านภาษาไทยสำหรับ 8 โต๊ะ ใช้เงินบาทและเวลา Asia/Bangkok ออกแบบสำหรับพนักงานหนึ่งคนและ Android 14 บน vivo Y28

## ทดลองบนเว็บ

ต้องใช้ Node.js 22 และ npm

```sh
npm ci
npm run dev
```

เปิด URL ที่ Vite แสดง แล้วไปที่ **เมนู** เพื่อใส่ราคาที่ตรวจสอบแล้วและเอาเครื่องหมาย **รอยืนยันราคา** ออก จากนั้นเลือกโต๊ะ ค้นหาอาหาร เพิ่มรายการ ส่งครัว และคิดเงิน ใช้ **พิมพ์** เพื่อดูตัวอย่างใบครัวและใบบัญชีในคิวจำลอง

เว็บใช้ SQLite WASM และเก็บไฟล์ฐานข้อมูลใน IndexedDB ของเบราว์เซอร์ตาม origin เบราว์เซอร์ต้องโหลดเว็บและทรัพยากรครั้งแรกผ่านเซิร์ฟเวอร์ Vite ส่วน Android รวมทรัพยากรไว้ใน APK และเปิดแอปได้โดยไม่ใช้อินเทอร์เน็ต ใช้แท็บเดียวในการทดลองเว็บเพื่อให้เห็นสถานะคิวล่าสุด

## ทดสอบและบิลด์

```sh
npm ci
npm run lint
npm test
npm run build
```

บิลด์ Android ด้วย JDK 21 และ Android SDK Platform 35 กับ Build Tools 35.0.0 ตั้งค่า `JAVA_HOME` และ `ANDROID_HOME` ก่อนรัน

```sh
npm run android:sync
cd android
./gradlew assembleDebug
```

Windows ใช้ `gradlew.bat assembleDebug` ไฟล์ผลลัพธ์อยู่ที่ `android/app/build/outputs/apk/debug/app-debug.apk` หากมีไฟล์ APK ที่ส่งมาด้วย ให้ใช้ไฟล์นั้นติดตั้งตามคู่มือได้เลย

- [ติดตั้งและทดสอบบน vivo Y28](docs/vivo-y28.md)
- [เชื่อมต่อเครื่องพิมพ์ Bluetooth](docs/bluetooth.md)
- [สถานะฟีเจอร์และรายละเอียดข้อมูล](docs/status.md)
- [ไฟล์นำเข้าเมนูตัวอย่าง](public/sample-menu.json)

## เมนูเริ่มต้น

ระบบมี 11 หมวดและรายการตัวอย่างอย่างละหนึ่งรายการ ตัวอย่างทั้งหมดติดป้าย **ตัวอย่าง** ตั้งราคาเป็น `null` และตั้ง `needsReview: true` เนื่องจากไฟล์แนบมีเฉพาะข้อกำหนด ราคาที่ใส่ในไฟล์นำเข้าใช้หน่วยสตางค์ หลังนำเข้าให้ตรวจราคาทุกขนาดก่อนเปิดขาย

## โครงสร้าง

| ที่อยู่ | หน้าที่ |
| --- | --- |
| `src/features` | หน้าขาย โต๊ะ เมนู รายงาน การพิมพ์ และตั้งค่า |
| `src/repositories/pos.ts` | กติกาออเดอร์ ชำระเงิน คิวพิมพ์ และกู้คืน |
| `src/database` | Zod schemas, migration และ SQLite adapters |
| `src/services` | จำนวนเงิน รายงาน CSV ใบพิมพ์ และการส่งออกไฟล์ |
| `android` | Capacitor, SQLite, Bluetooth Classic และ Android file picker |
| `tests` | Vitest ที่ใช้ SQLite WASM |

แอปทำงานแยกจาก GrabMerchant และ Wongnai Merchant หากเพิ่มการเชื่อมต่อ API ในอนาคต ให้แปลงข้อมูลจากผู้ให้บริการผ่าน service แยกและเรียกใช้ repository หลังตรวจข้อมูล
