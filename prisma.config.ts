import "dotenv/config";
import { defineConfig, env } from "prisma/config";

/**
 * Prisma 7 อ่านค่า datasource จากไฟล์นี้ ไม่ใช่จาก `url` ใน schema.prisma อีกแล้ว
 * และไม่โหลด .env ให้เองด้วย จึงต้อง `import "dotenv/config"` บรรทัดแรก
 *
 * DATABASE_URL ชี้ไปที่ Postgres 17 ใน docker-compose (ดู CLAUDE.md หัวข้อ 2.1)
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
