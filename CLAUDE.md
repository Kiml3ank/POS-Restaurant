# POS ร้านอาหาร — แผนลงมือทำโปรเจกต์ (สรุปจาก e-book "POS ร้านอาหารสร้างเองด้วย Claude Code")

อ้างอิงจากไฟล์ `claude-pos-restaurant-2026.pdf` (145 หน้า, 16 บท) ในโฟลเดอร์ `D:\POS Restaurant`
สรุปเพื่อใช้เป็นแผนเริ่มทำโปรเจกต์ (Đồ án 2)

## 1. ภาพรวมระบบ

ระบบ POS ร้านอาหารประกอบด้วย 4 หน้าจอที่ต้องคุยกันแบบ realtime บนชุดข้อมูลเดียวกัน:

| หน้าจอ | ผู้ใช้ | หน้าที่หลัก |
|---|---|---|
| มือถือลูกค้า (QR) | ลูกค้าที่นั่งโต๊ะ | สแกน QR ประจำโต๊ะ เปิดเมนู สั่งอาหารเอง |
| เครื่องพนักงาน (POS) | พนักงานเสิร์ฟ/แคชเชียร์ | เปิดโต๊ะ สั่งแทนลูกค้า ย้าย/รวมโต๊ะ คิดเงิน |
| จอครัว (KDS) | ครัว | รับออร์เดอร์ realtime แยกตามสถานี เปลี่ยนสถานะ |
| หลังร้าน (admin/report) | เจ้าของ/ผู้จัดการ | ยอดขาย เมนูขายดี ปิดกะ/ปิดวัน จัดการเมนู-สิทธิ์ |

หัวใจคือ **data contract เดียวกัน** ที่ทุกหน้าจออ้างอิง เช่น `OrderStatus`:
`DRAFT → PLACED → IN_PROGRESS → READY → SERVED → PAID` (และ `CANCELLED`)

## 2. Tech Stack (ตามที่ e-book แนะนำ)

- **Framework:** Next.js 16.2 (App Router) + TypeScript
- **DB/ORM:** PostgreSQL + Prisma
- **Realtime:** Server-Sent Events (SSE) ผ่าน Route Handler — **ไม่ใช้ WebSocket** เพราะ Next.js Route Handler อัปเกรดเป็น WebSocket ไม่ได้ และ Vercel ถือ TCP connection ค้างไม่ได้ (ถ้าจะ WebSocket จริงต้องแยก server เอง หรือใช้ Pusher/Ably/Cloudflare Durable Objects)
- **Dev DB:** ✅ Docker ใช้งานได้แล้ว — ใช้ **Docker Compose** ตามที่ e-book แนะนำแต่แรก (ดูขั้นตอนในหัวข้อ 2.1) ส่วน production ยังใช้ managed database เหมือนเดิม (ไม่กระทบ เพราะ Prisma คุยกับ Postgres ผ่าน connection string เหมือนกันไม่ว่าจะรันที่ไหน)
- **Hosting แนะนำ:** Vercel + managed Postgres (ผูกกับการเลือกใช้ SSE) หรือ VPS ของตัวเองถ้าต้องการ WebSocket เต็มรูป
- **เงิน:** คำนวณด้วย **จำนวนเต็มสตางค์ ไม่ใช้ float** ทุกจุด (ลำดับคิด: service charge → VAT)
- **Payment:** PromptPay QR (EMVCo tag-length-value payload, tag 29 = credit transfer ผ่านเบอร์มือถือ/เลขผู้เสียภาษี), บัตร, เงินสด
- **Auth หน้าร้าน:** PIN สั้น (4-6 หลัก) ต่อพนักงาน + session สั้น + ล็อกจอ, RBAC
- **Multi-tenant:** ทุกตารางที่ผูกกับร้านต้องมี `branchId` / `tenantId` ตั้งแต่ตัวแรก ไม่ใช่เติมทีหลัง
- **Middleware:** ใช้ไฟล์ `proxy.ts` (ชื่อ convention ของ Next.js 16.2 แทน middleware.ts เดิม)
- **Server-only guard:** ทุกไฟล์ใน `lib/server/` ต้อง `import "server-only"` กัน client component เผลอ import Prisma ตรง ๆ

### 2.1 ตั้ง PostgreSQL ด้วย Docker Compose (dev)

Docker ใช้งานได้แล้วในเครื่องพัฒนา — กลับไปใช้ Docker Compose ตามที่ e-book แนะนำแต่แรก:

1. สร้างไฟล์ `docker-compose.yml` ที่ root โปรเจกต์:
   ```yaml
   services:
     db:
       image: postgres:17
       restart: unless-stopped
       environment:
         POSTGRES_USER: postgres
         POSTGRES_PASSWORD: postgres
         POSTGRES_DB: pos_restaurant_dev
       ports:
         - "5432:5432"
       volumes:
         - pgdata:/var/lib/postgresql/data

   volumes:
     pgdata:
   ```
2. สั่ง `docker compose up -d` เพื่อตั้งค่าและรัน container (สั่งซ้ำได้ทุกครั้งที่เปิดเครื่องใหม่ ถ้ายังไม่ได้ตั้งให้ auto-start)
3. ตั้ง `.env` ของโปรเจกต์ Next.js:
   ```
   DATABASE_URL="postgresql://postgres:postgres@localhost:5432/pos_restaurant_dev"
   ```
4. รัน `npx prisma migrate dev` ตามปกติ — ทุกคำสั่งในเล่ม (`prisma db seed`, `prisma studio` ฯลฯ) ใช้ได้เหมือนเดิมทุกจุด
5. เลิกใช้/รีเซ็ต DB สะอาด ๆ ได้ง่ายด้วย `docker compose down -v` แล้ว `docker compose up -d` ใหม่

**หมายเหตุ:** ถ้าเคยติดตั้ง PostgreSQL แบบ native บน Windows ไว้ก่อนหน้านี้ ให้ถอนการติดตั้งออกและปิด Windows Service ของมัน เพื่อไม่ให้ชนพอร์ต 5432 กับ container ส่วนตอน deploy จริง (บทที่ 16) ยังใช้ managed Postgres บนคลาวด์เหมือนเดิม ไม่เกี่ยวกับเครื่อง dev เลย

## 3. แผนที่บท → สิ่งที่ต้องสร้าง (ใช้เป็น milestone)

1. **บทนำ** — เข้าใจภาพรวม 4 หน้าจอ, เทียบตลาด (Qashier, FoodStory, Wongnai POS, StoreHub), เกณฑ์ตัดสินใจซื้อ vs สร้างเอง
2. **ตั้ง Claude Code / เครื่องมือ** — เขียน `CLAUDE.md` ให้ตรงบริบทโปรเจกต์ (ไม่ใช่สอน syntax พื้นฐาน), ตั้ง hook ตรวจโค้ดอันตราย, ต่อ MCP กับ Postgres ให้ Claude อ่าน schema จริงได้, กฎ "Prisma transaction จริงเวลาที่แก้หลายตารางพร้อมกัน"
3. **สถาปัตยกรรม + ตั้งโปรเจกต์** — `npx create-next-app` (16.2, App Router, TS, Prisma), โครงโฟลเดอร์ (`lib/server/db.ts` = Prisma client singleton ฯลฯ), **PostgreSQL ผ่าน docker-compose** (ดูหัวข้อ 2.1), วาง route group ตาม 4 หน้าจอ
4. **ออกแบบ schema เมนู** — โมเดล 3 ชั้น: **Item** (สินค้าสั่งเดี่ยว) → **ModifierGroup** (เช่น ขนาด/ความหวาน/ท็อปปิ้ง) → **Modifier** (ตัวเลือกย่อยพร้อมส่วนต่างราคา) พร้อมกฎ `required`/`minSelect`/`maxSelect`; many-to-many ระหว่าง Order ↔ MenuItem ผ่าน OrderItem
5. **โต๊ะ QR + session** — โมเดล `Table` (tableCode ปัจจุบัน) + `TableSession` (กันเคส "ลูกค้าถ่ายรูป QR แล้วสั่งจากบ้านได้อีกหลายวันหลัง"); ใช้ `proxy.ts` กัน route หลุดไม่มี session cookie
6. **หน้าเมนูลูกค้า** — React Server Component ดึง MenuCategory → MenuItem → ModifierGroup → Modifier จาก Prisma ครั้งเดียว (กรอง `isAvailable=true` ทุกชั้น), แยก client component เฉพาะจุดที่ต้อง interactive, ใช้ `next/image` จัดการรูป, ต้องเร็วบนเน็ตอ่อน
7. **ตะกร้า + ส่งออร์เดอร์ + state machine** — ตะกร้าอยู่ฝั่ง server ไม่ใช่แค่ localStorage (กันหายตอน refresh); กันกดส่งซ้ำ (double-submit) ด้วย `useActionState`/`useFormStatus` + disable ปุ่มทันทีที่กด; ออกแบบ `OrderStatus` เป็น discriminated union ใน TypeScript
8. **KDS realtime** — ใช้ **SSE** (ไม่ใช่ WebSocket) ผ่าน Route Handler, แยกออร์เดอร์ตามสถานี, กดเปลี่ยนสถานะ; ถ้าต้อง scale หลาย instance ต้องมี pub/sub กลาง (เช่น Postgres LISTEN/NOTIFY)
9. **หน้า POS พนักงาน** — เปิดโต๊ะ, สั่งแทนลูกค้า, ย้าย/รวมโต๊ะ (ต้องย้าย "ทั้งชุด" ทั้งออร์เดอร์ที่ยังไม่จ่ายด้วย ไม่ใช่แค่เปลี่ยนเลขโต๊ะ — ทำเป็น transaction เดียว), แยกบิล, ยกเลิกรายการที่ครัวเริ่มทำแล้ว
10. **คิดเงิน (calculateBill)** — คำนวณด้วยจำนวนเต็มสตางค์เท่านั้น, ลำดับ service charge → VAT ให้ถูกกฎ, ห้ามใช้ float เด็ดขาด
11. **รับเงิน** — ~~PromptPay QR (payload ตามมาตรฐาน ธปท., tag 29), บัตร, เงินสด — เตรียม abstraction รองรับ payment gateway ไทยหลายเจ้า~~ **ลดขอบเขตเป็นโหมด demo แล้ว** (2026-08-22) และ **ทำเสร็จแล้ว** — แคชเชียร์กดเลือกเงินสด/QR เองแล้วกดยืนยัน ไม่ต่อ gateway จริง — ดู `report/2026-08-22-chapter-11-payment.md`
12. **ใบเสร็จ / ใบกำกับภาษีอย่างย่อ (ABB)** — ~~ออกแบบฐานข้อมูลให้รองรับเอกสารตั้งแต่แรก~~ **ทำเสร็จแล้ว** (2026-08-23) เลขที่เดินต่อเนื่องตลอดกาลต่อสาขา · พิมพ์ผ่าน CSS 80mm · e-Tax ตัดออกจากขอบเขต — ดู `report/2026-08-23-chapter-12-receipt.md` — **หมายเหตุ: เนื้อหาภาษีในบทนี้ไม่ใช่คำแนะนำทางกฎหมาย ต้องตรวจกับสรรพากร/ผู้สอบบัญชีก่อนใช้งานจริง**
13. **สิทธิ์ / ความปลอดภัย / กันโกงหน้าร้าน** — RBAC, ตำแหน่งของระบบใน PCI DSS, audit log ที่สืบสาวได้ (เคสตัวอย่าง: บิลถูก "ยกเลิก" หลังจ่ายเงินแล้วไม่กี่นาที)
14. **สต็อกและต้นทุนอาหาร** — โมดูลยากที่สุดในเล่ม เพราะไม่ใช่ปัญหาซอฟต์แวร์ล้วน (น้ำแข็งละลาย ผักช้ำ ฯลฯ); แนะนำเริ่มจากรุ่นเรียบง่ายก่อน (ตัดสต็อกตอนขาย, ของหมดกลางวัน, นับสต็อก)
15. **รายงาน ปิดกะ ปิดวัน** — X report (snapshot ระหว่างกะ), ปิดกะ (นับเงินสดจริงเทียบระบบ), Z report/ปิดวัน (สรุปสิ้นวันแล้วรีเซ็ตตัวนับ)
16. **Deploy** — Vercel + managed Postgres (ถ้าใช้ SSE ตามคำแนะนำ) หรือ VPS เอง (ถ้าต้องการ WebSocket เต็มรูป); ตัดสินใจ hosting ต้องผูกกับการตัดสินใจ realtime ตั้งแต่บทที่ 8

## 4. จุดที่ต้องระวังเป็นพิเศษ (จาก e-book)

- อย่าให้ Claude เสนอ WebSocket ตรง ๆ ผ่าน Route Handler — เช็กทุกครั้ง
- ห้ามคำนวณเงินด้วย float
- ทุกตารางผูกร้านต้องมี tenant/branch id ตั้งแต่ต้น
- ห้าม import Prisma client ตรงใน client component
- schema เมนูต้องยืดหยุ่นตั้งแต่แรก (3 ชั้น Item/ModifierGroup/Modifier) ห้าม hardcode คอลัมน์ size/topping1/topping2
- ย้าย/รวมโต๊ะต้องเป็น transaction เดียว ไม่ใช่ทีละฟิลด์
- กันการกดส่งออร์เดอร์ซ้ำ (double submit)
- ไฟล์ `"use server"` **export ได้เฉพาะ async function เท่านั้น** ห้าม export ค่าคงที่/object
  ปนไปด้วย (เช่น state ตั้งต้นของฟอร์ม) — error นี้ไม่โผล่ตอน `tsc`/`build` แต่โผล่ตอนกดปุ่ม
  แล้วได้ 500 ทั้งหน้า ที่โปรเจกต์นี้แยกไว้ที่ `lib/form-state.ts`
- **regex ใน `config.matcher` ของ `proxy.ts` เขียนอยู่ในสตริง JS ต้อง escape สองชั้น**
  — `"\."` คือจุดธรรมดา ต้องเป็น `"\\."` ไม่งั้น `.*\..*` กลายเป็น `.*.*` ที่ชนทุก path
  แล้ว **proxy จะถูกข้ามทุก request แบบเงียบสนิท** ไม่พังทั้ง `tsc` และ `build`
  (บั๊กนี้เคยเกิดจริงและอยู่ในโปรเจกต์ตั้งแต่บทที่ 5 จนถึงบทที่ 9)
  ทุกครั้งที่แก้ `proxy.ts` ต้องทดสอบด้วย `curl -o /dev/null -w "%{http_code} %{redirect_url}"` เสมอ
- **ฟอนต์ที่ไม่มีกลีฟไทย (เช่น Archivo) ห้ามใช้ `var(--font-xxx)` ที่ next/font สร้างให้**
  เพราะ var นั้นมีค่าเป็น `"Archivo", "Archivo Fallback"` ซึ่งตัวหลังคือ `local(Arial)`
  และ **Arial มีกลีฟไทย** ตัวไทยจะไปหยุดที่ Arial ไม่มีวันตกถึงฟอนต์ไทยที่ตั้งใจไว้
  `adjustFontFallback: false` **แก้ไม่ได้เพราะ Turbopack ไม่ทำตาม** ต้องเขียนชื่อฟอนต์
  ตรง ๆ ใน CSS แทน — และทุกครั้งที่แตะฟอนต์ ต้องตรวจ `@font-face` ที่ emit ออกมาจริง
  ไม่ใช่เชื่อ option (ดู `report/2026-08-21-pos-ui-modernist.md` หัวข้อ 3.1)
