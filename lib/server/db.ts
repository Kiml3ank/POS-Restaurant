import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/lib/generated/prisma/client";

/**
 * Prisma client singleton
 *
 * ระหว่าง dev ตัว Next.js จะ hot-reload โมดูลนี้ซ้ำ ๆ ถ้า `new PrismaClient()` ตรง ๆ
 * จะเปิด connection pool ใหม่ทุกครั้งจน Postgres ปฏิเสธการเชื่อมต่อ จึงเก็บ instance
 * ไว้บน globalThis เฉพาะตอนที่ไม่ใช่ production
 *
 * Prisma 7 ต้องส่ง driver adapter เข้า constructor เสมอ (ไม่มี Rust query engine
 * เป็นค่าเริ่มต้นแล้ว) — ที่นี่ใช้ PrismaPg คุยกับ PostgreSQL ตรง ๆ
 *
 * กฎ (CLAUDE.md หัวข้อ 2 + 4):
 *   - ไฟล์ใน lib/server/ ต้องขึ้นต้นด้วย `import "server-only"` เสมอ
 *   - ห้าม import ไฟล์นี้จาก client component เด็ดขาด (build จะ fail ทันทีถ้าเผลอ)
 *   - เวลาที่แก้หลายตารางพร้อมกัน ให้ใช้ `prisma.$transaction()` จริง ๆ ไม่ใช่เรียกทีละคำสั่ง
 */
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "ไม่พบ DATABASE_URL — คัดลอก .env.example เป็น .env แล้วสั่ง `npm run db:up` ก่อน",
  );
}

function createPrismaClient() {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

const globalForPrisma = globalThis as unknown as {
  prisma: ReturnType<typeof createPrismaClient> | undefined;
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
