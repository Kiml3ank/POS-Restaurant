import "dotenv/config";

import { randomBytes } from "node:crypto";

import { prisma } from "@/lib/server/db";

/**
 * เครื่องมือ dev: เปิดรอบโต๊ะให้โต๊ะที่ระบุแล้วพิมพ์ token ออกมา
 * ใช้เวลาต้องทดสอบหน้าจอลูกค้าด้วย curl/httpie โดยไม่ต้องกดผ่านเบราว์เซอร์
 *
 *   npx tsx --conditions=react-server scripts/dev-open-session.ts a1x7qk
 *
 * (ต้องมี --conditions=react-server เพราะ lib/server/* มี `import "server-only"`
 * ซึ่งจะ throw ถ้ารันนอก React Server Components)
 */
async function main() {
  const tableCode = process.argv[2] ?? "a1x7qk";

  const table = await prisma.restaurantTable.findUniqueOrThrow({
    where: { tableCode },
  });

  const session = await prisma.tableSession.create({
    data: {
      branchId: table.branchId,
      tableId: table.id,
      token: `dev-${randomBytes(12).toString("hex")}`,
      pax: 2,
      expiresAt: new Date(Date.now() + 3 * 60 * 60 * 1000),
    },
  });

  console.log(session.token);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