- **รัน `prisma generate` / `prisma migrate` ขณะที่ `npm run dev` เปิดค้างอยู่
  = ต้องรีสตาร์ท dev server เสมอ** ไม่งั้นจะเจอ error ที่อ่านไม่ออกเลยว่าเกิดจากอะไร:

  ```
  ⨯ Failed to generate static paths for /pos/table/[tableId]:
  Error: Jest worker encountered 2 child process exceptions, exceeding retry limit
  ```

  แล้วหน้านั้นจะ 500 ทั้งหน้า ส่วน Server Action ที่ redirect ไปหน้านั้นจะเด้ง
  `An unexpected response was received from the server.` ที่ฝั่งเบราว์เซอร์
  (stack ที่ได้มีแต่เฟรมของ jest-worker ไม่มีเฟรมของโค้ดเราเลย จึงชี้ผิดที่ได้ง่ายมาก)

  สาเหตุ: `prisma generate` เขียนทับไฟล์ใน `lib/generated/prisma/` ใต้เท้า dev server
  ที่โหลดของเก่าค้างไว้ พอ Turbopack spawn worker ใหม่มา render route นั้น
  worker จะ crash ตอน import (สองครั้ง → เกิน retry limit)

  **วิธีแยกว่าเป็นบั๊กโค้ดจริงหรือแค่ dev server เพี้ยน:** `npm run build` แล้ว
  `npm run start -- -p 3002` ยิงเส้นทางเดิม — ถ้า prod 200 แต่ dev 500
  ทั้งที่โค้ด/DB/cookie ชุดเดียวกัน แปลว่าโค้ดไม่ผิด ให้รีสตาร์ท dev server
  (ยืนยันด้วยวิธีนี้มาแล้วครั้งหนึ่งตอนบทที่ 11)

  หมายเหตุ: `.next/dev/logs/next-development.log` คือที่ที่ error จริงของ dev server
  ถูกเขียนไว้ อ่านไฟล์นี้ก่อนเดาเสมอ

- เนื้อหาด้านภาษี/ใบกำกับภาษี ต้องตรวจกับผู้เชี่ยวชาญจริงก่อน deploy ใช้งาน

## 5. ลำดับที่แนะนำให้เริ่มลงมือจริง

1. ตั้งโปรเจกต์ + `CLAUDE.md` + ตั้ง Postgres ผ่าน docker-compose (บทที่ 2-3)
2. ออกแบบ Prisma schema เต็ม: Tenant/Branch, Table/TableSession, MenuCategory/Item/ModifierGroup/Modifier, Order/OrderItem, Staff/Role (บทที่ 4-5, 13)
3. หน้าเมนูลูกค้า + ตะกร้า + ส่งออร์เดอร์ (บทที่ 6-7)
4. KDS แบบ SSE (บทที่ 8)
5. หน้า POS พนักงาน (บทที่ 9)
6. คิดเงิน + รับเงิน + ใบเสร็จ (บทที่ 10-12)
7. สต็อก (รุ่นเรียบง่าย) + รายงานปิดกะ/ปิดวัน (บทที่ 14-15)
8. Deploy (บทที่ 16)

## 6. สถานะปัจจุบัน (อัปเดต 2026-08-22)

**ทำไปแล้ว: หัวข้อ 3 ข้อ 1-3 (บทที่ 1-3)** — scaffold ใช้งานได้จริงแล้ว รันผ่านครบทั้ง
`npm run build`, `tsc --noEmit`, `eslint` และเปิดได้ทั้ง 4 เส้นทางบน dev server

- Next.js **16.2.12** (App Router, TypeScript, Tailwind CSS 4, ESLint) ที่ root โปรเจกต์
- PostgreSQL 17 ผ่าน `docker-compose.yml` ตามหัวข้อ 2.1 (container `posrestaurant-db-1`)
- Prisma **7.9.1** + migration `init` + seed (1 Tenant / 1 Branch)
- `lib/server/db.ts` = Prisma client singleton ที่มี `import "server-only"`
- `proxy.ts` ต่อ matcher ไว้แล้ว (ยังปล่อยผ่านทุก request — ตรรกะจริงอยู่บทที่ 5 และ 13)
- Route group ครบ 4 หน้าจอ: `app/(customer)/t/[tableCode]`, `app/(pos)/pos`,
  `app/(kds)/kds`, `app/(admin)/admin` และหน้า `/` เป็น dev index ที่เช็คการต่อ DB ให้ด้วย

### สิ่งที่ต่างจากที่เขียนไว้ในเล่ม (ต้องรู้ก่อนเขียนโค้ดบทถัดไป)

Prisma 7 เปลี่ยนจากตอนที่ e-book เขียนไว้ 3 จุด — โค้ดทุกบทหลังจากนี้ต้องยึดตามนี้:

1. **datasource ไม่มี `url` ใน `schema.prisma` แล้ว** ย้ายไปอยู่ที่ `prisma.config.ts` แทน
   และ Prisma ไม่โหลด `.env` ให้เอง จึงต้อง `import "dotenv/config"` ที่บรรทัดแรกของไฟล์นั้น
2. **generator เป็น `provider = "prisma-client"`** (ไม่ใช่ `prisma-client-js`) และต้องระบุ
   `output` เอง — ที่นี่ตั้งไว้ที่ `lib/generated/prisma` เพราะฉะนั้น import ต้องเป็น
   `from "@/lib/generated/prisma/client"` ไม่ใช่ `from "@prisma/client"`
3. **ต้องส่ง driver adapter เข้า `new PrismaClient()` เสมอ** (ไม่มี Rust query engine
   เป็นค่าเริ่มต้นแล้ว) — โปรเจกต์นี้ใช้ `new PrismaPg({ connectionString })` จาก
   `@prisma/adapter-pg` ถ้าลืมจะได้ error `PrismaClient was instantiated without any options`

หมายเหตุ: `npm` เวอร์ชันนี้บล็อก install script ของ dependency โดยค่าเริ่มต้น ถ้าเพิ่ม
แพ็กเกจที่ต้องคอมไพล์ (เช่น engine ของ Prisma, sharp) ต้องสั่ง `npm approve-scripts <pkg>`
ตามด้วย `npm rebuild` ไม่งั้นจะพังตอนรัน ไม่ใช่ตอนติดตั้ง

### schema + migration + seed รันครบแล้ว ✅ (หัวข้อ 5 ข้อ 2 — บทที่ 4-5, 13)

`prisma/schema.prisma` (550 บรรทัด), migration และ seed **รันครบแล้วเมื่อ 2026-08-21**
ฐานข้อมูล dev พร้อมใช้งานจริง ไม่ต้องรันซ้ำ:

- migration ที่ apply แล้ว: `20260820065456_init` + `20260821013157_menu_tables_orders_staff`
- ฐานข้อมูลมี 16 ตาราง, ผ่าน `prisma validate`, `tsc --noEmit`, `eslint` ครบทั้งหมด
- ข้อมูล seed: 3 สถานี, 4 หมวด, 6 เมนู, 4 กลุ่มตัวเลือก (11 ตัวเลือก), 5 โต๊ะ, พนักงาน 4 คน
- ทดสอบหน้าลูกค้าที่ `/t/a1x7qk` — PIN dev: 001=1234, 002=2345, 003=3456, 004=4567

ถ้าต้องรีเซ็ต DB สะอาด: `npm run db:reset` แล้ว `npx prisma migrate dev` + `npm run db:seed`

**หมายเหตุเครื่อง dev (2026-08-21):** Docker Desktop บนเครื่องนี้ติดตั้งแบบ per-user ที่
`C:\Users\ADMIN\AppData\Local\Programs\DockerDesktop` (ไม่ใช่ `C:\Program Files\Docker`)
ถ้าสั่ง `docker` ไม่เจอ ให้เติม `...\DockerDesktop\resources\bin` เข้า PATH ก่อน

โมเดลที่เพิ่มเข้ามา (ทุกตารางมี `branchId` ตั้งแต่แถวแรก, เงินเป็น `Int` สตางค์ทุกคอลัมน์):

- **เมนู 3 ชั้น** — `MenuCategory` → `MenuItem` → (`MenuItemModifierGroup`) →
  `ModifierGroup` → `Modifier` ตัวกลางเป็น many-to-many เพื่อให้กลุ่มตัวเลือกเดียวกัน
  เช่น "ความหวาน" ใช้ซ้ำได้หลายเมนู และ `sortOrder` ของกลุ่มเป็นค่าเฉพาะคู่เมนู-กลุ่ม
- **`Station`** — สถานีครัว (ครัวร้อน/บาร์น้ำ/ของหวาน) เป็นตารางไม่ใช่ enum เพราะแต่ละ
  สาขาจัดครัวไม่เหมือนกัน; KDS บทที่ 8 กรองด้วย `OrderItem.stationId` ที่ snapshot ไว้
  ตอนสั่ง ไม่ต้อง join เมนูสด
- **`RestaurantTable` / `TableSession`** — ชื่อโมเดลเลี่ยงคำว่า `Table` เพราะชนคำสงวน SQL
  `tableCode` เป็น unique ทั้งระบบ (resolve จาก URL `/t/[tableCode]` โดยยังไม่รู้สาขา)
  และหมุนเปลี่ยนได้เมื่อพิมพ์ QR ใหม่; `TableSession.expiresAt` คือชั้นที่กันเคส
  "ลูกค้าถ่ายรูป QR แล้วสั่งจากบ้านอีกสามวันถัดมา"
- **`Order` / `OrderItem` / `OrderItemModifier`** — `status=DRAFT` คือตะกร้าฝั่ง server
  (บทที่ 7); คอลัมน์ที่ลงท้ายด้วย `Snapshot` คือค่า ณ เวลาที่สั่ง ห้าม join อ่านจากเมนูสด
  เพราะร้านขึ้นราคาแล้วบิลเก่าต้องไม่เปลี่ยนตาม; `Order` เก็บ snapshot ของ
  `serviceChargeBp`/`vatRateBp`/`pricesIncludeVat` ไว้ด้วยเพื่อพิมพ์ใบเสร็จย้อนหลังได้ถูก
- **`OrderItemStatus` แยกจาก `OrderStatus`** — KDS ทำงานที่ระดับรายการ เพราะของในบิล
  เดียวกันเสร็จไม่พร้อมกัน สถานะของบิลคือผลรวมของรายการ
- **`Staff` (enum `StaffRole`) + `AuditLog`** — ฐาน RBAC บทที่ 13; `AuditLog` เขียนอย่างเดียว
  ห้าม update/delete จากโค้ดแอป
- **นโยบาย `onDelete`** — Cascade เฉพาะสายความเป็นเจ้าของที่ยังไม่มีเงินผูก,
  Restrict ทุกจุดที่ชนประวัติบิล (เมนูที่เคยถูกสั่ง → ใช้ `isAvailable=false` แทนการลบ),
  SetNull เฉพาะ field ที่เป็นแค่ attribution (พนักงานที่เปิดโต๊ะ/กดส่งออร์เดอร์)

seed สร้างข้อมูล dev ให้ครบชุด: 3 สถานี, 4 หมวด, 6 เมนู, 4 กลุ่มตัวเลือก, 5 โต๊ะ
(`/t/a1x7qk` ใช้ทดสอบได้เลย) และพนักงาน 4 คน — PIN hash ด้วย `scrypt` ที่ Node มีในตัว
รูปแบบ `scrypt$<saltHex>$<hashHex>` **บทที่ 13 ต้องย้ายฟังก์ชัน hash/verify คู่นี้ไปอยู่
ที่เดียวกับตรรกะล็อกอิน แล้วให้ seed เรียกใช้ร่วมกัน** (ตอนนี้ hash อยู่ใน seed.ts ตรง ๆ
เพราะ `lib/server/*` มี `import "server-only"` ที่ throw เมื่อรันผ่าน tsx นอก Next.js)

### หน้าจอลูกค้า: เมนู + ตะกร้า + ส่งออร์เดอร์ ✅ (หัวข้อ 5 ข้อ 3 — บทที่ 5-7)

ทำเสร็จเมื่อ 2026-08-21 ผ่าน `tsc --noEmit`, `eslint`, `npm run build` และทดสอบจริงกับ
dev DB ครบ 21 เคส (`npm run smoke:order`)

เส้นทางของลูกค้า: `/t/[tableCode]` (เมนู) → `/t/[tableCode]/item/[itemId]` (เลือกตัวเลือก)
→ `/t/[tableCode]/cart` (ตะกร้า) → `/t/[tableCode]/orders` (ติดตามออร์เดอร์)

ไฟล์ที่เพิ่ม/แก้ และเหตุผลที่ต้องรู้ก่อนเขียนบทถัดไป:

- **`lib/money.ts`** — `formatBaht` / `formatPriceDelta` / `lineTotalOf` คิดด้วยจำนวนเต็ม
  สตางค์ล้วน ไม่มี `import "server-only"` เพราะ client component ต้องใช้แสดงราคาด้วย
  ตัวคิดบิลเต็ม (service charge → VAT) ยังไม่มี เป็นงานบทที่ 10
- **`lib/order-status.ts`** — ป้ายภาษาไทยของทุกสถานะ + ตาราง transition ที่อนุญาต
  (`canTransitionOrder`) KDS บทที่ 8 กับ POS บทที่ 9 ต้องเรียกไฟล์นี้ ห้ามเขียนป้ายซ้ำเอง
- **`lib/table-session-cookie.ts`** — มีแค่ชื่อ cookie ค่าเดียว แยกไฟล์เพราะ `proxy.ts`
  ต้องใช้ค่าเดียวกันแต่ห้าม import อะไรที่มี `server-only` เข้าไป
- **`lib/server/table-session.ts`** — `resolveCustomerContext()` คือด่านเดียวที่ทุกหน้าและ
  ทุก action ของลูกค้าต้องผ่าน (คืน `session = null` ทั้งกรณีไม่มี cookie / หมดอายุ /
  cookie เป็นของโต๊ะอื่น) `openTableSession()` **เข้าร่วมรอบที่เปิดค้างอยู่ของโต๊ะนั้น**
  ถ้ามี ไม่สร้างรอบใหม่ — สี่คนที่โต๊ะเดียวกันจึงได้บิลใบเดียว; อายุรอบ 3 ชม.
  และตั้งใจไม่ต่ออายุอัตโนมัติ (บทที่ 9 ให้พนักงานเป็นคนปิด/เปิดรอบใหม่)
- **`lib/server/menu.ts`** — ดึงเมนูครั้งเดียวจบ กรอง `isAvailable` ทุกชั้นตั้งแต่ใน query
- **`lib/server/cart.ts`** — ตะกร้า = `Order.status = DRAFT` ผูกกับ `TableSession`
  จุดที่ต้องระวังตอนต่อยอด: บรรทัดที่เหมือนกันทุกอย่างจะถูกรวม quantity เข้าด้วยกัน,
  `orderNumber` เป็น `YYYYMMDD-NNNN` ต่อสาขาต่อวันตาม timezone ของสาขา (ออกเลขตั้งแต่
  ตอนเปิดตะกร้า จึงมีเลขกระโดดได้ถ้าลูกค้าทิ้งตะกร้า — เลขใบกำกับภาษีที่ต้องต่อเนื่อง
  จริง ๆ เป็นคนละตัวและเป็นงานบทที่ 12), และตอนนี้เติมเฉพาะ `subtotal` เท่านั้น
  คอลัมน์ VAT/service charge/grandTotal ปล่อยเป็น 0 รอบทที่ 10
