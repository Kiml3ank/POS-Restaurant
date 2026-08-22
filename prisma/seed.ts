import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../lib/generated/prisma/client";
import { hashPin } from "../lib/server/pin";

/**
 * Seed สำหรับ dev — 1 กิจการ 1 สาขา พร้อมเมนู/โต๊ะ/พนักงานชุดตัวอย่าง
 * ให้บทที่ 6-9 มีข้อมูลจริงให้เรนเดอร์ตั้งแต่บรรทัดแรก
 *
 * ใช้ upsert ด้วย id คงที่ทุกจุด สั่ง `npm run db:seed` ซ้ำกี่รอบก็ได้ผลเหมือนเดิม
 * ไม่ห่อ $transaction เพราะไม่ใช่ธุรกรรมทางธุรกิจที่ต้อง atomic — ถ้าพังกลางทาง
 * สั่งซ้ำได้เลย (ต่างจากการย้าย/รวมโต๊ะในบทที่ 9 ที่ต้องเป็น transaction เดียวจริง ๆ)
 */
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const STATIONS = [
  { id: "seed-station-hot", code: "HOT", name: "ครัวร้อน", sortOrder: 1 },
  { id: "seed-station-bar", code: "BAR", name: "บาร์น้ำ", sortOrder: 2 },
  { id: "seed-station-dessert", code: "DESSERT", name: "ของหวาน", sortOrder: 3 },
];

const CATEGORIES = [
  { id: "seed-cat-rice", name: "อาหารจานเดียว", sortOrder: 1 },
  { id: "seed-cat-soup", name: "ต้ม/แกง", sortOrder: 2 },
  { id: "seed-cat-drink", name: "เครื่องดื่ม", sortOrder: 3 },
  { id: "seed-cat-dessert", name: "ของหวาน", sortOrder: 4 },
];

/** ราคาทุกค่าเป็น "สตางค์" — 6000 = 60.00 บาท */
const MODIFIER_GROUPS = [
  {
    id: "seed-mg-spice",
    name: "ระดับความเผ็ด",
    required: true,
    minSelect: 1,
    maxSelect: 1,
    modifiers: [
      { id: "seed-mod-spice-none", name: "ไม่เผ็ด", priceDelta: 0 },
      { id: "seed-mod-spice-mild", name: "เผ็ดน้อย", priceDelta: 0 },
      { id: "seed-mod-spice-hot", name: "เผ็ดมาก", priceDelta: 0 },
    ],
  },
  {
    id: "seed-mg-size",
    name: "ขนาด",
    required: true,
    minSelect: 1,
    maxSelect: 1,
    modifiers: [
      { id: "seed-mod-size-regular", name: "ธรรมดา", priceDelta: 0 },
      { id: "seed-mod-size-large", name: "พิเศษ", priceDelta: 2000 },
    ],
  },
  {
    id: "seed-mg-sweetness",
    name: "ระดับความหวาน",
    required: true,
    minSelect: 1,
    maxSelect: 1,
    modifiers: [
      { id: "seed-mod-sweet-0", name: "ไม่หวาน", priceDelta: 0 },
      { id: "seed-mod-sweet-50", name: "หวานน้อย", priceDelta: 0 },
      { id: "seed-mod-sweet-100", name: "หวานปกติ", priceDelta: 0 },
    ],
  },
  {
    id: "seed-mg-topping",
    name: "ท็อปปิ้ง",
    required: false,
    minSelect: 0,
    maxSelect: 3,
    modifiers: [
      { id: "seed-mod-top-egg", name: "ไข่ดาว", priceDelta: 1500 },
      { id: "seed-mod-top-rice", name: "ข้าวเพิ่ม", priceDelta: 1000 },
      { id: "seed-mod-top-nomeat", name: "ไม่ใส่เนื้อสัตว์", priceDelta: -1000 },
    ],
  },
];

const MENU_ITEMS = [
  {
    id: "seed-item-krapao",
    categoryId: "seed-cat-rice",
    stationId: "seed-station-hot",
    name: "ข้าวผัดกะเพราหมูสับ",
    description: "กะเพราใบใหญ่ ผัดไฟแรง เสิร์ฟพร้อมข้าวสวย",
    basePrice: 6000,
    sortOrder: 1,
    groupIds: ["seed-mg-spice", "seed-mg-size", "seed-mg-topping"],
  },
  {
    id: "seed-item-fried-rice",
    categoryId: "seed-cat-rice",
    stationId: "seed-station-hot",
    name: "ข้าวผัดปู",
    description: "เนื้อปูก้อน ไข่สด",
    basePrice: 12000,
    sortOrder: 2,
    groupIds: ["seed-mg-size", "seed-mg-topping"],
  },
  {
    id: "seed-item-tomyum",
    categoryId: "seed-cat-soup",
    stationId: "seed-station-hot",
    name: "ต้มยำกุ้งน้ำข้น",
    description: "กุ้งแม่น้ำ เห็ดฟาง",
    basePrice: 18000,
    sortOrder: 1,
    groupIds: ["seed-mg-spice", "seed-mg-size"],
  },
  {
    id: "seed-item-thai-tea",
    categoryId: "seed-cat-drink",
    stationId: "seed-station-bar",
    name: "ชาเย็น",
    description: null,
    basePrice: 4500,
    sortOrder: 1,
    groupIds: ["seed-mg-sweetness", "seed-mg-size"],
  },
  {
    id: "seed-item-water",
    categoryId: "seed-cat-drink",
    // ไม่ผูกสถานี = หยิบจากตู้เย็นหน้าร้านได้เลย ไม่ต้องขึ้นจอครัว
    stationId: null,
    name: "น้ำเปล่า",
    description: null,
    basePrice: 2000,
    sortOrder: 2,
    groupIds: [],
  },
  {
    id: "seed-item-bingsu",
    categoryId: "seed-cat-dessert",
    stationId: "seed-station-dessert",
    name: "บิงซูชาไทย",
    description: "เสิร์ฟ 2-3 ที่",
    basePrice: 12900,
    sortOrder: 1,
    groupIds: ["seed-mg-sweetness"],
  },
];

