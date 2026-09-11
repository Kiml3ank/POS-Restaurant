import "dotenv/config";

import { prisma } from "@/lib/server/db";
import { openOrJoinTableSession } from "@/lib/server/table-session";

/**
 * เครื่องมือ dev: เปิด (หรือเข้าร่วม) รอบโต๊ะที่ระบุแล้วพิมพ์ token ออกมา
 * ใช้เวลาต้องทดสอบหน้าจอลูกค้าด้วย curl/httpie โดยไม่ต้องกดผ่านเบราว์เซอร์
 *
 *   npx tsx --conditions=react-server scripts/dev-open-session.ts a1x7qk
 *
 * (ต้องมี --conditions=react-server เพราะ lib/server/* มี `import "server-only"`
 * ซึ่งจะ throw ถ้ารันนอก React Server Components)
 *
 * ⚠ ต้องผ่าน `openOrJoinTableSession()` เท่านั้น — รุ่นก่อน `create` รอบใหม่ตรง ๆ
 * แล้วสั่งกับโต๊ะที่มีรอบเปิดอยู่แล้ว = **สองรอบ OPEN บนโต๊ะนั่งตัวเดียว**
 * (ใบเก่ามองไม่เห็นแต่ยังบล็อกการคิดเงิน — กฎที่ CLAUDE.md บันทึกไว้) เจอจริง
 * ใน dev DB ตอนทำงาน i18n เพราะเครื่องมือตัวนี้เอง
 */
async function main() {
  const tableCode = process.argv[2] ?? "a1x7qk";

  const table = await prisma.restaurantTable.findUniqueOrThrow({
    where: { tableCode },
  });

  const session = await openOrJoinTableSession({
    tableId: table.id,
    branchId: table.branchId,
    pax: 2,
  });

  // เข้าร่วมรอบที่หมดอายุแล้ว = token ใช้เป็นลูกค้าไม่ได้ (resolveSessionByToken กรองอายุ)
  if (session.expiresAt.getTime() <= Date.now()) {
    console.error(
      `⚠ โต๊ะนี้มีรอบเปิดค้างที่หมดอายุแล้ว — token ด้านล่างใช้เป็นลูกค้าไม่ได้ · ล้างด้วย npm run dev:reset-table ${tableCode}`,
    );
  }

  console.log(session.token);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