- **`app/(customer)/t/[tableCode]/actions.ts`** — Server Action ทุกตัวเรียก
  `resolveCustomerContext()` ตรวจสิทธิ์เองก่อนเสมอ เพราะ action ถูกยิงตรงด้วย POST ได้
- **`proxy.ts`** — เพิ่ม optimistic check: `/t/:code/(cart|item|orders)` ที่ไม่มี cookie เลย
  ให้ redirect กลับหน้าเปิดโต๊ะ (เช็คได้แค่ "มี cookie ไหม" ห้ามแตะ DB ในไฟล์นี้)
- **`next.config.ts`** — เปิด `images.remotePatterns` แบบกว้างไว้ก่อนสำหรับรูปเมนู
  **ต้องแคบให้เหลือเฉพาะ host ของร้านก่อน deploy ในบทที่ 16**

กันกดส่งออร์เดอร์ซ้ำทำไว้สองชั้น: ปุ่ม disable ตัวเองด้วย `useFormStatus` (กันกดรัว)
และ conditional update `status: "DRAFT"` ใน `placeOrder()` ซึ่งเป็นชั้นที่เชื่อถือได้จริง
— ถ้ากดซ้ำแล้วบิลถูกส่งไปแล้ว จะคืน "สำเร็จ" ไม่ใช่ error เพื่อไม่ให้ลูกค้าตกใจสั่งซ้ำอีกใบ

**เครื่องมือ dev ที่เพิ่มมาด้วย:**

- `npm run smoke:order` — ทดสอบ addToCart/setCartLineQuantity/placeOrder กับ DB จริง
  21 เคส (รวมเคสกดส่งพร้อมกันสองครั้ง) แล้วลบข้อมูลที่สร้างทิ้งให้เอง
- `npm run dev:reset-table <tableCode>` — ล้างรอบโต๊ะ+บิลของโต๊ะนั้นให้กลับไปเริ่มใหม่ (dev DB เท่านั้น)
- `npm run dev:session <tableCode>` — เปิดรอบโต๊ะแล้วพิมพ์ token ออกมา ใช้ทดสอบหน้าลูกค้า
  ด้วย `curl -H "Cookie: pos_table_session=<token>"` โดยไม่ต้องกดผ่านเบราว์เซอร์
- ทุกสคริปต์ใน `scripts/` รันด้วย `tsx --conditions=react-server` — **นี่คือวิธีรันโค้ดใน `lib/server/*`
  นอก Next.js ได้ทั้งที่มี `import "server-only"`** (flag นี้ทำให้ `server-only` resolve ไปที่
  โมดูลเปล่า) บทที่ 13 ที่ต้องแชร์ฟังก์ชัน hash PIN กับ `prisma/seed.ts` ใช้ท่านี้ได้

### หน้าจอพนักงาน (POS) + ล็อกอิน PIN + RBAC ✅ (บทที่ 9 บางส่วน + บทที่ 13 บางส่วน)

ทำเสร็จเมื่อ 2026-08-21 ผ่าน `tsc --noEmit`, `eslint`, `npm run build`, ทดสอบกับ dev DB จริง
58 เคส (`npm run smoke:pos`) และขับผ่าน HTTP จริงอีก 11 เส้นทาง
รายละเอียดเต็มอยู่ที่ `report/2026-08-21-pos-staff-screen.md`

> **ก้อนนี้ทำบทที่ 9 ก่อนบทที่ 8** สลับกับลำดับในหัวข้อ 5 — ผลคือตอนนี้ยังไม่มีใคร
> เปลี่ยนสถานะรายการจาก `PLACED` ได้เลย บทที่ 8 จะมาปิดช่องนี้

เส้นทางพนักงาน: `/pos/login` → `/pos` (ผังโต๊ะ) → `/pos/table/[tableId]` (บิลของโต๊ะ)
→ `.../menu` → `.../menu/[itemId]` (สั่งแทนลูกค้า)

- **`lib/rbac.ts`** — ตารางสิทธิ์ตามตำแหน่งที่เดียวจบ ห้ามกระจาย `role === "OWNER"` ไว้ทั่วโค้ด
  ไม่มี `server-only` เพราะหน้าจอต้องใช้ตัดสินว่าจะโชว์ปุ่มไหน — **แต่การซ่อนปุ่มไม่ใช่การกันสิทธิ์**
  ตอนทำบทที่ 8 ต้องเพิ่ม `"kds"` เข้า `StaffScreen` และตอนบทที่ 13 เพิ่ม `"admin"`
- **`lib/form-state.ts`** — `FormState` กลางของทุกฟอร์ม (เดิมอยู่ใน `t/[tableCode]/form-state.ts`)
  แยกจากไฟล์ `"use server"` ตามกฎในหัวข้อ 4
- **`lib/server/pin.ts`** — `hashPin`/`verifyPin` ด้วย `scrypt` **ที่เดียวในระบบ**
  `prisma/seed.ts` เรียกไฟล์นี้แล้ว (งานที่ค้างไว้จากก้อน schema ปิดแล้ว)
- **`lib/server/staff-session.ts`** — session เป็น cookie ที่เซ็น HMAC ไม่ใช่ตารางใน DB
  ราคาที่จ่ายคือ **ยกเลิก session ทันทีไม่ได้ ต้องรอหมดอายุ (8 ชม.)** บทที่ 13 ที่ต้องมีปุ่ม
  "เตะพนักงานออกทุกเครื่อง" ต้องเพิ่มตาราง `StaffSession` แล้วเช็ค revoke list ทับ;
  ตัวนับ PIN ผิด (5 ครั้ง/ล็อก 5 นาที) อยู่ใน memory ของ process **หลาย instance ไม่แชร์กัน**
  ต้องย้ายไป Postgres/Redis ก่อน deploy — ปัญหาเดียวกับ pub/sub ของ SSE บทที่ 8
- **`lib/server/pos.ts`** — ทุก query กรอง `staff.branchId` เสมอ; `closeTableSession()`
  ปิดได้เฉพาะรอบที่ไม่มีบิลเข้าครัว (มีของแล้วต้องผ่านการคิดเงินบทที่ 10 เท่านั้น
  ไม่งั้นเป็นช่องล้างบิลทิ้ง); `cancelOrderItemByStaff()` บังคับสิทธิ์+เหตุผล+`AuditLog`
  พร้อม snapshot ยอดเงิน และคิด `subtotal` ใหม่ ทั้งหมดใน `$transaction` เดียว
- **`lib/server/table-session.ts`** — แยก `openOrJoinTableSession()` เป็นแกนกลางที่ทั้ง
  ลูกค้าสแกน QR และพนักงานกดเปิดโต๊ะเรียกร่วมกัน **ห้ามก๊อปไปเขียนซ้ำสองที่**
  ไม่งั้นจะเกิดเคสโต๊ะเดียวได้สองบิล
- **`proxy.ts`** — **แก้บั๊กที่ทำให้ proxy ไม่เคยทำงานเลยตั้งแต่บทที่ 5** ดูหัวข้อ 4

**ยังไม่ได้ทำในบทที่ 9:** ย้าย/รวมโต๊ะ, แยกบิล (ต้องเป็น transaction เดียวที่ย้ายออร์เดอร์
ทั้งชุด) และหน้า POS ยังไม่ realtime ต้องกดโหลดใหม่

**เครื่องมือ dev ที่เพิ่มมาด้วย:**

- `npm run smoke:pos` — ทดสอบ PIN/RBAC/เปิดโต๊ะ/สั่งแทนลูกค้า/ยกเลิกรายการ/ปิดรอบ
  กับ DB จริง 58 เคส (ใช้โต๊ะ B1/B2 เพื่อไม่ชนกับ `smoke:order` ที่ใช้ A1) แล้วลบข้อมูลทิ้งเอง
- `npm run dev:staff-cookie <รหัสพนักงาน>` — ออก cookie พนักงานไว้ทดสอบด้วย
  `curl -H "Cookie: pos_staff_session=<token>"` (คู่กับ `dev:session` ของฝั่งลูกค้า)

### หน้าตา (UI) ของจอพนักงาน — design system "Modernist" ✅

ทาเมื่อ 2026-08-21 (งานแทรกด้าน UI ไม่ใช่บทในเล่ม ไม่แตะตรรกะธุรกิจเลย)
นำเข้าจาก Claude Design project `Cafe POS system UI` ผ่าน MCP `DesignSync`
รายละเอียดเต็มที่ `report/2026-08-21-pos-ui-modernist.md`

- **`app/globals.css`** — token + คลาสทั้งชุด (`.btn`, `.input`, `.ink-grid`,
  `.stepper`, `.tag`, `.display`, `.kicker`, `.panel`, `.alert`, `.modal`)
  **ผูกกับคลาส `.pos-skin` ไม่ใช่ `:root`** เพราะขอบเขตคือหน้าพนักงานเท่านั้น
  คลาสนี้แปะอยู่ที่ `app/(pos)/layout.tsx` **จุดเดียว** ถ้าจะขยายไปจอครัว/หลังร้าน
  ให้แปะที่ layout ของ route group นั้น **ห้ามย้าย token ขึ้น `:root`**
- ชื่อตัวแปรตั้งตรงกับไฟล์ design ต้นทางเป๊ะ ๆ เพื่อให้ก๊อป snippet มาวางได้เลย
- ภาษาของระบบนี้: **radius 0 ทุกจุด**, เส้นขอบหมึก 2px เป็นตัวแบ่งหลัก (ไม่ใช่เงา),
  หัวเรื่อง weight 800 tracking ติดลบ, accent `#ec3013` สีเดียว —
  **สถานะทุกอย่างสื่อด้วยความเข้ม ไม่ใช่หลายสี** (ผังโต๊ะจึงไม่ใช้เขียว/เหลืองแล้ว)
- **ฟอนต์:** Archivo (ตัวเลข/อังกฤษ) + Noto Sans Thai (ตัวไทย) ผ่าน `next/font/google`
  มีกับดักที่ต้องรู้ก่อนแตะ — ดูหัวข้อ 4
- **`components/item-options-form.tsx`** ใช้ร่วมกับหน้าลูกค้า จึงมี prop
  `skin?: "default" | "pos"` ที่แยกแค่การจัดวาง **กฎการเลือกเป็นโค้ดชุดเดียวกัน ไม่มี branch**
- `.pos-skin *{border-radius:0}` เป็นไม้ตายที่ล้างมุมมนทับทั้งซับทรี — ถ้าวันหนึ่ง
  อยากได้มุมมนที่ไหนในหน้า POS ต้องลบกฎนี้ก่อนแล้วไล่เก็บ `rounded-*` ที่ค้างแทน
- **`/pos/table/[tableId]` คือจอหลักของพนักงาน มีทั้งเมนูและตะกร้าอยู่จอเดียว**
  (ซ้าย = ตารางเมนู สลับเป็นบิลที่ส่งแล้วด้วย `?view=bills` · ขวา = ตะกร้าปักถาวร 412px)
  `/pos/table/[tableId]/menu` เหลือไว้เป็น redirect เท่านั้น
  **ห้ามแยกเมนูออกไปเป็นหน้าใหม่อีก** — พนักงานพูดกับลูกค้าไปกดไป ต้องเห็นตะกร้า
  โตขึ้นทันทีที่กดโดยไม่มีการเปลี่ยนหน้าคั่น
- **แถบข้าง `pos-sidebar.tsx`** ลิสต์โมดูล 01-06 ตาม design โมดูลที่ยังไม่ได้ทำ
  เป็นข้อความจางพร้อมเลขบท **ไม่ใช่ลิงก์** — ทำบทไหนเสร็จให้เติม `href` ของโมดูลนั้น
  แล้วมันจะกดได้เอง (เป็นที่เดียวที่ต้องแก้)
- layout ของ `(pos)` ตอนล็อกอินแล้วเป็น `h-dvh overflow-hidden` เพื่อให้แต่ละแพเนล
  เลื่อนแยกกัน — **หน้าใหม่ใน `(pos)` ต้องใส่ `min-h-0` + `overflow-auto` เองเสมอ**
  ไม่งั้นเนื้อหาจะถูกตัดหายแทนที่จะเลื่อนได้

หน้าลูกค้า / KDS / หลังร้าน **ยังเป็นลุคเดิมทั้งหมด** (ยืนยันแล้วว่าไม่มี `pos-skin` หลุดไป)

### จอครัว (KDS) + ท่อ realtime ด้วย SSE ✅ (บทที่ 8)

ทำเสร็จเมื่อ 2026-08-22 ผ่าน `tsc --noEmit`, `eslint`, `npm run build`
และทดสอบกับ dev DB จริง 134 เคส (`smoke:order` 21 + `smoke:pos` 58 + `smoke:kds` 55)
พร้อมทดสอบ SSE ผ่าน HTTP จริงอีก 12 เส้นทาง รวมถึงการยิง event ข้าม process จริง
รายละเอียดเต็มที่ `report/2026-08-22-kds-realtime-sse.md`

เส้นทางครัว: `/kds/login` → `/kds` (ทุกสถานี) → `/kds?station=<id>` (สถานีเดียว)

- **`lib/realtime-events.ts`** — contract ของ event (ไม่มี `server-only` เพราะ client ใช้ด้วย)
  **กฎเหล็ก: event เป็นแค่ "สัญญาณให้ไปโหลดใหม่" ห้ามแบกข้อมูลบิล/ราคา/ชื่อเมนูมาด้วย**
  ทุกหน้าจอรับ event แล้วสั่ง `router.refresh()` ให้ RSC ไปดึงของใหม่ผ่านด่านสิทธิ์เดิม
  — ข้อมูลมีทางเข้าออกทางเดียวเสมอ ไม่มีวันที่สองทางกรองไม่เหมือนกันแล้วข้อมูลรั่ว
- **`lib/server/realtime.ts`** — pub/sub สอง driver เลือกด้วย `REALTIME_DRIVER`
  (`memory` = ค่าเริ่มต้น · `postgres` = LISTEN/NOTIFY) **ต้องตั้ง `postgres` ก่อน
  deploy หลาย instance** ไม่งั้นจอครัวที่เสียบ instance B ไม่เห็นออร์เดอร์ที่เข้า instance A
  ทั้งสอง driver emit ในเครื่องตัวเองก่อนเสมอ (local-first) แล้วค่อยยิง NOTIFY ออก
  และ **`publishRealtimeEvent()` ต้องเรียกหลัง commit ห้ามเรียกใน `$transaction`**
- **`app/api/realtime/route.ts`** — SSE Route Handler ทางเดียวของทั้งระบบ
  `?table=<code>` = ลูกค้า (ได้เฉพาะ event ของโต๊ะตัวเอง) · ไม่มี query = พนักงาน (ทั้งสาขา)
  ตอบ **401 ไม่ใช่ redirect** เพราะ EventSource ตาม redirect ไปหน้า HTML แล้วพัง
