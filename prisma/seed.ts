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
  { id: "seed-station-hot", code: "HOT", name: "Hot Kitchen", sortOrder: 1 },
  { id: "seed-station-bar", code: "BAR", name: "Beverage Bar", sortOrder: 2 },
  { id: "seed-station-dessert", code: "DESSERT", name: "Dessert", sortOrder: 3 },
];

/**
 * หมวดเมนู
 *
 * "Appetizers" แทรกเป็นลำดับ 3 ตามที่เมนูจริงเรียง (ของทานเล่นมาก่อนเครื่องดื่ม)
 * ทำให้ Drinks/Desserts เลื่อนไปเป็น 4/5 — ปลอดภัยเพราะ `sortOrder` เป็นแค่
 * ลำดับแสดงผล ไม่มี unique constraint และไม่มีอะไรอ้างถึงค่าตัวเลขนี้
 */
const CATEGORIES = [
  { id: "seed-cat-rice", name: "Single Dishes", sortOrder: 1 },
  { id: "seed-cat-soup", name: "Soups & Curries", sortOrder: 2 },
  { id: "seed-cat-appetizer", name: "Appetizers", sortOrder: 3 },
  { id: "seed-cat-drink", name: "Drinks", sortOrder: 4 },
  { id: "seed-cat-dessert", name: "Desserts", sortOrder: 5 },
];

/**
 * ราคาทุกค่าเป็น "หน่วยย่อยที่สุดของสกุลเงินสาขา" — 6000 = ฿60.00 ในสาขา THB
 * (ดูกฎเรื่องเงินใน CLAUDE.md — ห้ามหารด้วย 100 นอก lib/money.ts)
 *
 * ⚠ `sortOrder` ของตัวเลือกมาจาก **ลำดับในอาร์เรย์** (loop ใช้ index)
 * การแทรกตัวเลือกใหม่กลางอาร์เรย์จึงเลื่อนเลขของตัวที่อยู่ถัดไป — ตัวเลือกที่
 * เพิ่มทีหลังจึงต่อท้ายเสมอ เพื่อไม่ให้ลำดับที่พนักงานคุ้นเคยสลับที่
 */
const MODIFIER_GROUPS = [
  {
    id: "seed-mg-spice",
    name: "Spice Level",
    required: true,
    minSelect: 1,
    maxSelect: 1,
    modifiers: [
      { id: "seed-mod-spice-none", name: "No Spice", priceDelta: 0 },
      { id: "seed-mod-spice-mild", name: "Mild", priceDelta: 0 },
      { id: "seed-mod-spice-medium", name: "Medium", priceDelta: 0 },
      { id: "seed-mod-spice-hot", name: "Spicy", priceDelta: 0 },
    ],
  },
  {
    id: "seed-mg-size",
    name: "Size",
    required: true,
    minSelect: 1,
    maxSelect: 1,
    modifiers: [
      { id: "seed-mod-size-regular", name: "Regular", priceDelta: 0 },
      { id: "seed-mod-size-large", name: "Large", priceDelta: 2000 },
    ],
  },
  {
    id: "seed-mg-sweetness",
    name: "Sweetness",
    required: true,
    minSelect: 1,
    maxSelect: 1,
    modifiers: [
      { id: "seed-mod-sweet-0", name: "No Sugar", priceDelta: 0 },
      { id: "seed-mod-sweet-50", name: "Less Sweet", priceDelta: 0 },
      { id: "seed-mod-sweet-100", name: "Normal Sweet", priceDelta: 0 },
      { id: "seed-mod-sweet-150", name: "Extra Sweet", priceDelta: 0 },
    ],
  },
  {
    /**
     * "No Meat" (-฿10) ไม่ได้อยู่ในสเปกรอบนี้ แต่ **เก็บไว้**
     * เพราะเคยถูกสั่งจริงได้ และการถอดตัวเลือกออกจากกลุ่มไม่ได้ลบประวัติ
     * แต่ทำให้เมนูที่เคยขายมีตัวเลือกน้อยลงโดยไม่มีใครสั่ง
     */
    id: "seed-mg-topping",
    name: "Toppings",
    required: false,
    minSelect: 0,
    maxSelect: 3,
    modifiers: [
      { id: "seed-mod-top-egg", name: "Fried Egg", priceDelta: 1500 },
      { id: "seed-mod-top-rice", name: "Extra Rice", priceDelta: 1000 },
      { id: "seed-mod-top-nomeat", name: "No Meat", priceDelta: -1000 },
      { id: "seed-mod-top-cheese", name: "Cheese", priceDelta: 2000 },
      { id: "seed-mod-top-chicken", name: "Extra Chicken", priceDelta: 3000 },
      { id: "seed-mod-top-shrimp", name: "Extra Shrimp", priceDelta: 4000 },
    ],
  },
  {
    id: "seed-mg-dessert-topping",
    name: "Dessert Toppings",
    required: false,
    minSelect: 0,
    maxSelect: 3,
    modifiers: [
      { id: "seed-mod-dtop-whipped", name: "Whipped Cream", priceDelta: 1500 },
      { id: "seed-mod-dtop-chocolate", name: "Chocolate Sauce", priceDelta: 1000 },
      { id: "seed-mod-dtop-condensed", name: "Condensed Milk", priceDelta: 1000 },
      { id: "seed-mod-dtop-banana", name: "Banana", priceDelta: 1500 },
      { id: "seed-mod-dtop-icecream", name: "Ice Cream", priceDelta: 2500 },
    ],
  },
];

