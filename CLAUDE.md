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
11. **รับเงิน** — PromptPay QR (payload ตามมาตรฐาน ธปท., tag 29), บัตร, เงินสด — เตรียม abstraction รองรับ payment gateway ไทยหลายเจ้า
12. **ใบเสร็จ / ใบกำกับภาษีอย่างย่อ (ABB) / e-Tax** — ออกแบบฐานข้อมูลให้รองรับเอกสารตั้งแต่แรก (เลขที่เอกสารต่อเนื่อง, เลขผู้เสียภาษี) — **หมายเหตุ: เนื้อหาภาษีในบทนี้ไม่ใช่คำแนะนำทางกฎหมาย ต้องตรวจกับสรรพากร/ผู้สอบบัญชีก่อนใช้งานจริง**
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

## 6. สถานะปัจจุบัน (อัปเดต 2026-08-21)

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

## 7. ขั้นถัดไป

ทำต่อทีละก้อน อย่าสั่งรวดเดียวหลายบท (context จะเต็มแล้วเริ่มหลุดกฎที่ตั้งไว้ด้านบน)

**ก้อนถัดไป = บทที่ 8:** จอครัว (KDS) แบบ realtime ด้วย **SSE ผ่าน
Route Handler เท่านั้น** ห้ามเสนอ WebSocket ตรง ๆ — แยกออร์เดอร์ตาม `OrderItem.stationId`
ที่ snapshot ไว้แล้ว (ไม่ต้อง join เมนูสด และรายการที่ `stationId = null` เช่นน้ำเปล่า
**ต้องไม่ขึ้นจอครัว**), กดเปลี่ยนสถานะรายรายการโดยเช็คกับ
`canTransitionOrder`/สถานะรายการใน `lib/order-status.ts`, และวางแผนเผื่อ pub/sub กลาง
(Postgres LISTEN/NOTIFY) ไว้ตั้งแต่ต้นเพราะหลาย instance บน Vercel ไม่แชร์ memory กัน

อย่าลืมสองอย่างที่ผูกกับก้อน POS: เพิ่ม `"kds"` เข้า `StaffScreen` ใน `lib/rbac.ts`
และเพิ่ม guard ของ `/kds` ใน `proxy.ts` (ตอนนี้ `/kds` เปิดได้โดยไม่ต้องล็อกอิน)

หน้า `/t/[tableCode]/orders` ของลูกค้าและผังโต๊ะ `/pos` ตอนนี้อัปเดตด้วยการโหลดหน้าใหม่เท่านั้น
พอทำ SSE ในบทที่ 8 แล้วให้กลับมาต่อทั้งสองหน้าให้รับ event เดียวกันด้วย

@AGENTS.md