- **`components/live-refresh.tsx`** — ตัวรับ event ตัวเดียวใช้ได้ทุกจอ (รวม event 300ms)
- **`lib/server/order-progress.ts`** — `syncOrderStatusFromItems()` **ที่เดียวในระบบ**
  ที่ปรับสถานะบิลตามรายการ ต้องเรียกใน transaction เดียวกับที่แก้ `OrderItem` เสมอ
  สถานะบิล = สถานะของรายการที่ **ช้าที่สุด** (ยอมข้ามขั้นได้ แต่ห้ามถอยหลัง)
- **`lib/server/kds.ts`** — กรองด้วย `OrderItem.stationId` ที่ snapshot ไว้ ห้าม join เมนูสด
  ครัวเดินได้แค่ `PLACED → IN_PROGRESS → READY` ไม่มีปุ่มถอยหลัง และ `to` ไม่รับจากหน้าจอ
  (อ่านสถานะสดจาก DB เอง — สองจอที่ถือ HTML คนละเวอร์ชันจะได้ไม่ดันสถานะย้อน)
- **`app/globals.css`** — เพิ่ม `.pos-skin.kds-skin` = **โหมดกลับสีของ design system เดิม**
  ใช้คู่กันเสมอ (`class="pos-skin kds-skin"`) ไม่ได้ก๊อป component layer มาเขียนใหม่

**บั๊กสองตัวที่มีอยู่ก่อนบทที่ 8 แล้วเพิ่งโผล่ตอน SSE ทำให้หน้าจอ refresh เอง:**

1. **บิลที่มีน้ำเปล่าปนอยู่จะคิดเงินไม่ได้ตลอดกาล** — ของที่ `stationId = null`
   ไม่ขึ้นจอครัว จึงไม่มีใครกดเปลี่ยนสถานะได้ ค้างที่ `PLACED` แล้วบิลไม่มีวันถึง
   `SERVED` → แก้ที่ `placeOrder()` ให้ของพวกนี้ข้ามไป `READY` ตั้งแต่ตอนกดส่ง
   และเพิ่มปุ่ม "เสิร์ฟแล้ว" บน `/pos/table/[tableId]?view=bills` เพราะจอครัวไม่แสดงของพวกนี้
2. **สองจอบนเบราว์เซอร์เดียวกันเตะกันเอง** — cookie session พนักงานมีใบเดียวทั้งระบบ
   ล็อกอิน KDS ทับ cookie ของ POS แล้วพอ SSE สั่ง refresh จอ POS ก็เด้งไปล็อกอิน วนไม่จบ
   → **แยก cookie ต่อหน้าจอ** (`pos_staff_session` / `kds_staff_session`) ทุกฟังก์ชันใน
   `lib/server/staff-session.ts` รับ `screen: StaffScreen` แล้ว
   `Record<StaffScreen, string>` ใน `lib/staff-session-cookie.ts` จะบังคับให้เพิ่ม
   cookie ของ `"admin"` ตอนบทที่ 13 เอง (tsc พังถ้าลืม)

**RBAC — "เห็นจอ" กับ "กดปุ่มบนจอ" ไม่ใช่สิทธิ์เดียวกัน** (`lib/rbac.ts`)
เสิร์ฟเข้าจอครัวได้แต่กดปุ่มครัวไม่ได้ · ครัวกด "เสิร์ฟแล้ว" ไม่ได้ ·
แคชเชียร์เข้าจอครัวไม่ได้แต่กดเสิร์ฟได้ — เหตุผลของแต่ละข้ออยู่ในคอมเมนต์ของไฟล์

**หน้าล็อกจอ:** ช่อง PIN ใหญ่ขึ้น + **พิมพ์ด้วยคีย์บอร์ดได้แล้ว** (วาง `<input>` จริง
ทับแบบโปร่งใส **ห้ามใช้ `hidden`/`display:none`** เพราะ focus ไม่ได้แล้วแป้นมือถือไม่ขึ้น)
และโชว์ชื่อคนล่าสุดที่ใช้เครื่องนี้จาก cookie — **เก็บแค่ชื่อ+ตำแหน่ง ไม่เก็บรหัสพนักงาน**

**เครื่องมือ dev ที่เพิ่มมา:**

- `npm run smoke:kds` — 55 เคส (`REALTIME_DRIVER=postgres` ได้ 56 เคส รวมเส้นทาง LISTEN/NOTIFY)
- `REALTIME_DRIVER=postgres npm run dev:emit [type] [tableCode]` — ยิง event จาก process อื่น
  ใช้ทดสอบว่าจอที่เปิดค้างอยู่ขยับจริงไหมโดยไม่ต้องกดสั่งอาหารครบเส้นทาง
  (ต้องตั้ง env ทั้งที่สคริปต์และที่ server ไม่งั้นไม่มีอะไรเกิดขึ้น)

### ทุกจอ responsive แล้ว ✅ (งานแทรกด้าน UI ไม่ใช่บทในเล่ม)

ทำเสร็จเมื่อ 2026-08-22 · ไม่แตะตรรกะธุรกิจเลย · smoke test ทั้งสามชุดยังเท่าเดิม
วัดการล้นแนวนอนจริงด้วย headless Chrome **32/32 เคสไม่ล้น** (8 หน้า × 4 ความกว้าง)
รายละเอียดเต็มที่ `report/2026-08-22-responsive-screens.md`

| ของ | จอแคบ | จุดตัด | จอกว้าง |
|---|---|---|---|
| แถบโมดูลของ POS | แถบล่าง (เฉพาะโมดูลที่กดได้) | `lg` | แถบซ้าย 268px |
| ตะกร้าของหน้าโต๊ะ | แถบสรุปล่าง กางได้ | `xl` | แผงปักขวา 412px |
| สองคอลัมน์ของหน้าล็อกจอ | ซ้อนกัน | `xl` | `1fr` + 620px |

ตะกร้าตัดที่ `xl` ไม่ใช่ `lg` เพราะที่ 1024px จะเหลือให้เมนูแค่ 344px (วางสองคอลัมน์ไม่ได้)
· `components` ใหม่: `app/(pos)/pos/_components/cart-panel.tsx` —
**เป็น element เดียวที่เปลี่ยนคลาสตัวเอง ห้ามทำเป็นสองชุดสลับกันโชว์**
เพราะข้างในมี `<form>` หลายใบ ถ้า render สองชุดจะได้ `useActionState` เดินซ้อนกัน

**⚠ กับดักที่เพิ่งโดนมาแล้วหนึ่งครั้ง — ห้ามลืม:**
คลาสของ design system (`ink-row`, `ink-grid`, `panel`, `btn`, `stepper`, `modal`)
เขียนเป็น `.pos-skin .xxx` = specificity 0-2-0 ซึ่ง **ชนะ utility ของ Tailwind
ที่เป็นคลาสเดียว (0-1-0)** — `<nav className="ink-row lg:hidden">` จึงไม่ถูกซ่อน
และโผล่เป็นแถบแดงตั้งบนจอกว้างโดยที่ tsc/build ไม่ฟ้องอะไรเลย
ถ้าต้องซ่อน/แสดงตามขนาดจอ ให้ครอบด้วย `<div>` เปล่าแล้วซ่อนตัวครอบ
หรือเขียนหน้าตาด้วย utility ล้วน (ตระกูลเดียวกับข้อ `.pos-skin *{border-radius:0}` ในหัวข้อ 4)

เพิ่มคลาส **`.ink-grid-sparse`** ใน `globals.css` สำหรับกริดที่แถวสุดท้ายไม่เต็ม
(กลับวิธีวาดเส้น: พื้นกริดเป็นกระดาษ แล้วให้แต่ละช่องวาดวงแหวนหมึกเอง)
เป็น opt-in **ห้ามเอาไปแก้ `.ink-grid` เดิม** เพราะ `.btn-tile` มี `all: unset`
ที่จะล้าง `box-shadow` ทิ้ง แล้วแป้น PIN จะเส้นหาย

### คิดเงิน + หลายสกุลเงิน (THB/LAK/VND) ✅ (บทที่ 10)

ทำเสร็จเมื่อ 2026-08-22 · ผ่าน `tsc`, `eslint`, `build` · smoke `bill` 43 เคส FAIL 0
รายละเอียดเต็มที่ `report/2026-08-22-bill-and-currency.md`

**⚠ กฎใหม่ที่สำคัญที่สุดของโปรเจกต์ตอนนี้ — เงินไม่ใช่ "สตางค์" อีกต่อไป**

เลข `6000` ในคอลัมน์ราคา **ไม่ได้แปลว่า 60.00 เสมอไป** แต่แปลว่า "6000 หน่วยย่อย
ที่สุดของสกุลเงินสาขานั้น": ไทย = ฿60.00 · ลาว = ₭6,000 · เวียดนาม = 6.000 ₫
(LAK/VND ไม่มีทศนิยม — att กับ hào/xu เลิกใช้จริงแล้ว)

- **ห้ามหารด้วย 100 ที่ไหนก็ตามนอก `lib/money.ts`**
- **ห้ามเขียน "฿" ลงหน้าจอตรง ๆ** ทุกที่ต้องเรียก `formatMoney(amount, currency)`
  โดย `currency` มาจาก `branch.currency` เสมอ (client component รับเป็น prop)
- `Branch.currency` เป็น **enum `Currency`** แล้ว และ `CURRENCIES` ใน `lib/money.ts`
  เป็น `Record<Currency, ...>` — เพิ่มสกุลใน schema แล้วลืมเพิ่มรูปแบบแสดงผล tsc จะฟ้องเอง
- VND คั่นหลักพันด้วย **จุด** และสัญลักษณ์อยู่ **ท้าย** ("6.000 ₫" = หกพันดอง)
- `formatAmount()` ประกอบสตริงเอง **ไม่ใช้ `Intl.NumberFormat`** เพราะ locale ของ
  server กับ browser ไม่ตรงกันแล้วจะเกิด hydration mismatch (ราคากะพริบเปลี่ยนเลข)

**`lib/bill.ts` — `calculateBill()` ที่เดียวในระบบที่คิดยอดสุดท้าย**

- ลำดับ **เซอร์วิสชาร์จ → VAT** เสมอ (เซอร์วิสชาร์จเป็นรายได้ร้าน = อยู่ในฐาน VAT)
- `pricesIncludeVat = true` → **ถอด** VAT ออกมาแสดง (`× vat ÷ (10000+vat)`)
  ไม่ใช่บวกเพิ่ม · `false` → บวกเพิ่มท้ายสุด — **คนละสูตร คนละตัวเลข**
- ปัดเศษด้วย `%` แล้วหารส่วนที่ลงตัว **ไม่มีขั้นตอนไหนเป็น float เลย**
  (ปัดครึ่งขึ้น — เปลี่ยนได้ที่ `applyRate()` ที่เดียว)
- รับประกัน `netAmount + vatAmount === grandTotal` และทุกค่าเป็นจำนวนเต็ม

**`lib/server/billing.ts` — หนึ่งบิล = หนึ่ง "รอบโต๊ะ" ไม่ใช่หนึ่ง Order**
รวม subtotal ของทุกออร์เดอร์ในรอบก่อน **แล้วค่อยคิดเซอร์วิสชาร์จ/VAT ครั้งเดียว**
— คิดทีละใบแล้วบวกจะปัดเศษหลายรอบแล้วเพี้ยน (มีเคสทดสอบยืนยัน)

**หน้า `/pos/table/[tableId]/bill` อ่านอย่างเดียว** ยังไม่มีปุ่มรับเงิน
และตั้งใจไม่ใส่ปุ่มปลอม · อัตราที่ใช้มาจาก `Branch` (ค่าปัจจุบัน) เพราะบิลยังไม่ปิด
— **บทที่ 11 ต้อง snapshot อัตราลง `Order` ตอนปิดบิล** แล้วใบเสร็จย้อนหลัง
อ่านจากตรงนั้นเท่านั้น ห้ามกลับมาอ่าน `Branch` อีก

`discountAmount` รองรับในสูตรแล้วแต่ **ยังไม่มีปุ่ม** — ส่วนลดคือช่องโกงอันดับต้น ๆ
ต้องมาพร้อม จำกัดตามตำแหน่ง + บังคับเหตุผล + `AuditLog` (บทที่ 13)

**หมายเหตุ migration:** `Branch.currency` String→enum เขียน SQL เองเป็น cast ในที่
เพราะ generator เลือก DROP+CREATE ซึ่งทำให้ทุกสาขากลับเป็น THB พร้อมกัน
ถ้าต้องแปลงชนิดคอลัมน์อีกในอนาคต ให้ใช้ `--create-only` แล้วอ่าน SQL ก่อนเสมอ

### รับเงิน / ปิดบิล — โหมดสาธิต ✅ (บทที่ 11)

ทำเสร็จเมื่อ 2026-08-22 · ผ่าน `tsc`, `eslint`, `build` · smoke ทั้งห้าชุด
**244 เคส FAIL 0** (order 21 · pos 58 · kds 55 · bill 43 · **payment 67**)
วัดการล้นแนวนอน 12 เคส ไม่ล้นเลย · รายละเอียดเต็มที่
`report/2026-08-22-chapter-11-payment.md`

**⚠ เป็นโหมดสาธิต ไม่ได้ต่อกับ payment gateway จริง** แคชเชียร์กดเลือกเงินสด/QR
เองแล้วกดยืนยัน = บิลปิด · QR เป็นภาพ placeholder ที่ตั้งใจวาดให้ดูออกว่าปลอม
พร้อมป้ายบอกบนจอ · วันที่ต่อของจริงต้องแตก `takePayment()` เป็นสองขั้น
(ตั้งรายการรอชำระ → ยืนยันเมื่อธนาคาร callback) **แก้ที่ฟังก์ชันนั้น ไม่ใช่ที่หน้าจอ**

- **`Payment` (ตารางใหม่) คือยอดที่ลูกค้าจ่ายจริง** — บิลคิดที่ระดับ "รอบโต๊ะ"
  แต่คอลัมน์ยอดเงินอยู่ที่ `Order` ซึ่งมีหลายใบต่อรอบ ยอดใน `Order` จึงเป็นแค่
  **ส่วนแบ่ง** ที่กระจายลงไปเพื่อทำรายงานแยกช่องทาง/แยกพนักงาน (บทที่ 15)
  — **ใบเสร็จบทที่ 12 ต้องอ้าง `Payment` ห้ามใช้ผลบวกของ `Order`**
- **`distributeByWeight()` ใน `lib/bill.ts`** — largest remainder, `sum === total` เสมอ
  **ห้ามคิดเซอร์วิสชาร์จ/VAT ใหม่ทีละใบ** (ปัดเศษหลายรอบแล้วยอดไม่ตรงกับที่ลูกค้าจ่าย)
  และ `Order.grandTotal` **ประกอบจากชิ้นส่วนของแถวตัวเอง** ด้วยสูตรเดียวกับ
  `calculateBill()` ไม่ได้แบ่งแยกอีกชุด — ไม่งั้นบางแถวจะบวกเองไม่ลงตัว
