import "dotenv/config";

import { createHmac } from "node:crypto";

import { STAFF_SESSION_COOKIE } from "@/lib/staff-session-cookie";
import { prisma } from "@/lib/server/db";

/**
 * ออก cookie ของพนักงานไว้ทดสอบหน้า POS ด้วย curl โดยไม่ต้องกดผ่านเบราว์เซอร์
 * (คู่กับ `npm run dev:session` ที่ทำแบบเดียวกันให้ฝั่งลูกค้า)
 *
 *     npm run dev:staff-cookie 001
 *     curl -H "Cookie: pos_staff_session=<token>" http://localhost:3000/pos
 *
 * ตั้งใจให้เป็นเครื่องมือ dev เท่านั้น — มันข้ามการตรวจ PIN ทั้งหมด
 * จึงเช็ค NODE_ENV ก่อน และตัวลายเซ็นยังต้องตรงกับ AUTH_SECRET ของเครื่องนั้นอยู่ดี
 *
 * ต้องประกอบ token ซ้ำที่นี่แทนการเรียก loginStaff() เพราะฟังก์ชันนั้นเขียน cookie
 * ผ่าน `cookies()` ของ next/headers ซึ่งใช้นอก request context ของ Next.js ไม่ได้
 * ถ้าแก้รูปแบบ token ใน lib/server/staff-session.ts ต้องแก้ที่นี่ตามด้วย
 */
const SESSION_TTL_HOURS = 8;

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("สคริปต์นี้ใช้ได้เฉพาะเครื่อง dev");
  }

  const secret = process.env.AUTH_SECRET;

  if (!secret || secret.length < 32) {
    throw new Error("ไม่พบ AUTH_SECRET (หรือสั้นเกินไป) — ดู .env.example");
  }

  const staffCode = process.argv[2];

  if (!staffCode) {
    const staff = await prisma.staff.findMany({
      where: { isActive: true },
      orderBy: { code: "asc" },
      select: { code: true, name: true, role: true },
    });

    console.error("ใช้: npm run dev:staff-cookie <รหัสพนักงาน>");
    console.error("พนักงานที่มีอยู่:");
    for (const row of staff) {
      console.error(`  ${row.code}  ${row.name} (${row.role})`);
    }
    process.exit(1);
  }

  const staff = await prisma.staff.findFirst({
    where: { code: staffCode, isActive: true },
    include: { branch: true },
  });

  if (!staff) {
    throw new Error(`ไม่พบพนักงานรหัส ${staffCode}`);
  }

  const exp = Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000;
  const body = Buffer.from(JSON.stringify({ sid: staff.id, bid: staff.branchId, exp })).toString(
    "base64url",
  );
  const signature = createHmac("sha256", secret).update(body).digest("base64url");

  console.error(`${staff.name} (${staff.role}) · สาขา ${staff.branch.name}`);
  console.error(`หมดอายุ ${new Date(exp).toISOString()}`);
  console.error(`curl -H "Cookie: ${STAFF_SESSION_COOKIE}=<token>" http://localhost:3000/pos`);
  console.log(`${body}.${signature}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
