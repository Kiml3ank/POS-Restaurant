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

/**
 * จุดขายของสาขา — โต๊ะนั่งกินและ "เคาน์เตอร์ซื้อกลับ"
 *
 * เคาน์เตอร์เป็นแถวใน RestaurantTable เหมือนโต๊ะ แต่ `kind = COUNTER` ซึ่ง
 * เปลี่ยนพฤติกรรมสามอย่าง: ไม่ขึ้นผังโต๊ะ · เปิดบิลใหม่ทุกครั้งไม่เข้าร่วมบิลเดิม ·
 * ไม่คิดเซอร์วิสชาร์จ (ดู lib/sale-point.ts)
 *
 * มี `tableCode` เหมือนกันเพราะคอลัมน์บังคับ แต่ **สแกนเข้าหน้าลูกค้าไม่ได้** —
 * resolveCustomerContext() ปฏิเสธจุดขายที่ไม่ใช่โต๊ะนั่ง (ไม่งั้นลูกค้าที่ถ่ายรูป
 * QR ของเคาน์เตอร์ไปจะเปิดบิลซื้อกลับเองได้จากที่บ้าน)
 */
const TABLES = [
  { id: "seed-table-a1", name: "A1", tableCode: "a1x7qk", seats: 2, sortOrder: 1, kind: "DINE_IN" as const },
  { id: "seed-table-a2", name: "A2", tableCode: "a2m4vd", seats: 4, sortOrder: 2, kind: "DINE_IN" as const },
  { id: "seed-table-a3", name: "A3", tableCode: "a3p9hz", seats: 4, sortOrder: 3, kind: "DINE_IN" as const },
  { id: "seed-table-b1", name: "B1", tableCode: "b1t6nw", seats: 6, sortOrder: 4, kind: "DINE_IN" as const },
  { id: "seed-table-b2", name: "B2", tableCode: "b2r3cy", seats: 6, sortOrder: 5, kind: "DINE_IN" as const },
  {
    id: "seed-counter-1",
    name: "เคาน์เตอร์ซื้อกลับ",
    tableCode: "counter1",
    seats: 0,
    sortOrder: 90,
    kind: "COUNTER" as const,
  },
];

const STAFF = [
  { id: "seed-staff-owner", code: "001", name: "เจ้าของร้าน", role: "OWNER" as const, pin: "1234" },
  { id: "seed-staff-cashier", code: "002", name: "แคชเชียร์", role: "CASHIER" as const, pin: "2345" },
  { id: "seed-staff-server", code: "003", name: "พนักงานเสิร์ฟ", role: "SERVER" as const, pin: "3456" },
  { id: "seed-staff-kitchen", code: "004", name: "ครัว", role: "KITCHEN" as const, pin: "4567" },
];

/**
 * ข้อมูลผู้ขายที่ต้องขึ้นบนใบเสร็จ/ใบกำกับภาษีอย่างย่อ (บทที่ 12)
 *
 * เป็นข้อมูลสมมติสำหรับ dev — ก่อนใช้งานจริงต้องแก้เป็นของร้านจริง
 * และ **ต้องให้ผู้สอบบัญชี/สรรพากรตรวจรูปแบบใบก่อน** เนื้อหาภาษีในบทนี้
 * ไม่ใช่คำแนะนำทางกฎหมาย
 *
 * หมายเหตุ: Receipt snapshot ค่าพวกนี้ไว้ในแถวของตัวเองตอนออกใบ
 * แก้ที่นี่แล้วใบที่ออกไปก่อนหน้าไม่เปลี่ยนตาม ซึ่งเป็นพฤติกรรมที่ต้องการ
 */
const SELLER = {
  taxId: "0105561000000",
  addressLine: "99/9 ถนนสุขุมวิท แขวงคลองเตย เขตคลองเตย กรุงเทพฯ 10110",
  phone: "02-000-0000",
};

/** ชุดเอกสารที่ต้องมีตัวเดินเลขพร้อมใช้ตั้งแต่วินาทีแรกของสาขา */
const DOCUMENT_SERIES = ["ABB"] as const;

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { id: "seed-tenant" },
    /**
     * update ไม่ว่างเปล่าเหมือนตอนแรกแล้ว — เลขผู้เสียภาษีต้องเติมให้ฐานเดิมที่
     * seed ไปก่อนบทที่ 12 ด้วย ไม่ใช่เฉพาะฐานที่สร้างใหม่ ไม่งั้นใบกำกับภาษี
     * อย่างย่อจะออกมาโดยไม่มีเลขผู้เสียภาษี ซึ่งใช้ไม่ได้ตามกฎหมาย
     */
    update: { taxId: SELLER.taxId },
    create: {
      id: "seed-tenant",
      name: "ร้านอาหารตัวอย่าง",
      taxId: SELLER.taxId,
    },
  });

  const branch = await prisma.branch.upsert({
    where: { tenantId_code: { tenantId: tenant.id, code: "HQ" } },
    update: { addressLine: SELLER.addressLine, phone: SELLER.phone },
    create: {
      addressLine: SELLER.addressLine,
      phone: SELLER.phone,
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
      update: {
        name: table.name,
        seats: table.seats,
        sortOrder: table.sortOrder,
        kind: table.kind,
      },
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

  /**
   * ตัวเดินเลขเอกสารต้องมีอยู่ก่อนการรับเงินครั้งแรกเสมอ
   *
   * ไม่ปล่อยให้ issueReceipt() upsert เอาเองตอนใช้งาน เพราะการ upsert ครั้งแรก
   * ของสาขาใหม่จะแข่งกันเองถ้าสองเครื่องรับเงินพร้อมกันในนาทีนั้น แล้วเครื่องหนึ่ง
   * จะชน unique violation ทั้งที่ลูกค้าจ่ายเงินไปแล้ว — ราคาถูกกว่ามากที่จะให้แถวนี้
   * เกิดพร้อมสาขา (migration ทำให้สาขาเดิม · seed ทำให้สาขาที่สร้างจาก seed)
   */
  for (const series of DOCUMENT_SERIES) {
    await prisma.documentCounter.upsert({
      where: { branchId_series: { branchId: branch.id, series } },
      // ห้ามแตะ lastSeq ตอน update เด็ดขาด — สั่ง seed ซ้ำแล้วเลขต้องไม่ถอยกลับ
      update: {},
      create: { branchId: branch.id, series },
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