- **กันจ่ายซ้ำ = ปิดรอบโต๊ะแบบมีเงื่อนไข** (`updateMany` where `status: "OPEN"`)
  เป็นคำสั่งแรกใน transaction · `count === 0` → คืน Payment ใบเดิม ไม่ใช่ error
  · กดซ้ำแบบเรียงกันภายใน 60 วินาทีก็พากลับไปใบเดิม เลยจากนั้นถึงเป็น error
- **ต้อง `throw` (`PaymentAbort`) เพื่อ rollback ห้าม `return`** — เงื่อนไขหลายข้อ
  ตรวจได้หลังจากที่ปิดรอบโต๊ะไปแล้ว ถ้า return เฉย ๆ รอบโต๊ะจะถูกปิดโดยไม่ได้รับเงิน
- **ห้ามเชื่อยอดที่ client ส่งมา** คิดใหม่ใน transaction เสมอ · `expectedTotal`
  ที่หน้าจอแนบมาใช้แค่ตรวจว่าบิลเปลี่ยนระหว่างกดหรือเปล่า → ถ้าไม่ตรง **ไม่ยอมปิดบิล**
- **ตะกร้า `DRAFT` ที่มีของ = จ่ายไม่ได้** (ต่างจาก "ของที่ยังไม่ได้เสิร์ฟ" ที่แค่เตือน)
  เพราะมันไม่ได้อยู่ในยอดบิล ปล่อยให้ปิดคือของหายไปพร้อมรอบโต๊ะ
- **`parseMoneyInput()` ใน `lib/money.ts`** — `19.99 * 100 === 1998.9999999999998`
  จึงแยกสตริงที่จุดทศนิยมแล้วประกอบเป็นจำนวนเต็ม ไม่คูณแบบ float
- **`canTakePayment()`** = OWNER/MANAGER/CASHIER (ชุดเดียวกับ `canCancelOrderItem`)
  พนักงานเสิร์ฟกดไม่ได้ — คนถือเงินกับคนเสิร์ฟต้องแยกกัน
- **`/pos/table/[id]/bill` เป็นหน้าเดียวสองโหมด** — `?paid=<id>` = หน้าสรุปการรับเงิน
  ที่อ่านจาก snapshot ล้วน (ต้องมี เพราะปิดบิลแล้วรอบโต๊ะปิดไปด้วย หน้าเดิมจะว่างเปล่า)
- **ของที่ยังไม่ได้ทำยังอยู่บนจอครัวต่อไปแม้บิลจะ PAID** — ตั้งใจให้เป็นแบบนี้
  เพราะลูกค้าจ่ายก่อนได้ **แต่ตอนบทที่ 11 โค้ดยังไม่ได้ทำตามที่เขียนไว้ตรงนี้**
  (`getKitchenTickets()` กรองสถานะ *บิล* ทับอีกชั้น ตั๋วจึงหลุดตอนกดรับเงิน)
  แก้แล้วเมื่อ 2026-08-24 ดู `report/2026-08-24-kds-sale-point-label.md`

**⚠ กับดักที่ทำให้ dev tooling พังทั้งชุด:** `Order → Payment` และ
`Payment → TableSession` เป็น `Restrict` ทั้งคู่ → ทุกที่ที่ล้างโต๊ะต้องลบตามลำดับ
**ออร์เดอร์ → การรับเงิน → รอบโต๊ะ** (แก้ไปแล้วทั้ง `dev:reset-table` และ smoke ทั้งสามชุดเดิม)

**⚠ สคริปต์ที่ `subscribeToBranch()` ต้องเรียก `stopRealtime()` ตอนจบเสมอ**
ไม่งั้นตอน `REALTIME_DRIVER=postgres` process จะค้างไม่จบ

`npm run smoke:payment` — 67 เคส (ใช้โต๊ะ A3 · รวมเคสกดพร้อมกันสองเครื่อง
และเคสสาขาสกุลเงิน VND ที่สลับสาขาชั่วคราวแล้วคืนค่าเดิมใน `finally`)

### จอหลังร้าน + จัดการเมนู ✅ (โมดูล 04 — ฐานของบทที่ 13)

ทำเสร็จเมื่อ 2026-08-22 · ผ่าน `tsc`, `eslint`, `build` · smoke หกชุด **299 เคส FAIL 0**
(order 21 · pos 58 · kds 55 · bill 43 · payment 67 · **menu 55**)
รายละเอียดเต็มที่ `report/2026-08-22-module-04-menu-admin.md`

เส้นทาง: `/admin/login` → `/admin/menu` (ลิสต์หมวด+เมนู) · `/admin/modifiers` (กลุ่มตัวเลือก)
→ `/admin/menu/item/[id]` · `/admin/menu/category/[id]` · `/admin/modifiers/[id]`
(`[id]` เป็นคำว่า `new` = สร้างใหม่ — route เดียวใช้ทั้งสร้างและแก้)

- **จอที่สี่แล้ว** — `StaffScreen = "pos" | "kds" | "admin"` · cookie ใบที่สาม
  `admin_staff_session` · `proxy.ts` มี `ADMIN_SESSION_REQUIRED`
  (กับดัก `Record<StaffScreen, string>` ที่วางไว้ตั้งแต่บทที่ 8 ทำงานจริง: tsc พังทันที
  ที่เติม `"admin"` แล้วยังไม่เติม cookie)
- **ทุกตำแหน่งเข้าจอนี้ได้** ต่างจาก POS/KDS โดยตั้งใจ — เพราะ "ของหมด" เกิดกลางกะ
  และคนที่รู้ก่อนคือคนที่ยืนอยู่ในร้าน · ครัวเข้าได้ทั้งที่เข้า POS ไม่ได้
  **แต่ `canEditMenu()` = OWNER/MANAGER เท่านั้น** (แก้ราคา = เปลี่ยนสิ่งที่ลูกค้าต้องจ่าย)
- **`lib/server/menu-admin.ts` แยกจาก `lib/server/menu.ts` เด็ดขาด** — ไฟล์หลังกรอง
  `isAvailable` ทุกชั้นเพื่อหน้าลูกค้า ถ้ารวมไฟล์จะเกิด flag `includeUnavailable`
  วิ่งทุกฟังก์ชัน แล้ววันหนึ่งจะมีคนลืมส่ง แล้วเมนูที่ปิดอยู่จะโผล่บนมือถือลูกค้า
- **ลบจริงได้เฉพาะของที่ไม่เคยถูกใช้** (นับ `OrderItem`/`OrderItemModifier` ก่อนเสมอ)
  ที่เหลือบังคับเป็น "ปิดขาย" · ตัวเลือกที่ถูกเอาออกจากฟอร์มกลุ่ม = ปิดขายอัตโนมัติ ไม่ลบ
- **`minSelect > จำนวนตัวเลือกในกลุ่ม` = ลูกค้ากดใส่ตะกร้าไม่ผ่านตลอดกาล**
  กันไว้ฝั่ง server แล้ว — เป็นเคสที่พังที่ "หน้าลูกค้า" ไม่ใช่หน้าที่กดแก้
- **`sortOrder` ไม่มี unique constraint** → `moveSortOrder()` เขียนเลขใหม่ทั้งชุด
  ไม่ใช่สลับค่าสองแถว (ค่าซ้ำกันแล้วปุ่มจะดูเหมือนเสียโดยไม่มี error)
- **`parseMoneyInput()` รับเลขติดลบแล้ว** (`Modifier.priceDelta` ติดลบได้)
  ส่วนช่องที่ห้ามติดลบตรวจที่ชั้นบน ไม่ใช่ในตัวแปลง
- **`menu.changed` + `CUSTOMER_BROADCAST_EVENTS`** — SSE กรองให้ลูกค้าเห็นเฉพาะ event
  ของโต๊ะตัวเอง แปลว่า event ระดับสาขา (`tableId: null`) ไม่มีวันถึงลูกค้า
  จึงต้องมี **รายชื่อ opt-in** ค่าเริ่มต้นคือ "ไม่ส่ง" เสมอ (วันหนึ่งจะมี event ระดับสาขา
  ที่ลูกค้าไม่ควรเห็น เช่น "ปิดกะแล้ว" ที่บอกยอดขายได้) — มีเทสต์ตรึงรายชื่อนี้ไว้
- **AuditLog เก็บราคาก่อน-หลังเสมอ แม้ราคาไม่เปลี่ยน** — สิ่งที่ต้องตอบให้ได้ย้อนหลัง
  คือ "ราคาช่วงนั้นเท่าไหร่" ไม่ใช่แค่ "ครั้งไหนที่เปลี่ยน"

**⚠ กับดักใหม่ที่สำคัญที่สุด — `sr-only` ทำให้ "ทั้งหน้าเลื่อนได้"**

`sr-only` ของ Tailwind คือ `position: absolute` — ถ้าไม่มีบรรพบุรุษที่ถูก position ไว้
มันจะยึดกับ viewport แล้ว **ทะลุ `overflow: hidden` ของเชลล์ออกไปดันความสูงของทั้ง document**
ป้ายบอกปุ่มขนาด 1×1px ที่มองไม่เห็นเลยทำให้ทั้งหน้าเลื่อนได้อีก 184px แถบหัวจอหลุดหายไป
โดยที่ tsc/eslint/build เงียบสนิท

แก้ด้วย **`position: relative` ที่ `.pos-skin` ใน `app/globals.css`** (บรรทัดเดียว
ครบทั้งสามจอ) **ห้ามลบบรรทัดนั้น**

**และบทเรียนของเครื่องมือ:** สคริปต์ audit ที่ใช้มาตั้งแต่บทที่ 9 วัด **แนวนอน**
อย่างเดียว (`scrollWidth > innerWidth`) บั๊กนี้จึงรอดมาได้ — ตอนนี้ต้องวัด
**แนวตั้งด้วย** (`documentElement.scrollHeight > innerHeight` ที่หลายความสูง)
ทุกครั้งที่ทำหน้าจอใหม่

### ใบเสร็จ / ใบกำกับภาษีอย่างย่อ (ABB) ✅ (บทที่ 12)

ทำเสร็จเมื่อ 2026-08-23 · ผ่าน `tsc`, `eslint`, `build` · smoke **เจ็ดชุด 381 เคส FAIL 0**
(order 21 · pos 58 · kds 55 · bill 43 · payment 67 · menu 55 · **receipt 82**)
รายละเอียดเต็มที่ `report/2026-08-23-chapter-12-receipt.md`

เส้นทาง: `/pos/receipt/[receiptId]` · `/admin/receipts` · `/admin/receipts/[receiptId]`

- **`Receipt` แยกจาก `Payment`** — `Payment` = เงินที่ได้รับ · `Receipt` = เอกสารที่ออกให้
  แถว Receipt **snapshot ตัวตนผู้ขาย ณ วันที่ออกใบ** (`sellerName`/`sellerTaxId`/
  `sellerBranchName`/`sellerAddress`/`sellerPhone`) **ห้าม join `Tenant`/`Branch` สด
  ตอนพิมพ์ซ้ำ** — ร้านเปลี่ยนชื่อ/ย้ายที่อยู่/ขึ้น VAT แล้วใบเก่าต้องพิมพ์ออกมาเหมือนเดิมเป๊ะ
  (มีเทสต์ตรึงไว้) · ใบลดหนี้ตอนทำ Refund ในอนาคตจะเป็น **Receipt อีกแถวที่อ้างใบเดิม**
- **`DocumentCounter` + `update ... { increment: 1 }` ใน transaction เดียวกับการรับเงิน**
  = เลขไม่ซ้ำแม้กดพร้อมกัน (row lock) · **เลขไม่ขาดเป็นรูเมื่อ rollback** ·
  ไม่มีบิลที่จ่ายแล้วแต่ไม่มีเอกสาร — **ออกใบตอนรับเงิน ไม่ใช่ตอนกดพิมพ์**
  (ถ้า "กดพิมพ์ = ออกเลข" แคชเชียร์เลี่ยงการออกใบได้ แล้วเลขจะขาด)
  · แถว counter ต้องมีอยู่ก่อนเสมอ (migration + seed สร้างให้) — `issueReceipt()`
  ใช้ `update` ไม่ใช่ `upsert` โดยตั้งใจ
- **`Receipt.number` unique ต่อสาขา ไม่ใช่ทั้งระบบ** — `Branch.code` ไม่ซ้ำแค่ใน tenant
  เดียวกัน สอง tenant มีสาขา `HQ` ได้ทั้งคู่แล้วเลขจะชนข้ามร้าน
- **`lib/server/receipt-issue.ts` เป็น leaf module แยกจาก `receipt.ts`** เพื่อกัน
  import cycle (`receipt.ts` → `payment.ts` → `receipt-issue.ts`)
  **ห้ามเพิ่ม import ที่ชี้กลับไปหา `payment.ts`/`receipt.ts` ในไฟล์นั้น**
- **สองเส้นทางบาง ๆ บน `components/receipt-document.tsx` ตัวเดียว** — ไม่ทำ
  `/receipt/[id]` ที่รับ cookie ใบไหนก็ได้ เพราะเป็น auth แบบที่สี่ที่ระบบนี้ตั้งใจไม่มี
  → **`proxy.ts` ไม่ต้องแก้เลยทั้งบท** · Server Action มีคู่แฝดสองตัวด้วยเหตุผลเดียวกัน
- **สองสิทธิ์ ไม่ใช่หนึ่ง:** `canReprintReceipt` = OWNER/MANAGER/CASHIER (ลูกค้าขอใบซ้ำ
  ที่เคาน์เตอร์เป็นงานทุกวัน) · `canBrowseReceipts` = OWNER/MANAGER เท่านั้น
  (ลิสต์ย้อนหลัง = เห็นยอดขายทั้งสาขา) — **แคชเชียร์พิมพ์ได้แต่ค้นย้อนหลังไม่ได้**
- **นับการพิมพ์จากปุ่ม ไม่ใช่ `onafterprint`** (event นั้นยิงตอนกด Ctrl+P เองด้วย)
  บันทึกไม่สำเร็จ = ไม่เปิดกล่องพิมพ์เลย · ใบที่พิมพ์ครั้งที่ 2 ขึ้นไปขึ้นคำว่า "สำเนา"
  · `AuditLog: receipt.print` เขียนทุกครั้ง **รวมครั้งแรก**

**⚠ กับดักที่ต้องรู้ก่อนทำหน้าที่พิมพ์ได้หน้าถัดไป:**

1. **เชลล์ `h-dvh overflow-hidden` ตัดใบเสร็จครึ่งใบตอนพิมพ์** — วัดจริงแล้ว: จอสูง
   400px พิมพ์ได้แค่ 400px ทั้งที่ใบสูง 790px · `@media print` ใน `globals.css`
   ต้องปลด `height: auto` + `overflow: visible` ให้ `html, body, .pos-skin` เสมอ
2. **ต้องแปะ `data-print-hide` ที่ chrome ใน layout ของ route group ด้วย**
   ไม่ใช่แค่ในไฟล์หน้านั้น — บั๊กนี้เกิดจริง แถบหัวจอ POS กับแถบโมดูลติดไปบนกระดาษ
   **และเทสต์เดิมปล่อยผ่าน** เพราะถามว่า "ของที่แปะป้ายถูกซ่อนไหม" แทนที่จะถามว่า
   "มีอะไรอื่นเหลือบนกระดาษไหม" — เทสต์ตอนนี้เดินทุก element ที่ไม่ได้อยู่ในตัวใบแล้ว
