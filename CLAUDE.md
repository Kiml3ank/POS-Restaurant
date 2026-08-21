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

## 6. สถานะปัจจุบัน (อัปเดต 2026-08-20)

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

## 7. ขั้นถัดไป

ทำต่อทีละก้อน อย่าสั่งรวดเดียวหลายบท (context จะเต็มแล้วเริ่มหลุดกฎที่ตั้งไว้ด้านบน)

**ก้อนถัดไป = หัวข้อ 5 ข้อ 2 (บทที่ 4-5, 13):** ออกแบบ Prisma schema เต็ม —
MenuCategory / MenuItem / ModifierGroup / Modifier, Table / TableSession,
Order / OrderItem, Staff / Role โดยทุกตารางต้องมี `branchId` ตั้งแต่แถวแรก
และจำนวนเงินทุกคอลัมน์เป็น `Int` หน่วยสตางค์

@AGENTS.md
