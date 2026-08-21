import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../lib/generated/prisma/client";

/**
 * Seed ขั้นต่ำสำหรับ dev — สร้าง 1 กิจการ 1 สาขา ไว้ให้ข้อมูลในบทถัดไปมี
 * tenantId / branchId ผูกได้ตั้งแต่แถวแรก
 *
 * ใช้ upsert ทุกจุด เพื่อให้สั่ง `npm run db:seed` ซ้ำกี่รอบก็ได้ผลเหมือนเดิม
 */
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { id: "seed-tenant" },
    update: {},
    create: {
      id: "seed-tenant",
      name: "ร้านอาหารตัวอย่าง",
    },
  });

  const branch = await prisma.branch.upsert({
    where: { tenantId_code: { tenantId: tenant.id, code: "HQ" } },
    update: {},
    create: {
      tenantId: tenant.id,
      code: "HQ",
      name: "สาขาสำนักงานใหญ่",
      // 1000 basis point = เซอร์วิสชาร์จ 10.00% — เก็บเป็นจำนวนเต็ม ห้ามใช้ float
      serviceChargeBp: 1000,
      vatRateBp: 700,
      pricesIncludeVat: true,
    },
  });

  console.log(`seeded tenant=${tenant.name} branch=${branch.code} (${branch.id})`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