3. **`@page { size: 80mm auto }` ใช้ได้กับ "Save as PDF" และเครื่องพิมพ์ความร้อน**
   ปลายทางที่มีขนาดกระดาษตายตัวจะใช้ขนาดของตัวเอง แล้วใบไปชิดมุมบนซ้าย — ไม่ใช่บั๊ก
4. **สายการลบยาวขึ้นอีกชั้น: ออร์เดอร์ → ใบเสร็จ → การรับเงิน → รอบโต๊ะ**
   (`Receipt.paymentId` เป็น Restrict) แก้ไปแล้วทั้ง `dev:reset-table` และ smoke ทุกชุด
5. **Git Bash แปลง `/admin/menu` ในอาร์กิวเมนต์เป็น `C:/Program Files/Git/admin/menu`**
   ต้องตั้ง `MSYS_NO_PATHCONV=1` — และ **สคริปต์ตรวจ UI ต้องยืนยัน `location.href`
   ก่อนเชื่อผลวัด** ไม่งั้นวัดหน้า `about:blank` แล้วรายงานว่าผ่านทุกเคส

### ส่วนลดพนักงาน + หน้าอ่าน AuditLog ✅ (บทที่ 13a)

ทำเสร็จเมื่อ 2026-08-23 · smoke **แปดชุด 459 เคส FAIL 0** (เพิ่ม `staff-meal` 78 เคส)
รายละเอียดเต็มที่ `report/2026-08-23-chapter-13a-staff-meal.md`

> บทที่ 13 ที่เหลือถูกแบ่งเป็นสองก้อน — **13b ยังไม่ได้ทำ**: ตาราง `StaffSession` ·
> จัดการพนักงาน/รีเซ็ต PIN · ย้ายตัวนับ PIN ผิดไป DB

เส้นทางใหม่: `/admin/audit-logs` · แผงติดธงอยู่ใน `/pos/table/[tableId]/bill`

- **ส่วนลดในก้อนนี้คือ "ส่วนลดพนักงาน" อย่างเดียว** (ทุกตำแหน่งกินแล้วลด 10%)
  **ปุ่มลดแบบกรอกเองยังไม่มี** — สูตรใน `calculateBill()` รองรับแต่ไม่มีทางเข้าจากหน้าจอ
- **`TableSession` เก็บแค่ "ใครกิน" ไม่เก็บ "ลดกี่บาท"** — อัตราอ่านจาก
  `Branch.staffMealDiscountBp` สดตอนคิดบิล แล้ว snapshot ลง `Payment` ตอนปิดบิล
  **วงจรเดียวกับเซอร์วิสชาร์จ/VAT เป๊ะ ๆ ไม่สร้างกติกาที่สาม**
  → ผลที่ตั้งใจ: **ลูกค้าสั่งเพิ่มแล้วส่วนลดขยับตามเอง** (มีเคสทดสอบตรึงไว้)
- **`Payment.discountBp` ต้องมีคู่กับ `discountAmount`** ไม่งั้นใบเสร็จย้อนหลัง
  พิมพ์คำว่า "10%" ไม่ได้ · **`Payment.staffCustomerId`** คือหลักฐานถาวรหลังรอบโต๊ะปิด
  และเป็นฐานของรายงาน "ส่วนลดพนักงานรายคน" ในบทที่ 15
- **แยก "คนกิน" ออกจาก "คนกด"** — แคชเชียร์คิดเงินให้พ่อครัวเป็นเคสปกติ
- **ทุกตำแหน่งกดติดธงได้** (`canSetStaffMeal` = ทุกคนที่เข้าจอ admin ได้) ต่างจาก
  สิทธิ์อื่นเกือบทั้งหมด — ตัวคุมไม่ใช่การจำกัดสิทธิ์ แต่คือ **ชื่อคนกินที่ติดอยู่ถาวร**
  บวกกฎ "หนึ่งคน หนึ่งบิลที่เปิดอยู่" และ AuditLog ทุกครั้ง **รวมตอนปลดธง**
  (รูปแบบโกงคือ ติดธง → รับเงินตามยอดที่ลด → ปลดธง — บันทึกเฉพาะตอนติดจะมองไม่เห็นเลย)
- **`canReadAuditLog` = OWNER/MANAGER** เท่านั้น (log เผยทุกการกระทำของทุกคน)
- **`lib/audit-log.ts` ห้ามซ่อนแถวที่ไม่รู้จักเด็ดขาด** — action ที่ไม่มีป้ายไทยคืนชื่อดิบ ·
  คีย์ที่ไม่มีป้ายแสดงด้วยชื่อคีย์ดิบ · `metadata` เป็น null/array/string ต้องไม่พัง
  เพราะแถวที่หายจากหน้าจอเพราะโค้ดยังไม่รู้จัก action **แย่กว่าแถวที่อ่านยาก**
  (คนสืบสวนจะสรุปว่าไม่มีเหตุการณ์นั้น ซึ่งผิด) · รายการ action ในกล่องกรองมาจาก
  `groupBy` ของจริงในฐาน ไม่ได้ hardcode
- **`lib/server/client-ip.ts`** เขียน `ipAddress` ที่ว่างมาตลอดแล้ว — เก็บแค่ IP
  **ไม่เก็บ user-agent** · คืน null ได้และไม่ใช่ error (สคริปต์ไม่มี request context)
  · **⚠ ก่อน deploy ต้องมี proxy ข้างหน้าเสมอ** ไม่งั้น `x-forwarded-for` ปลอมได้

**⚠ บั๊กหน้าจอสามตัวที่ผู้ใช้จับได้ ซึ่งเทสต์อัตโนมัติปล่อยผ่านทั้งสาม:**

1. **"รวมทั้งสิ้น" หายจากจอ** — วางแผงในโซน `flex-none` เดียวกับปุ่มรับเงิน
   โซนยอดเงินที่เป็น `overflow-auto` เลยถูกบีบจาก 336px เหลือ 148px
   **แก้ที่รากจริง: ย้าย "สรุปยอด" ทั้งก้อน (ค่าอาหาร/ส่วนลด/เซอร์วิสชาร์จ/VAT +
   แผงติดธงพนักงาน) ไปอยู่ใต้รายการอาหารในคอลัมน์ซ้าย** ซึ่งว่างเปล่าเกือบทั้งจอ
   และเป็นลำดับที่บิลกระดาษใช้อยู่แล้ว · แพเนลขวาเหลือเฉพาะ **คำเตือน · รวมทั้งสิ้น ·
   แผงรับเงิน** (ปัญหานี้มีมาก่อนบทที่ 13 — ที่จอสูง 700px โซนนั้นเหลือ 121px
   แต่ต้องการ 321px · การย้ายแค่ยอดรวมยังไม่พอ รายละเอียดจะเหลือบรรทัดเดียวแทน)
   **กฎ: อะไรที่เพิ่มในโซน `flex-none` ของแพเนลที่มีโซน `overflow-auto` อยู่ด้วย
   จะไปกินพื้นที่ของโซนนั้นเสมอ**
2. **แผงควบคุมอ่านเหมือน "สถานะ"** — หัวข้อ "ส่วนลดพนักงาน 10%" อยู่ต่อจากแถว
   ค่าอาหาร/เซอร์วิสชาร์จ/VAT ซึ่งทุกแถวเป็นรูปแบบ "ป้าย … จำนวนเงิน" คนอ่านจึงเข้าใจว่า
   บิลถูกลดไปแล้ว → เปลี่ยนหัวข้อเป็น **คำถาม** ("บิลนี้พนักงานกินหรือเปล่า")
   ย้ายเปอร์เซ็นต์ไปอยู่บน **ปุ่ม** และเพิ่ม `rule` คั่น
3. **แพเนลกว้างตรึง 412px → `xl:w-1/3 xl:min-w-[412px] xl:max-w-[560px]`**
   ทั้งตะกร้าในหน้าโต๊ะและแพเนลยอดในหน้าคิดเงิน (อยู่ตำแหน่งเดียวกันบนจอ ต้องกว้างเท่ากัน)

**บทเรียนของเครื่องมือ — ครั้งที่สองในสองก้อนติด:** สคริปต์วัด overflow ถามว่า
*"เนื้อหาล้นออกนอกหน้าไหม"* ซึ่งตอบ "ไม่" ได้เสมอเมื่อ flexbox **บีบ** โซนที่เลื่อนได้
จนแบน — ไม่มีอะไรล้น แต่ตัวเลขสำคัญที่สุดหายไป · และการเทียบ `getBoundingClientRect`
กับ viewport เฉย ๆ **ตอบ "เห็นได้" แม้ element จะถูก `overflow` ของกล่องแม่ตัดทิ้ง**
ต้องเทียบกับกรอบของกล่องที่เลื่อนได้จริง

### ซื้อกลับหน้าร้าน — ชั้นข้อมูล/ตรรกะ ✅ (ไม่ใช่บทในเล่ม · ยังไม่มีหน้าจอ)

ทำเสร็จ 2026-08-24 · smoke **เก้าชุด 510 เคส FAIL 0** (เพิ่ม `takeaway` 51 เคส)
รายละเอียดเต็มที่ `report/2026-08-24-takeaway-sale-point.md`
(ต่อจากแผน `report/2026-08-23-plan-takeaway-delivery.md` — ทำข้อ 1-2 ของหัวข้อ 7)

- **`lib/sale-point.ts` = กติกาของช่องทางที่เดียวจบ** ห้ามกระจาย `kind === "DINE_IN"`
  ไว้ทั่วโค้ด (เหตุผลเดียวกับ `lib/rbac.ts`) ตอบสี่ข้อที่ผูกกับ **จุดขาย** ไม่ใช่กับบิล:
  ขึ้นผังโต๊ะไหม · เข้าร่วมบิลเดิมไหม · ต้องมีเลขคิวไหม · **คิดเซอร์วิสชาร์จไหม**
- **เคาน์เตอร์ = แถวใน `RestaurantTable` ที่ `kind = COUNTER`** ไม่ใช่ตารางใหม่ —
  สาย บิล → รับเงิน → ใบเสร็จ จึงใช้ได้ทั้งดุ้นโดยไม่ต้องแก้ (ทางเลือก B ในแผน)
- **ซื้อกลับไม่คิดเซอร์วิสชาร์จ** ผ่าน `billRatesForSalePoint()` ซึ่ง **ทั้ง
  `getTableBill()` และ `takePayment()` ต้องเรียกตัวเดียวกัน** ห้ามหยิบ
  `branch.serviceChargeBp` ไปใช้ตรง ๆ อีก (สองที่ไม่ตรงกัน = `expectedTotal`
  ไม่ผ่าน แล้วปิดบิลไม่ได้ทั้งวัน)
  · ⚠ วันที่อยากเก็บกับซื้อกลับ **ห้ามแก้ `chargesServiceCharge()` ให้คืน true**
  ต้องเพิ่มคอลัมน์ที่ `Branch` ไม่งั้นทุกสาขาทุก tenant เปลี่ยนตามพร้อมกัน
- **`Order.type` เลิกฮาร์ดโค้ด `"DINE_IN"` แล้ว** อ่านจาก `kind` ของจุดขายผ่าน
  `ORDER_TYPE_FOR_SALE_POINT` — **ห้ามให้หน้าจอส่งค่านี้มา** เพราะมันคือตัวชี้ว่า
  บิลนี้คิดค่าบริการหรือไม่ (รับจากหน้าจอได้ = ยิง POST ตัด 10% ทิ้งได้)
- **`lib/branch-day.ts`** — `branchDayKey()` ที่ `orderNumber` กับ `queueDay` ใช้ร่วมกัน
- **เลขคิวใช้ `max+1` ไม่ใช่ `DocumentCounter`** โดยตั้งใจ: ชนกันแล้วสิ่งที่ล้มเหลว
  คือ "การเปิดบิล" ซึ่งยังไม่มีเงินเกี่ยว (ต่างจากเลขใบกำกับภาษีที่ชนแล้ว
  **การรับเงินล้มทั้งที่ลูกค้าจ่ายแล้ว**) ความเสียหายจริงข้อเดียวคือคิวซ้ำ
  ซึ่งกันด้วย `@@unique([branchId, queueDay, queueNumber])`
- **ลูกค้าสแกน QR ของเคาน์เตอร์ไม่ได้** กันไว้ทั้ง `resolveCustomerContext()`
  และ `openTableSession()` (ตัวหลังคือเส้นทางที่เขียนจริง)

**⚠ บั๊กเรื่องเงินที่หลับอยู่ตั้งแต่บทที่ 10 แล้วก้อนนี้ปลุกให้ตื่น**

`getTableBill()` และ `takePayment()` หา session ด้วย `findFirst(... orderBy openedAt desc)`
= สมมติฐาน **"หนึ่งจุดขาย = หนึ่งบิลที่เปิดอยู่"** ที่ไม่เคยถูกเขียนเป็นตัวหนังสือ
(ฝังอยู่ในรูปแบบ query ไม่ใช่ใน comment จึงอ่านหาไม่เจอ ต้องให้เทสต์ชนเอง)
พอเคาน์เตอร์เปิดหลายบิลพร้อมกันได้ → คิดเงินได้บิลของคนที่มาทีหลัง และ
**รับเงินจากคิว 12 แล้วไปปิดบิลของคิว 14**

แก้แล้วสองจุด — **หน้าจอเดิมของบทที่ 10-11 ไม่ต้องแก้เลย**:
- `getSessionBill(branchId, sessionId)` + แกนกลาง `buildBill()` ที่สองทางเข้าใช้ร่วมกัน
- `takePayment()` รับ `sessionId` ได้ และ **ปฏิเสธเมื่อมีบิลเปิดหลายใบแต่ไม่ระบุมา**
  (เลือก "ไม่เดา" แทน "หยิบล่าสุด") — **หน้า `/pos/counter` ต้องส่ง `sessionId` เสมอ**

**หน้าจอทำต่อในก้อนถัดไปแล้ว** (ดูหัวข้อด้านล่าง) · ไรเดอร์เลื่อนออกทั้งหมดตามที่ตกลง

### ซื้อกลับหน้าร้าน — หน้าจอ ✅ (ใช้งานได้จริงตั้งแต่เปิดบิลถึงใบเสร็จ)

ทำเสร็จ 2026-08-24 · smoke **เก้าชุด 518 เคส FAIL 0** (takeaway 51 → 59)
ทดสอบผ่าน HTTP จริงครบเส้นทางรวมการรับเงิน · รายละเอียดเต็มที่
`report/2026-08-24-takeaway-screens.md`

เส้นทางใหม่: `/pos/counter` (แถบคิว) → `/pos/counter/[sessionId]` →
`.../menu/[itemId]` · `.../bill` — **ชี้ด้วย `sessionId` ไม่ใช่ `tableId`**