const TABLES = [
  { id: "seed-table-a1", name: "A1", tableCode: "a1x7qk", seats: 2, sortOrder: 1 },
  { id: "seed-table-a2", name: "A2", tableCode: "a2m4vd", seats: 4, sortOrder: 2 },
  { id: "seed-table-a3", name: "A3", tableCode: "a3p9hz", seats: 4, sortOrder: 3 },
  { id: "seed-table-b1", name: "B1", tableCode: "b1t6nw", seats: 6, sortOrder: 4 },
  { id: "seed-table-b2", name: "B2", tableCode: "b2r3cy", seats: 6, sortOrder: 5 },
];

const STAFF = [
  { id: "seed-staff-owner", code: "001", name: "เจ้าของร้าน", role: "OWNER" as const, pin: "1234" },
  { id: "seed-staff-cashier", code: "002", name: "แคชเชียร์", role: "CASHIER" as const, pin: "2345" },
  { id: "seed-staff-server", code: "003", name: "พนักงานเสิร์ฟ", role: "SERVER" as const, pin: "3456" },
  { id: "seed-staff-kitchen", code: "004", name: "ครัว", role: "KITCHEN" as const, pin: "4567" },
];

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
      /**
       * เขียนไว้ตรง ๆ ทั้งที่เป็นค่า default อยู่แล้ว เพราะสกุลเงินเป็นสิ่งที่
       * "ต้องตั้งใจเลือก" ไม่ใช่ค่าที่ปล่อยผ่านได้ — ราคาทุกตัวใน seed ด้านล่าง
       * เป็นสตางค์ (6000 = ฿60.00) ซึ่งจะแปลว่าคนละมูลค่าทันทีถ้าสาขาเป็น
       * LAK หรือ VND ที่ไม่มีทศนิยม (ดู lib/money.ts)
       */
      currency: "THB",
    },
  });

  for (const station of STATIONS) {
    await prisma.station.upsert({
      where: { id: station.id },
      update: { name: station.name, sortOrder: station.sortOrder },
      create: { ...station, branchId: branch.id },
    });
  }

  for (const category of CATEGORIES) {
    await prisma.menuCategory.upsert({
      where: { id: category.id },
      update: { name: category.name, sortOrder: category.sortOrder },
      create: { ...category, branchId: branch.id },
    });
  }

  for (const group of MODIFIER_GROUPS) {
    const { modifiers, ...groupData } = group;

    await prisma.modifierGroup.upsert({
      where: { id: groupData.id },
      update: groupData,
      create: { ...groupData, branchId: branch.id },
    });

    for (const [index, modifier] of modifiers.entries()) {
      await prisma.modifier.upsert({
        where: { id: modifier.id },
        update: { name: modifier.name, priceDelta: modifier.priceDelta, sortOrder: index },
        create: {
          ...modifier,
          sortOrder: index,
          branchId: branch.id,
          modifierGroupId: groupData.id,
        },
      });
    }
  }

  for (const item of MENU_ITEMS) {
    const { groupIds, ...itemData } = item;

    await prisma.menuItem.upsert({
      where: { id: itemData.id },
      update: { name: itemData.name, basePrice: itemData.basePrice, sortOrder: itemData.sortOrder },
      create: { ...itemData, branchId: branch.id },
    });

    for (const [index, modifierGroupId] of groupIds.entries()) {
      await prisma.menuItemModifierGroup.upsert({
        where: {
          menuItemId_modifierGroupId: { menuItemId: itemData.id, modifierGroupId },
        },
        update: { sortOrder: index },
        create: { menuItemId: itemData.id, modifierGroupId, sortOrder: index },
      });
    }
  }

  for (const table of TABLES) {
    await prisma.restaurantTable.upsert({
      where: { id: table.id },
      update: { name: table.name, seats: table.seats, sortOrder: table.sortOrder },
      create: { ...table, branchId: branch.id },
    });
  }

  for (const member of STAFF) {
    const { pin, ...staffData } = member;

    await prisma.staff.upsert({
      where: { id: staffData.id },
      // ไม่แตะ pinHash ตอน update เพื่อไม่ให้สั่ง seed ซ้ำแล้ว PIN เปลี่ยนทุกรอบ
      update: { name: staffData.name, role: staffData.role },
      create: { ...staffData, branchId: branch.id, pinHash: hashPin(pin) },
    });
  }

  console.log(
    [
      `seeded tenant=${tenant.name} branch=${branch.code} (${branch.id})`,
      `  stations=${STATIONS.length} categories=${CATEGORIES.length} items=${MENU_ITEMS.length}`,
      `  modifierGroups=${MODIFIER_GROUPS.length} tables=${TABLES.length} staff=${STAFF.length}`,
      `  ลองเปิดหน้าลูกค้าที่ /t/${TABLES[0].tableCode}`,
      `  PIN พนักงาน dev: ${STAFF.map((s) => `${s.code}=${s.pin}`).join(" ")}`,
    ].join("\n"),
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