const MENU_ITEMS = [
  // ── Single Dishes ────────────────────────────────────────────────────────
  {
    id: "seed-item-krapao",
    categoryId: "seed-cat-rice",
    stationId: "seed-station-hot",
    name: "Pad Kra Pao Minced Pork",
    description: "Minced pork stir-fried over high heat with holy basil, served with steamed rice.",
    basePrice: 6000,
    sortOrder: 1,
    groupIds: ["seed-mg-spice", "seed-mg-size", "seed-mg-topping"],
  },
  {
    id: "seed-item-fried-rice",
    categoryId: "seed-cat-rice",
    stationId: "seed-station-hot",
    name: "Crab Fried Rice",
    description: "Fried rice with lump crab meat and fresh egg.",
    basePrice: 12000,
    sortOrder: 2,
    groupIds: ["seed-mg-size", "seed-mg-topping"],
  },
  {
    id: "seed-item-chicken-fried-rice",
    categoryId: "seed-cat-rice",
    stationId: "seed-station-hot",
    name: "Chicken Fried Rice",
    description: "Fragrant Thai-style fried rice with tender chicken, vegetables, and egg.",
    basePrice: 7000,
    sortOrder: 3,
    groupIds: ["seed-mg-size"],
  },
  {
    id: "seed-item-garlic-pork-rice",
    categoryId: "seed-cat-rice",
    stationId: "seed-station-hot",
    name: "Garlic Pork with Rice",
    description:
      "Stir-fried pork with crispy garlic and savory garlic sauce served with steamed rice.",
    basePrice: 6500,
    sortOrder: 4,
    groupIds: ["seed-mg-size", "seed-mg-topping"],
  },
  {
    id: "seed-item-thai-omelette-rice",
    categoryId: "seed-cat-rice",
    stationId: "seed-station-hot",
    name: "Thai Omelette with Rice",
    description: "Fluffy deep-fried Thai omelette served over steamed rice.",
    basePrice: 5500,
    sortOrder: 5,
    groupIds: ["seed-mg-topping"],
  },
  {
    id: "seed-item-chicken-cashew",
    categoryId: "seed-cat-rice",
    stationId: "seed-station-hot",
    name: "Stir-Fried Chicken with Cashew Nuts",
    description: "Wok-fried chicken with roasted cashew nuts, dried chili, and onion.",
    basePrice: 9000,
    sortOrder: 6,
    groupIds: ["seed-mg-spice"],
  },
  {
    id: "seed-item-pad-thai-shrimp",
    categoryId: "seed-cat-rice",
    stationId: "seed-station-hot",
    name: "Pad Thai with Shrimp",
    description:
      "Classic Thai stir-fried rice noodles with shrimp, egg, bean sprouts, and crushed peanuts.",
    basePrice: 10000,
    sortOrder: 7,
    groupIds: ["seed-mg-spice", "seed-mg-topping"],
  },
  {
    id: "seed-item-chicken-basil-fried-rice",
    categoryId: "seed-cat-rice",
    stationId: "seed-station-hot",
    name: "Chicken Basil Fried Rice",
    description: "Fried rice tossed with chicken, holy basil, and fresh chili.",
    basePrice: 7000,
    sortOrder: 8,
    groupIds: ["seed-mg-size", "seed-mg-spice"],
  },

  // ── Soups & Curries ──────────────────────────────────────────────────────
  {
    id: "seed-item-tomyum",
    categoryId: "seed-cat-soup",
    stationId: "seed-station-hot",
    name: "Creamy Tom Yum Goong",
    description: "Rich, creamy hot and sour soup with river prawns and straw mushrooms.",
    basePrice: 18000,
    sortOrder: 1,
    groupIds: ["seed-mg-spice", "seed-mg-size"],
  },
  {
    id: "seed-item-clear-tomyum",
    categoryId: "seed-cat-soup",
    stationId: "seed-station-hot",
    name: "Clear Tom Yum Goong",
    description: "A hot and sour Thai soup with fresh shrimp, herbs, lime, and chili.",
    basePrice: 17000,
    sortOrder: 2,
    groupIds: ["seed-mg-size", "seed-mg-spice"],
  },
  {
    id: "seed-item-tom-kha-gai",
    categoryId: "seed-cat-soup",
    stationId: "seed-station-hot",
    name: "Tom Kha Gai",
    description: "Creamy coconut soup with tender chicken, galangal, lemongrass, lime, and herbs.",
    basePrice: 14000,
    sortOrder: 3,
    groupIds: ["seed-mg-size", "seed-mg-spice"],
  },
  {
    id: "seed-item-green-curry-chicken",
    categoryId: "seed-cat-soup",
    stationId: "seed-station-hot",
    name: "Green Curry with Chicken",
    description:
      "Rich Thai green curry with tender chicken, coconut milk, vegetables, and aromatic herbs.",
    basePrice: 12000,
    sortOrder: 4,
    groupIds: ["seed-mg-spice"],
  },
  {
    id: "seed-item-red-curry-chicken",
    categoryId: "seed-cat-soup",
    stationId: "seed-station-hot",
    name: "Red Curry with Chicken",
    description: "Thai red curry simmered with chicken, coconut milk, bamboo shoots, and basil.",
    basePrice: 12000,
    sortOrder: 5,
    groupIds: ["seed-mg-spice"],
  },

  // ── Appetizers ───────────────────────────────────────────────────────────
  {
    id: "seed-item-fried-spring-rolls",
    categoryId: "seed-cat-appetizer",
    stationId: "seed-station-hot",
    name: "Fried Spring Rolls",
    description: "Crispy golden spring rolls stuffed with vegetables and glass noodles.",
    basePrice: 7000,
    sortOrder: 1,
    groupIds: ["seed-mg-topping"],
  },
  {
    id: "seed-item-chicken-wings",
    categoryId: "seed-cat-appetizer",
    stationId: "seed-station-hot",
    name: "Chicken Wings",
    description: "Crispy fried chicken wings served with a sweet chili dipping sauce.",
    basePrice: 9000,
    sortOrder: 2,
    groupIds: ["seed-mg-spice"],
  },
  {
    id: "seed-item-fried-tofu",
    categoryId: "seed-cat-appetizer",
    stationId: "seed-station-hot",
    name: "Fried Tofu",
    description: "Golden fried tofu with a crisp shell, served with peanut dipping sauce.",
    basePrice: 6000,
    sortOrder: 3,
    groupIds: ["seed-mg-topping"],
  },
  {
    id: "seed-item-shrimp-cakes",
    categoryId: "seed-cat-appetizer",
    stationId: "seed-station-hot",
    name: "Shrimp Cakes",
    description: "Deep-fried minced shrimp patties served with plum sauce.",
    basePrice: 12000,
    sortOrder: 4,
    groupIds: ["seed-mg-topping"],
  },
  {
    id: "seed-item-french-fries",
    categoryId: "seed-cat-appetizer",
    stationId: "seed-station-hot",
    name: "French Fries",
    description: "Crispy golden fries lightly salted.",
    basePrice: 6000,
    sortOrder: 5,
    groupIds: ["seed-mg-size"],
  },

  // ── Drinks ───────────────────────────────────────────────────────────────
  {
    id: "seed-item-thai-tea",
    categoryId: "seed-cat-drink",
    stationId: "seed-station-bar",
    name: "Thai Iced Tea",
    description: "Sweet Thai tea poured over ice with creamy milk.",
    basePrice: 4500,
    sortOrder: 1,
    groupIds: ["seed-mg-sweetness", "seed-mg-size"],
  },
  {
    id: "seed-item-water",
    categoryId: "seed-cat-drink",
    // ไม่ผูกสถานี = หยิบจากตู้เย็นหน้าร้านได้เลย ไม่ต้องขึ้นจอครัว
    // (นี่คือ "No Kitchen Station" ของสเปก — เป็น stationId: null ไม่ใช่แถวใน Station)
    stationId: null,
    name: "Bottled Water",
    description: null,
    basePrice: 2000,
    sortOrder: 2,
    groupIds: [],
  },
  {
    id: "seed-item-thai-green-tea",
    categoryId: "seed-cat-drink",
    stationId: "seed-station-bar",
    name: "Thai Iced Green Tea",
    description: "Roasted green tea served iced with milk.",
    basePrice: 4500,
    sortOrder: 3,
    groupIds: ["seed-mg-size", "seed-mg-sweetness"],
  },
  {
    id: "seed-item-iced-coffee",
    categoryId: "seed-cat-drink",
    stationId: "seed-station-bar",
    name: "Iced Coffee",
    description: "Freshly brewed coffee served over ice.",
    basePrice: 5000,
    sortOrder: 4,
    groupIds: ["seed-mg-size", "seed-mg-sweetness"],
  },
  {
    id: "seed-item-lemon-tea",
    categoryId: "seed-cat-drink",
    stationId: "seed-station-bar",
    name: "Lemon Tea",
    description: "Chilled black tea with fresh lemon.",
    basePrice: 4500,
    sortOrder: 5,
    groupIds: ["seed-mg-size", "seed-mg-sweetness"],
  },
  {
    id: "seed-item-lime-soda",
    categoryId: "seed-cat-drink",
    stationId: "seed-station-bar",
    name: "Fresh Lime Soda",
    description: "Sparkling soda with fresh lime juice.",
    basePrice: 5000,
    sortOrder: 6,
    groupIds: ["seed-mg-size", "seed-mg-sweetness"],
  },
  {
    id: "seed-item-coke",
    categoryId: "seed-cat-drink",
    stationId: "seed-station-bar",
    name: "Coke",
    description: "Chilled cola served over ice.",
    basePrice: 3000,
    sortOrder: 7,
    groupIds: ["seed-mg-size"],
  },
  {
    id: "seed-item-orange-juice",
    categoryId: "seed-cat-drink",
    stationId: "seed-station-bar",
    name: "Orange Juice",
    description: "Freshly squeezed orange juice.",
    basePrice: 5000,
    sortOrder: 8,
    groupIds: ["seed-mg-size"],
  },

  // ── Desserts ─────────────────────────────────────────────────────────────
  {
    id: "seed-item-bingsu",
    categoryId: "seed-cat-dessert",
    stationId: "seed-station-dessert",
    name: "Thai Tea Bingsu",
    description: "Shaved ice dessert with Thai tea syrup. Serves 2-3.",
    basePrice: 12900,
    sortOrder: 1,
    groupIds: ["seed-mg-sweetness"],
  },
  {
    id: "seed-item-mango-sticky-rice",
    categoryId: "seed-cat-dessert",
    stationId: "seed-station-dessert",
    name: "Mango Sticky Rice",
    description: "Sweet sticky rice served with ripe mango and creamy coconut sauce.",
    basePrice: 8900,
    sortOrder: 2,
    groupIds: ["seed-mg-size"],
  },
  {
    id: "seed-item-coconut-ice-cream",
    categoryId: "seed-cat-dessert",
    stationId: "seed-station-dessert",
    name: "Coconut Ice Cream",
    description: "Creamy coconut ice cream with a refreshing tropical flavor.",
    basePrice: 6900,
    sortOrder: 3,
    groupIds: ["seed-mg-dessert-topping"],
  },
  {
    id: "seed-item-thai-tea-toast",
    categoryId: "seed-cat-dessert",
    stationId: "seed-station-dessert",
    name: "Thai Tea Toast",
    description: "Thick-cut toast soaked in Thai tea custard and toasted golden.",
    basePrice: 7900,
    sortOrder: 4,
    groupIds: ["seed-mg-dessert-topping"],
  },
  {
    id: "seed-item-banana-roti",
    categoryId: "seed-cat-dessert",
    stationId: "seed-station-dessert",
    name: "Banana Roti",
    description: "Crispy pan-fried roti filled with banana and drizzled with condensed milk.",
    basePrice: 6900,
    sortOrder: 5,
    groupIds: ["seed-mg-dessert-topping"],
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
      update: {
        name: itemData.name,
        description: itemData.description,
        basePrice: itemData.basePrice,
        sortOrder: itemData.sortOrder,
        categoryId: itemData.categoryId,
        stationId: itemData.stationId,
      },
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