- **⚠ สมมติฐาน "หนึ่งจุดขาย = หนึ่งบิลที่เปิดอยู่" อยู่ในทุก action ไม่ใช่แค่สองจุด**
  `resolveOpenSession(branchId, tableId)` เดิมหา "รอบล่าสุดของโต๊ะ" ให้ทุกฟังก์ชัน
  ที่แก้ของในบิล (ใส่ตะกร้า · เพิ่ม/ลด · ส่งเข้าครัว · ติด/ปลดธงส่วนลด)
  → แก้เป็น `resolveOpenTarget(branchId, tableId, sessionId?)` ที่
  **ปฏิเสธเมื่อมีบิลเปิดหลายใบแต่ไม่ระบุมา** (ท่าเดียวกับ `takePayment()` ไม่สร้างกติกาที่สอง)
  · `sessionId` จากฟอร์ม **เชื่อทันทีไม่ได้** ต้องตรวจว่าเป็นรอบที่เปิดอยู่ในสาขานั้นจริง
  · **โต๊ะนั่งไม่ต้องส่งอะไรเพิ่ม หน้าจอเดิมของบทที่ 9-13 ไม่ต้องแก้เลย**
- **`salePointBase()` คำนวณ redirect จาก `kind` ไม่ใช่รับ `base` จากฟอร์ม**
  — base ที่ฟอร์มส่งมาผิดได้ (ก๊อปฟอร์มไปวางแล้วลืมแก้) แล้วพนักงานถูกพากลับผิดบิล
- **`sale-point-screen.tsx` / `bill-screen.tsx` = จอที่สองเส้นทางใช้ร่วมกันจริง ๆ**
  page เหลือแค่ "หาบิล → ส่งให้จอกลาง" ต่างกันแค่ `base`/`heading`/`sessionId`
  **ห้ามก๊อปเป็นจอชุดที่สองเด็ดขาด** (ท่าเดียวกับ `receipt-document.tsx` บทที่ 12)
- **ทางเข้า**: แถบซื้อกลับบน `/pos` วางไว้**เหนือ**ผังโต๊ะ (ลูกค้าซื้อกลับยืนรออยู่จริง
  โต๊ะนั่งรอได้) · แถบข้าง**ไม่เพิ่มโมดูล 07** ให้โมดูล 01 ครอบ `/pos/counter` ด้วย
- **"ต้องรีบ" ที่เคาน์เตอร์ = ของเสร็จแล้วลูกค้ายังไม่ได้รับ** ต่างจากผังโต๊ะที่แปลว่า
  "ต้องไปยกเสิร์ฟ" — ที่เคาน์เตอร์ไม่มีใครยกไปให้
- **หน้าสรุปหลังจ่ายของซื้อกลับต้องกลับไปแถบคิว ไม่ใช่บิลใบเดิม** (บิลปิดแล้ว = 404)
  · `getPayment()` ดึง `kind` + `queueNumber` มาด้วยเพื่อเขียนหัวเรื่องให้ถูกช่องทาง
  (ไม่งั้นขึ้นว่า "โต๊ะ เคาน์เตอร์ซื้อกลับ")

**ยืนยันด้วยเลขจริง:** ของชุดเดียวกันเป๊ะ — ซื้อกลับจ่าย ฿120.00 (VAT ถอด ฿7.85)
· โต๊ะนั่งจ่าย ฿132.00

**ยังไม่ได้ทำ:** ไรเดอร์ทั้งหมด
(ป้าย "ซื้อกลับ คิว 12" บนตั๋วครัว · ฟอร์มชื่อลูกค้า · การวัด responsive
ทำครบแล้วในสองก้อนถัดไปด้านล่าง)

### ตั๋วครัว/ใบเสร็จเรียกบิลด้วยเลขคิว + ครัวเห็นบิลที่จ่ายแล้ว ✅

ทำเสร็จ 2026-08-24 · smoke **เก้าชุด 534 เคส FAIL 0** (takeaway 59 → 75)
ตรวจ HTML ที่ออกจากเซิร์ฟเวอร์จริง (`build` + `start -- -p 3002`) ครบทุกหน้าที่แตะ
รายละเอียดเต็มที่ `report/2026-08-24-kds-sale-point-label.md`

- **`salePointDisplayName(table, session)` = ชื่อที่ใช้เรียกบิลใบหนึ่ง ที่เดียวทั้งระบบ**
  โต๊ะนั่ง → `โต๊ะ A2` · ที่เหลือ → `ซื้อกลับ คิว 12` (ไม่มีเลขคิวจึงตกไปใช้ชื่อจุดขาย)
  **ห้ามเขียน `โต๊ะ {table.name}` ตรง ๆ ที่ไหนอีก** — ตัดสินที่ `kind` ไม่ใช่ที่ว่ามีเลขคิวไหม
  · คู่กับ `salePointFieldLabel(kind)` สำหรับที่ที่ต้องแยกป้ายกับค่า (`<dt>`/`<dd>`)
- **`salePointBasePath(table, session)` = ที่เดียวที่ตัดสินว่าบิลอยู่ URL ตระกูลไหน**
  (โต๊ะชี้ด้วย tableId · ช่องทางอื่นชี้ด้วย sessionId) — เดิมกฎนี้ติดอยู่ในไฟล์
  `"use server"` ที่ export ออกมาไม่ได้ หน้าใบเสร็จจึงเขียนเส้นทางเองแล้วพาพนักงาน
  ไปตระกูลผิด **ซึ่งเปิดได้ 200 เหมือนกัน จึงเป็นบั๊กที่เงียบสนิท**
- **⚠ `getKitchenTickets()` ห้ามกรองด้วยสถานะ *บิล* อีก** — บิลเป็น `PAID` ทันที
  ที่รับเงิน ตั๋วจึงหลุดจากจอครัวทั้งที่ของยังไม่ได้ทำ **พังหนักสุดที่เคาน์เตอร์ซื้อกลับ
  ที่ลูกค้าจ่ายก่อนแล้วยืนรอ** (จ่ายแล้วแต่ครัวไม่เคยเห็นออร์เดอร์) ตอนนี้กรองแค่
  `notIn (DRAFT, CANCELLED)` — **งานครัวจบที่ระดับ "รายการ" เสมอ ไม่ใช่ที่ระดับ "บิล"**
- **จอที่หลุดสามจุด เจอเพราะไปอ่าน HTML ของจอจริง ไม่ใช่เพราะเทสต์:** หัวจอหน้า
  ใบเสร็จทั้งสองจอ · ลิสต์ใบเสร็จหลังร้านที่เติม "โต๊ะ" ซ้ำจนได้ "โต๊ะ โต๊ะ A1" ·
  ปุ่มกลับที่พาไปผิดตระกูล URL — **ครั้งที่สามแล้วที่เทสต์เขียวทั้งที่จอผิด**
- **ช่องค้นหาในลิสต์ใบเสร็จค้นด้วยเลขคิวได้แล้ว** (2026-08-24) พิมพ์ "คิว 12" หรือ "12" ก็ได้

### เก็บงานค้างของซื้อกลับ: ชื่อลูกค้า · ค้นด้วยเลขคิว · วัดจอจริง ✅

ทำเสร็จ 2026-08-24 · smoke **เก้าชุด 544 เคส FAIL 0** (takeaway 75 → 85)
วัดจอจริง **40/40** (8 หน้า × 5 ขนาด) · รายละเอียดที่ `report/2026-08-24-takeaway-loose-ends.md`

- **`setSessionCustomerName()`** — ตั้งชื่อลูกค้าได้เฉพาะรอบที่ยังเปิดอยู่ · ค่าว่าง =
  ล้างเป็น `null` ไม่ใช่สตริงว่าง · **โต๊ะนั่งตั้งไม่ได้** (ชื่อโต๊ะทำหน้าที่นี้แล้ว)
  · ไม่เขียน AuditLog เพราะไม่แตะเงิน · **ฟอร์มอยู่ในแท็บ "บิลที่ส่งแล้ว" ซึ่งเป็นโซน
  ที่เลื่อนได้** ไม่ใช่ในตะกร้า/หัวจอที่เป็น `flex-none` (กฎเดิมจากบั๊ก "รวมทั้งสิ้นหายจากจอ")
- **⚠ เครื่องมือใหม่: `npm run audit:screens`** (`scripts/audit-screens.mjs`)
  ขับ Chrome ผ่าน CDP ด้วย WebSocket ของ Node เอง ไม่ต้องลง puppeteer
  รับหน้า/คุกกี้ผ่าน env `AUDIT_PAGES` / `AUDIT_COOKIES` / `AUDIT_ORIGIN`
  **ต้องวัดกับ `npm run build` + `npm run start` เท่านั้น ไม่ใช่ dev server**
  วัดสี่อย่าง: ล้นแนวนอน · **ล้นแนวตั้ง** · **ของที่ต้องเห็นถูกกล่องแม่ตัดทิ้งไหม
  (เทียบกับกรอบกล่องที่เลื่อนได้ ไม่ใช่ viewport)** · **โซน overflow-auto ที่ถูกบีบจนแบน**
  — สามอย่างหลังคือบั๊กสามครั้งที่สคริปต์รุ่นเก่าปล่อยผ่านมาแล้ว
  · ⚠ ต้องเตรียมข้อมูลให้หน้ามีของจริงก่อนวัด ไม่งั้นจะได้ FAIL ที่ไม่ใช่บั๊กจอ
- **ของที่วัดเจอจริง:** ข้อความบอกใบ้บนแถบแท็บตัดบรรทัดเป็น 119px ในแถบสูง 56px
  ที่จอ 390px → ใส่ `whitespace-nowrap` · **ทุกอย่างในแถบสูงตายตัวต้อง nowrap เสมอ**

### บทที่ 13b — session ยกเลิกได้ทันที · ตัวนับ PIN ผิดใน DB · จัดการพนักงาน ✅

ทำเสร็จ 2026-08-24 · smoke **สิบเอ็ดชุด 624 เคส FAIL 0** (เพิ่ม `staff-session` 35 · `staff-admin` 45)
ปลดล็อก spec §12 §13 §26 · รายละเอียดเต็มที่ `report/2026-08-24-chapter-13b-staff-session.md`

เส้นทางใหม่: `/admin/staff` → `/admin/staff/[staffId]` (`new` = เพิ่มคนใหม่)

- **cookie เก็บแค่ `jti` = id ของแถวใน `StaffSession`** ลายเซ็น HMAC ยังกันปลอมเหมือนเดิม
  แต่ **คำตอบว่า "ยังใช้ได้ไหม" มาจาก DB ทุก request** → เตะออกทุกเครื่องได้ทันที ·
  รีเซ็ต PIN แล้วใบเก่าตายทันที · ปิดบัญชีแล้วออกทันที
  · **cookie เก่าที่ไม่มี `jti` ใช้ไม่ได้ทั้งหมด ทุกคนต้องใส่ PIN ใหม่หนึ่งครั้ง**
  (ตั้งใจไม่ทำ fallback — fallback = ยังมีทางเข้าที่ยกเลิกไม่ได้ค้างอยู่)
- **`loadActiveStaffSession()` = ที่เดียวที่รวมเงื่อนไข "ยังใช้ได้ไหม" ครบชุด**
  (ยังไม่ revoke · ยังไม่หมดอายุ · เป็นของจอนี้ · บัญชียัง active)
  **ห้ามกระจายเงื่อนไขไปเขียนซ้ำที่อื่น** ที่ที่ลืมไปข้อหนึ่ง = ประตูหลังที่เปิดค้าง
- **แยกสามไฟล์เพราะ `cookies()` ทำให้ทดสอบไม่ได้** — `staff-session.ts` (แตะ cookie) ·
  `staff-session-store.ts` + `staff-login-throttle.ts` (ไม่แตะ เรียกจาก smoke ได้ตรง ๆ)
  ท่าเดียวกับ `receipt-issue.ts` ของบทที่ 12
- **`StaffLoginThrottle` แทน Map ใน memory** — 5 ครั้ง/ล็อก 5 นาที · หน้าต่างนับ 30 นาที
  · **ตรวจล็อกก่อนตรวจ PIN เสมอ** · ผูกกับ (สาขา, รหัสที่พิมพ์) จึงไม่ครอบการไล่สุ่ม
  *รหัสพนักงาน* ซึ่งต้องกันที่ rate limit ระดับ IP ชั้น proxy (คนละงาน ยังไม่ทำ)
- **เพิ่ม action `staff.login`** (เข้าสำเร็จ) — เดิม log มีแต่ครั้งที่ผิด ซึ่งตอบคำถาม
  "ตอนบิลนั้นถูกยกเลิก ใครล็อกอินอยู่บ้าง" ไม่ได้เลย
- **`canAssignRole()` — แก้ได้เฉพาะตำแหน่งที่ต่ำกว่าตัวเอง** ถ้าผู้จัดการตั้งบัญชี OWNER ได้
  สิทธิ์ทั้งระบบไม่มีความหมาย เพราะข้ามได้ในสองคลิก · **ห้ามแก้บัญชีตัวเองจากหน้านี้**
  (แต่กด "เตะออกทุกเครื่อง" ของตัวเองได้ เพราะเป็นสิ่งที่คนกดตั้งใจจริง)
- **รีเซ็ต PIN / ปิดบัญชี = เตะทุกเครื่องทันที** และหน้าจอบอก **จำนวนเครื่องที่หลุด**
  ไม่ใช่แค่ "สำเร็จ" · **ห้ามเก็บ PIN หรือ hash ลง AuditLog เด็ดขาด** (มีเคสตรึงไว้)
  · **ไม่มีปุ่มลบพนักงาน** ใช้ปิดใช้งานแทน (หลักการเดียวกับเมนูที่เคยถูกสั่ง)
- **⚠ `npm run dev:staff-cookie <รหัส> [pos|kds|admin]` ใช้ได้จอเดียวต่อหนึ่ง token แล้ว**
  และสร้างแถว session จริง (ปลอม token ไม่ได้อีกต่อไป) · มันปิดใบเก่า **ที่ไม่มี IP**
  ของตัวเองก่อนออกใบใหม่ เพื่อไม่ให้หน้า /admin/staff ขึ้นเครื่องค้างจากเครื่องมือ dev
  — ใบที่ล็อกอินจริงจากเบราว์เซอร์มี IP จึงไม่ถูกแตะ
- **⚠ `lib/order-number.ts` — เลขบิลที่ "คนอ่าน" ไม่ใช่เลขที่ฐานเก็บ**
  ฐานเก็บ `YYYYMMDD-NNNN` (กันซ้ำข้ามวัน + ใช้ทำรายงาน) แต่ **ทุกจอต้องแสดงผ่าน
  `dailyOrderNumber()`** ซึ่งตัดวันกับศูนย์นำหน้าออกเหลือ `#7` — ห้ามพิมพ์ค่าดิบ
  ลงจออีก (มีเทสต์ตรึง 10 เคสใน `smoke:order`) · เลขนี้ **เริ่มที่ 1 ใหม่ทุกวัน**
  ตามเวลาของสาขาโดยตั้งใจ — **คนละเรื่องกับ `Receipt.number` ที่ห้ามรีเซ็ตตลอดกาล**
- **ด่าน "ต้องเหลือเจ้าของร้านหนึ่งคน" ยังเรียกไม่ถึง** เพราะด่าน "ห้ามแก้บัญชีตัวเอง"
  ปฏิเสธก่อนเสมอ — เก็บไว้เป็นตาข่ายรองรับพร้อมคอมเมนต์ **ห้ามลบเพราะไม่มีเทสต์ครอบ**
  และเทสต์เขียนชื่อบอกตรง ๆ ว่าด่านไหนปฏิเสธ ไม่ให้เขียวค้างในวันที่ด่านแรกถูกถอด

