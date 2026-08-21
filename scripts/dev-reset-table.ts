import "dotenv/config";

import { prisma } from "@/lib/server/db";

/**
 * เครื่องมือ dev: ล้างรอบโต๊ะ + ออร์เดอร์ทั้งหมดของโต๊ะที่ระบุ แล้วคืนสถานะโต๊ะเป็นว่าง
 *
 *   npm run dev:reset-table a1x7qk
 *
 * ใช้ตอนทดสอบหน้าจอลูกค้าซ้ำ ๆ ให้เริ่มจากโต๊ะว่างทุกครั้ง
 *
 * ⚠️ ลบข้อมูลจริงในฐานข้อมูลที่ DATABASE_URL ชี้อยู่ — สำหรับ dev DB เท่านั้น
 * ห้ามรันกับฐานข้อมูลจริงของร้านเด็ดขาด
 */
async function main() {
  const tableCode = process.argv[2];

  if (!tableCode) {
    throw new Error("ต้องระบุ tableCode เช่น: npm run dev:reset-table a1x7qk");
  }

  const table = await prisma.restaurantTable.findUniqueOrThrow({ where: { tableCode } });

  const sessions = await prisma.tableSession.findMany({ where: { tableId: table.id } });
  const sessionIds = sessions.map((session) => session.id);

  // ลบออร์เดอร์ก่อนเสมอ เพราะ TableSession → Order ตั้ง onDelete: Restrict ไว้
  const orders = await prisma.order.deleteMany({ where: { tableSessionId: { in: sessionIds } } });
  const removed = await prisma.tableSession.deleteMany({ where: { id: { in: sessionIds } } });

  await prisma.restaurantTable.update({
    where: { id: table.id },
    data: { status: "AVAILABLE" },
  });

  console.log(
    `โต๊ะ ${table.name} (${tableCode}): ลบ ${removed.count} รอบ, ${orders.count} บิล, สถานะกลับเป็น AVAILABLE`,
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
