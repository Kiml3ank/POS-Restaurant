# POS ร้านอาหาร

ระบบ POS ร้านอาหาร 4 หน้าจอบนชุดข้อมูลเดียวกัน — ดูแผนงานเต็มและกฎประจำโปรเจกต์ที่ [`CLAUDE.md`](./CLAUDE.md)

| หน้าจอ | เส้นทาง | สถานะ |
|---|---|---|
| มือถือลูกค้า (QR) | `/t/[tableCode]` | โครง — บทที่ 5-7 |
| เครื่องพนักงาน (POS) | `/pos` | โครง — บทที่ 9-12 |
| จอครัว (KDS) | `/kds` | โครง — บทที่ 8 |
| หลังร้าน (admin/report) | `/admin` | โครง — บทที่ 13-15 |

## Tech stack

Next.js 16.2 (App Router) · TypeScript · Tailwind CSS 4 · Prisma 7 · PostgreSQL 17 (docker-compose)

## เริ่มใช้งาน

ต้องมี Node.js 20+ และ Docker Desktop เปิดอยู่

```bash
cp .env.example .env      # แล้วแก้ DATABASE_URL ถ้าจำเป็น (ค่า default ตรงกับ docker-compose อยู่แล้ว)
npm install
npm run db:up             # docker compose up -d — ยก PostgreSQL 17 ขึ้นมา
npm run db:migrate        # prisma migrate dev
npm run db:seed           # สร้าง 1 กิจการ 1 สาขา ไว้ให้เริ่มงานได้
npm run dev               # http://localhost:3000
```

หน้า `/` เป็น dev index — มีทางลัดไปทั้ง 4 หน้าจอ และบอกสถานะการต่อฐานข้อมูลให้ด้วย

## คำสั่งที่ใช้บ่อย

| คำสั่ง | ทำอะไร |
|---|---|
| `npm run dev` | รัน dev server |
| `npm run build` | build production |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run db:up` / `db:down` | เปิด / ปิด Postgres container |
| `npm run db:reset` | ล้าง volume แล้วยก Postgres ขึ้นใหม่หมด (ข้อมูลหายทั้งหมด) |
| `npm run db:migrate` | สร้างและ apply migration |
| `npm run db:seed` | seed ข้อมูลตั้งต้น (สั่งซ้ำได้ ใช้ upsert) |
| `npm run db:studio` | เปิด Prisma Studio |

## โครงโฟลเดอร์

```
app/
  (customer)/t/[tableCode]/   หน้าจอลูกค้า — เข้าจากการสแกน QR
  (pos)/pos/                  เครื่องพนักงาน
  (kds)/kds/                  จอครัว
  (admin)/admin/              หลังร้าน
  page.tsx                    dev index
lib/
  server/db.ts                Prisma client singleton (`import "server-only"`)
  generated/prisma/           Prisma client ที่ generate ออกมา (ไม่ commit)
prisma/
  schema.prisma               ตอนนี้มีแค่ Tenant / Branch — ที่เหลืออยู่ในบทที่ 4-5
  seed.ts
proxy.ts                      Next.js 16.2 เรียกไฟล์นี้แทน middleware.ts เดิม
docker-compose.yml            PostgreSQL 17 สำหรับ dev
```