### หน้าตั้งค่าร้าน — ภาษี · ข้อมูลบนใบเสร็จ · สถานีครัว ✅ (spec §22 §23 §24)

ทำเสร็จ 2026-08-24 · smoke **สิบสองชุด 674 เคส FAIL 0** (เพิ่ม `settings` 40)
วัดจอ **20/20** · รายละเอียดเต็มที่ `report/2026-08-24-settings.md`

เส้นทางใหม่: `/admin/settings`

- **สองระดับสิทธิ์** — `canEditSettings` (OWNER/MANAGER) = ข้อมูลร้าน/สถานีครัว ·
  **`canEditTaxSettings` (OWNER เท่านั้น)** = VAT · เซอร์วิสชาร์จ · ส่วนลดพนักงาน ·
  `pricesIncludeVat` · สกุลเงิน — ห้าตัวนี้เปลี่ยนยอดที่ลูกค้าจ่าย และ
  `settings.tax_update` อยู่ใน `AUDIT_SENSITIVE_ACTIONS` แล้ว
  · **แผงที่กดไม่ได้ยังแสดงค่าปัจจุบัน ไม่ซ่อนทั้งแผง** (ผู้จัดการต้องตอบลูกค้าได้)
- **⚠ เปลี่ยนสกุลเงินไม่ได้ถ้าสาขาเคยรับเงินแล้ว** — ยอดทุกคอลัมน์เป็นหน่วยย่อยของ
  สกุลเดิม สลับแล้ว 6000 ที่เคยเป็น ฿60.00 กลายเป็น ₭6,000 ทั้งประวัติ
- **แก้อัตราแล้วบิลที่ปิดแล้วต้องไม่ขยับ** — มีเทสต์ยืนยันด้วยเลขจริง (บิลเก่า ฿132.00
  คงเดิมหลังขึ้น VAT/เซอร์วิสชาร์จ ส่วนบิลใหม่ของชุดเดียวกันเป็น ฿144.00)
- **ช่องกรอกเป็น % แต่เก็บเป็น bp** — `percentToBp()` แยกสตริงที่จุดทศนิยมเอง
  **ห้ามคูณ 100 แบบ float** (เหตุผลเดียวกับ `parseMoneyInput()`)
- **`Branch.receiptFooter` + `Receipt.sellerFooter`** (migration `20260824122147`)
  ข้อความท้ายใบตั้งเองได้ และ **snapshot ลงใบ** เหมือน sellerName/sellerAddress
  · null = ใช้ข้อความเริ่มต้น · **คำเตือน "ระบบสาธิต" ยังฮาร์ดโค้ด แก้ไม่ได้โดยตั้งใจ**
- **ลบสถานีครัวได้เฉพาะตัวที่ไม่เคยถูกใช้** (นับ OrderItem/MenuItem ก่อน) ที่เหลือปิดใช้งาน
- **⚠ แถบล่างของจอหลังร้านมีหกโมดูลแล้ว** — ป้ายบนแถบล่างใช้ฟิลด์ `short` แยกจาก
  ป้ายเต็มของแถบซ้าย เพราะที่ 390px เหลือช่องละ ~55px **เพิ่มโมดูลที่เจ็ดต้องคิดใหม่**
- **⚠ `npm run audit:screens` เคยรายงานผิด** — มันหยิบ element ตัวแรกที่มีข้อความนั้น
  ซึ่งคือลิงก์ในแถบซ้ายที่ถูกซ่อนบนจอแคบ แก้เป็น "มองเห็นได้ที่ไหนสักที่ไหม" แล้ว

### หน้าแรกหลังร้าน — สรุปวันนี้ ✅ (spec §1)

ทำเสร็จ 2026-08-24 · smoke **สิบสามชุด 705 เคส FAIL 0** (เพิ่ม `dashboard` 31)
วัดจอ 5/5 · รายละเอียดที่ `report/2026-08-24-admin-dashboard.md`

`/admin` เลิก redirect แล้ว — เป็นหน้าสรุปยอดขายวันนี้ + สถานะหน้าร้านตอนนี้

- **⚠ ยอดขายมาจาก `Payment` ไม่ใช่ผลรวมของ `Order`** — ยอดใน Order เป็นส่วนแบ่ง
  ที่กระจายไว้ทำรายงาน (กฎตั้งแต่บทที่ 11) ไม่ใช่เงินในลิ้นชักจริง (มีเทสต์ตรึง)
- **เมนูขายดีนับของที่ส่งเข้าครัวแล้ว ไม่ใช่ที่จ่ายเงินแล้ว** — ของที่ทำไปแล้วมีต้นทุน
  ไปแล้ว และช่วงเย็นที่ลูกค้ายังนั่งอยู่เต็มร้านจะดูเหมือนขายไม่ออกถ้านับเฉพาะบิลที่ปิด
- **`canViewDashboard` = OWNER/MANAGER · ตำแหน่งอื่นถูก redirect ไป `/admin/menu`**
  ไม่ใช่ขึ้นว่า "ไม่มีสิทธิ์" (พ่อครัวเข้ามากด "ของหมด" ต้องไปถึงที่หมายเดิม)
  · เมนู "สรุปวันนี้" ไม่ขึ้นเลยสำหรับคนที่กดแล้วจะถูกเด้งกลับ
- **`lib/server/branch-time.ts`** — ยุบสำเนา `dayRangeToUtc()` ที่เคยมีสองชุดใน
  `receipt.ts`/`audit.ts` ตามเงื่อนไขที่คอมเมนต์เดิมวางไว้ ("รอผู้ใช้รายที่สาม")
  **ยังไม่ครอบ "ช่วงกะ" ของบทที่ 15 — อย่ายัดเข้ามา** ตัวนั้นต้องอ้างเวลาเปิด/ปิดกะจริง
- สามอย่างที่จงใจไม่ใส่และ **เขียนบอกบนจอตรง ๆ**: กำไรขั้นต้น (ต้องมี cost price) ·
  ของใกล้หมด (บทที่ 14) · กราฟย้อนหลัง (บทที่ 15)

### ย้ายโต๊ะ / รวมโต๊ะ ✅ (งานค้างจากบทที่ 9)

ทำเสร็จ 2026-08-25 · smoke **สิบสี่ชุด 768 เคส FAIL 0** (เพิ่ม `table-move` 63)
วัดจอ 30/30 · รายละเอียดเต็มที่ `report/2026-08-25-table-move-merge.md`

แผง "ย้ายโต๊ะ / รวมบิลกับโต๊ะอื่น" อยู่ในแท็บ **บิลที่ส่งแล้ว** ของหน้าโต๊ะ
(โซนที่เลื่อนได้ ไม่ใช่ `flex-none`) · โต๊ะนั่งเท่านั้น · `canMoveTableSession` = ทุกคนที่เข้าจอ POS ได้

- **`lib/server/table-move.ts` เป็น leaf module ห้าม import กลับ** (ท่าเดียวกับ
  `receipt-issue.ts`) · **`loadMovableSession()` = ด่าน "รอบนี้ขยับได้ไหม" ที่เดียว**
  (สาขาเดียวกัน · OPEN · ไม่มี Payment · ไม่ติดธงส่วนลดพนักงาน · `kind === DINE_IN`)
  ทั้งย้ายและรวมเรียกตัวนี้ **ห้ามก๊อปเงื่อนไขไปเขียนซ้ำ**
- **⚠ ค่า `MERGED` มีอยู่ในระบบแล้ว** — query ที่ถามสถานะรอบต้องคิดถึงมันเสมอ
  `status: "OPEN"` ยังปลอดภัย แต่ `status: { not: "CLOSED" }` ไม่ใช่แล้ว
- **สองฟังก์ชัน ไม่ใช่ตัวเดียวที่เดาจากว่าปลายทางว่างไหม** — ย้ายผิดโต๊ะย้ายกลับได้
  แต่ **รวมผิดโต๊ะแยกกลับไม่ได้** ปุ่มรวมจึงมีขั้นยืนยันที่บอกยอดของทั้งสองบิล
- **⚠ รวมสองโต๊ะที่ต่างก็มีตะกร้าค้าง = ตะกร้าสองใบในรอบเดียว** และ `getCart()`
  เป็น `findFirst` → ใบหนึ่งจะ **ไม่มีใครเห็นแต่ยังบล็อกการคิดเงิน** (กฎบทที่ 11)
  → `foldDraftCarts()` ยุบเหลือใบเดียวเสมอ · ลบใบเปล่าทิ้งได้เพราะตะกร้าที่ยังไม่กดส่ง
  ไม่ใช่ประวัติ (ต่างจาก `CANCELLED`)
- **⚠ `resolveSessionByToken()` เลิกผูก `tableId` แล้ว** และเดินตาม
  `mergedIntoSessionId` (ลึกสุด 5 ชั้น) — เดิมลูกค้าที่ถือ cookie ใบเดิมจะได้
  "ไม่มีรอบ" ทันทีที่พนักงานย้ายโต๊ะ แล้วเปิด **บิลใบที่สองที่พนักงานไม่รู้ตัว**
  · cookie ใบหนึ่งจึงใช้ได้กับหน้าโต๊ะไหนก็ได้ **ในสาขาเดียวกัน** และหน้าเมนู
  **ต้องขึ้นแถบบอกว่าของเข้าบิลไหน ห้ามสลับชื่อโต๊ะเงียบ ๆ**
- **ทุกที่ที่สร้างออร์เดอร์ต้องใช้ `session.tableId` ไม่ใช่โต๊ะที่สแกน QR มา**
  ไม่งั้นตั๋วครัว/ใบเสร็จเรียกชื่อโต๊ะผิดหลังย้าย
- **`pax` บวกกันตอนรวม** — เป็นตัวหารของรายงานยอดต่อหัวบทที่ 15
- **AuditLog `table_session.move` / `table_session.merge`** เก็บยอดทั้งสองก้อน
  (`movedAmount` + `targetAmountBefore`) ถึงจะตอบได้ว่า *เงินก้อนไหนรวมกับก้อนไหน*
- **ชั้นคิดเงิน/รับเงิน/ใบเสร็จ/KDS ไม่ถูกแก้เลย** — smoke รับเงินบิลที่ผ่านการรวม
  จนออกใบเสร็จเพื่อพิสูจน์ข้อนี้ด้วยของจริง

**⚠ `npm run audit:screens` เพิ่มสามอย่าง** (`openDetails` กาง `<details>` ก่อนวัด ·
ตัวหาข้อความหา element ที่ลึกที่สุดแทนใบที่ไม่มีลูก จึงไม่ไปวัด `<script>` ของ RSC ·
`scrolls: true` สำหรับหน้าจอลูกค้าที่ตั้งใจให้ทั้งหน้าเลื่อนได้ — **ห้ามใส่ให้หน้าในเชลล์ POS**)

## 7. ขั้นถัดไป

ทำต่อทีละก้อน อย่าสั่งรวดเดียวหลายบท (context จะเต็มแล้วเริ่มหลุดกฎที่ตั้งไว้ด้านบน)

**⚠ ผู้ใช้ส่งรายการฟังก์ชันหลังร้านฉบับเต็มมาแล้ว (13 หมวด ~90 ฟังก์ชัน)**
ตารางเทียบ "ของที่มี / รอหน้าจอ / ยังไม่มีเลย" + ลำดับที่แนะนำอยู่ที่
`report/2026-08-22-admin-roadmap.md` — **อ่านไฟล์นั้นก่อนตัดสินใจว่าจะทำก้อนไหนต่อ**
สรุปสั้น: ✅ ~15 · 🟡 มีข้อมูลแล้วรอหน้าจอ ~20 · ❌ ~55
และมีสี่โมดูลที่ **ไม่มีในแผนของ e-book เลย** (Customers · Promotions · Delivery · Expenses)

**⚠ ผู้ใช้ส่ง `POS_Admin_Back_Office_Specification.md` (31 หัวข้อ) มาเพิ่มเมื่อ 2026-08-23**
ย้ายไปอยู่ที่ `docs/admin/` แล้ว พร้อมตารางเทียบทีละหัวข้อกับของที่มีจริงที่
`docs/admin/spec-vs-current.md` — **อ่านไฟล์นั้นคู่กับ roadmap ก่อนเลือกก้อนถัดไป**
ในนั้นมีสองข้อที่ **ตั้งใจไม่ทำตาม spec** พร้อมเหตุผล (ไม่ย้าย RBAC ไปเป็น
permission string · ไม่เปลี่ยนชื่อสถานะออร์เดอร์)

**ก้อนถัดไป = บทที่ 15 รายงาน/ปิดกะ** (X report · ปิดกะนับเงินสดจริง · Z report)
ตาราง `Shift` ลง DB ไปแล้วตอนก้อนย้ายโต๊ะ (migration `71d1654`) แต่ยังไม่มีใครใช้
· `lib/server/branch-time.ts` มี `dayRangeToUtc()` อยู่แล้ว **แต่ยังไม่ครอบ "ช่วงกะ"
— อย่ายัดเข้ามา** ตัวนั้นต้องอ้างเวลาเปิด/ปิดกะจริง

**หลังจากนั้น:** แยกบิล (งานค้างข้อสุดท้ายของบทที่ 9) → บทที่ 14 สต็อก → Refund
→ ปุ่มส่วนลดแบบกรอกเอง (สูตร/คอลัมน์/บรรทัดบนใบเสร็จพร้อมหมดแล้ว เหลือแค่ปุ่ม
ซึ่งต้องมาพร้อมจำกัดตามตำแหน่ง + บังคับเหตุผล + `AuditLog` เสมอ)

action ที่เขียน log แล้วตอนนี้: `payment.take` · `order_item.cancel` ·
`table_session.abandon` · **`table_session.move`** · **`table_session.merge`** ·
`staff.login` · `staff.login_failed` · `staff.*` · `menu.*` · `settings.*` · `receipt.print`

**หมายเหตุเผื่อวันที่ทำ payment จริง:** PromptPay เป็นของไทยเท่านั้น สาขา LAK/VND
ต้องใช้ช่องทางอื่น (ลาว: LAO QR ของ BCEL One · เวียดนาม: VietQR ของ NAPAS
เป็น EMVCo เหมือนกันแต่คนละ tag/ผู้ให้บริการ) — ให้ "วิธีรับเงิน" ผูกกับ
สกุลเงิน/ประเทศของสาขา ไม่ใช่ hardcode PromptPay

**งานค้างที่ต้องเก็บก่อน deploy** (สะสมจากบทที่ 8-9):

- ตั้ง `REALTIME_DRIVER=postgres` ถ้า deploy หลาย instance
- ~~ตัวนับ PIN ผิดอยู่ใน memory~~ · ~~ยกเลิก session ทันทีไม่ได้~~ → ทำแล้วในบทที่ 13b
- rate limit ระดับ IP ที่ชั้น proxy (กันไล่สุ่ม *รหัสพนักงาน* — `StaffLoginThrottle`
  ผูกกับคู่ (สาขา, รหัสที่พิมพ์) จึงไม่ครอบเคสนี้)
- **แยกบิล** ยังไม่ได้ทำ (ค้างจากบทที่ 9 — ย้าย/รวมโต๊ะทำเสร็จแล้ว 2026-08-25)
- `next.config.ts` → `images.remotePatterns` ยังกว้าง ต้องแคบก่อน deploy (บทที่ 16)

@AGENTS.md
