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
 *
 * ── ร้านเวียดนาม ราคาเป็นดอง (งาน i18n + VND 2026-09) ──────────────────────
 * ข้อมูลเมนูเป็นภาษาเวียดนามภาษาเดียว (เป็น "ข้อมูล" ไม่ใช่ "กรอบ" — ไม่แปลตามปุ่ม)
 * **id ทุกตัวคงเดิม** แม้ชื่อ id จะมาจากเมนูไทยชุดก่อน (seed-item-krapao ฯลฯ)
 * เพราะสคริปต์ smoke และเครื่องมือ dev อ้างถึง id พวกนี้ตรง ๆ
 */
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const STATIONS = [
  { id: "seed-station-hot", code: "HOT", name: "Bếp nóng", sortOrder: 1 },
  { id: "seed-station-bar", code: "BAR", name: "Quầy pha chế", sortOrder: 2 },
  { id: "seed-station-dessert", code: "DESSERT", name: "Bếp bánh", sortOrder: 3 },
];

/**
 * หมวดเมนู — `sortOrder` เป็นแค่ลำดับแสดงผล ไม่มี unique constraint
 * และไม่มีอะไรอ้างถึงค่าตัวเลขนี้
 */
const CATEGORIES = [
  { id: "seed-cat-rice", name: "Món chính", sortOrder: 1 },
  { id: "seed-cat-soup", name: "Phở & Bún", sortOrder: 2 },
  { id: "seed-cat-appetizer", name: "Món khai vị", sortOrder: 3 },
  { id: "seed-cat-drink", name: "Đồ uống", sortOrder: 4 },
  { id: "seed-cat-dessert", name: "Tráng miệng", sortOrder: 5 },
];

/**
 * ⚠ ราคาทุกค่าเป็น **ดองเต็มจำนวน** — VND ไม่มีหน่วยย่อย `45000` คือ `45.000 ₫`
 * ไม่ใช่ 450 ₫ (ดู minorUnitsPerMajor ใน lib/money.ts) ห้ามมีเศษแบบสตางค์เด็ดขาด
 *
 * ⚠ `sortOrder` ของตัวเลือกมาจาก **ลำดับในอาร์เรย์** (loop ใช้ index)
 * การแทรกตัวเลือกใหม่กลางอาร์เรย์จึงเลื่อนเลขของตัวที่อยู่ถัดไป — ตัวเลือกที่
 * เพิ่มทีหลังจึงต่อท้ายเสมอ เพื่อไม่ให้ลำดับที่พนักงานคุ้นเคยสลับที่
 */
const MODIFIER_GROUPS = [
  {
    id: "seed-mg-spice",
    name: "Độ cay",
    required: true,
    minSelect: 1,
    maxSelect: 1,
    modifiers: [
      { id: "seed-mod-spice-none", name: "Không cay", priceDelta: 0 },
      { id: "seed-mod-spice-mild", name: "Ít cay", priceDelta: 0 },
      { id: "seed-mod-spice-medium", name: "Cay vừa", priceDelta: 0 },
      { id: "seed-mod-spice-hot", name: "Cay nhiều", priceDelta: 0 },
    ],
  },
  {
    id: "seed-mg-size",
    name: "Kích cỡ",
    required: true,
    minSelect: 1,
    maxSelect: 1,
    modifiers: [
      { id: "seed-mod-size-regular", name: "Thường", priceDelta: 0 },
      { id: "seed-mod-size-large", name: "Lớn", priceDelta: 10_000 },
    ],
  },
  {
    id: "seed-mg-sweetness",
    name: "Độ ngọt",
    required: true,
    minSelect: 1,
    maxSelect: 1,
    modifiers: [
      { id: "seed-mod-sweet-0", name: "Không đường", priceDelta: 0 },
      { id: "seed-mod-sweet-50", name: "Ít ngọt", priceDelta: 0 },
      { id: "seed-mod-sweet-100", name: "Ngọt vừa", priceDelta: 0 },
      { id: "seed-mod-sweet-150", name: "Ngọt nhiều", priceDelta: 0 },
    ],
  },
  {
    /**
     * "Không thịt" (−10.000) เป็นส่วนต่างติดลบตัวเดียวของ seed — เก็บไว้เพื่อให้
     * เส้นทาง `priceDelta < 0` ถูกเดินจริงทุกครั้งที่ทดสอบ (ส่วนลดในตัวเลือก)
     */
    id: "seed-mg-topping",
    name: "Thêm topping",
    required: false,
    minSelect: 0,
    maxSelect: 3,
    modifiers: [
      { id: "seed-mod-top-egg", name: "Trứng ốp la", priceDelta: 10_000 },
      { id: "seed-mod-top-rice", name: "Thêm cơm", priceDelta: 5_000 },
      { id: "seed-mod-top-nomeat", name: "Không thịt", priceDelta: -10_000 },
      { id: "seed-mod-top-cheese", name: "Phô mai", priceDelta: 10_000 },
      { id: "seed-mod-top-chicken", name: "Thêm gà", priceDelta: 20_000 },
      { id: "seed-mod-top-shrimp", name: "Thêm tôm", priceDelta: 25_000 },
    ],
  },
  {
    id: "seed-mg-dessert-topping",
    name: "Topping tráng miệng",
    required: false,
    minSelect: 0,
    maxSelect: 3,
    modifiers: [
      { id: "seed-mod-dtop-whipped", name: "Kem tươi", priceDelta: 10_000 },
      { id: "seed-mod-dtop-chocolate", name: "Sốt sô-cô-la", priceDelta: 5_000 },
      { id: "seed-mod-dtop-condensed", name: "Sữa đặc", priceDelta: 5_000 },
      { id: "seed-mod-dtop-banana", name: "Chuối", priceDelta: 10_000 },
      { id: "seed-mod-dtop-icecream", name: "Kem viên", priceDelta: 15_000 },
    ],
  },
];

const MENU_ITEMS = [
  // ── Món chính ────────────────────────────────────────────────────────────
  {
    id: "seed-item-krapao",
    categoryId: "seed-cat-rice",
    stationId: "seed-station-hot",
    name: "Cơm tấm sườn nướng",
    description: "Sườn heo nướng than, ăn kèm cơm tấm, đồ chua và nước mắm pha.",
    basePrice: 65_000,
    sortOrder: 1,
    groupIds: ["seed-mg-spice", "seed-mg-size", "seed-mg-topping"],
  },
  {
    id: "seed-item-fried-rice",
    categoryId: "seed-cat-rice",
    stationId: "seed-station-hot",
    name: "Cơm chiên hải sản",
    description: "Cơm chiên với tôm, mực và trứng, thơm mùi hành phi.",
    basePrice: 85_000,
    sortOrder: 2,
    groupIds: ["seed-mg-size", "seed-mg-topping"],
  },
  {
    id: "seed-item-chicken-fried-rice",
    categoryId: "seed-cat-rice",
    stationId: "seed-station-hot",
    name: "Cơm gà Hội An",
    description: "Cơm nấu nước luộc gà, gà xé trộn rau răm và hành tây.",
    basePrice: 65_000,
    sortOrder: 3,
    groupIds: ["seed-mg-size"],
  },
  {
    id: "seed-item-garlic-pork-rice",
    categoryId: "seed-cat-rice",
    stationId: "seed-station-hot",
    name: "Cơm thịt kho trứng",
    description: "Thịt ba chỉ kho nước dừa với trứng vịt, ăn kèm dưa cải.",
    basePrice: 60_000,
    sortOrder: 4,
    groupIds: ["seed-mg-size", "seed-mg-topping"],
  },
  {
    id: "seed-item-thai-omelette-rice",
    categoryId: "seed-cat-rice",
    stationId: "seed-station-hot",
    name: "Cơm chiên trứng",
    description: "Cơm chiên trứng đơn giản, hạt cơm tơi và thơm.",
    basePrice: 45_000,
    sortOrder: 5,
    groupIds: ["seed-mg-topping"],
  },
  {
    id: "seed-item-chicken-cashew",
    categoryId: "seed-cat-rice",
    stationId: "seed-station-hot",
    name: "Gà xào sả ớt",
    description: "Gà xào lửa lớn với sả và ớt, ăn kèm cơm trắng.",
    basePrice: 75_000,
    sortOrder: 6,
    groupIds: ["seed-mg-spice"],
  },
  {
    id: "seed-item-pad-thai-shrimp",
    categoryId: "seed-cat-rice",
    stationId: "seed-station-hot",
    name: "Mì xào hải sản",
    description: "Mì trứng xào giòn với tôm, mực và rau cải.",
    basePrice: 80_000,
    sortOrder: 7,
    groupIds: ["seed-mg-spice", "seed-mg-topping"],
  },
  {
    id: "seed-item-chicken-basil-fried-rice",
    categoryId: "seed-cat-rice",
    stationId: "seed-station-hot",
    name: "Cơm chiên Dương Châu",
    description: "Cơm chiên lạp xưởng, tôm, đậu Hà Lan và trứng.",
    basePrice: 60_000,
    sortOrder: 8,
    groupIds: ["seed-mg-size", "seed-mg-spice"],
  },

  // ── Phở & Bún ────────────────────────────────────────────────────────────
  {
    id: "seed-item-tomyum",
    categoryId: "seed-cat-soup",
    stationId: "seed-station-hot",
    name: "Phở bò tái",
    description: "Bánh phở mềm, thịt bò tái chín trong nước dùng xương hầm tám tiếng.",
    basePrice: 65_000,
    sortOrder: 1,
    groupIds: ["seed-mg-spice", "seed-mg-size"],
  },
  {
    id: "seed-item-clear-tomyum",
    categoryId: "seed-cat-soup",
    stationId: "seed-station-hot",
    name: "Phở gà",
    description: "Phở gà ta xé, nước dùng trong và thanh.",
    basePrice: 60_000,
    sortOrder: 2,
    groupIds: ["seed-mg-size", "seed-mg-spice"],
  },
  {
    id: "seed-item-tom-kha-gai",
    categoryId: "seed-cat-soup",
    stationId: "seed-station-hot",
    name: "Bún bò Huế",
    description: "Bún sợi to, giò heo và bò trong nước dùng sả ớt đậm vị.",
    basePrice: 70_000,
    sortOrder: 3,
    groupIds: ["seed-mg-size", "seed-mg-spice"],
  },
  {
    id: "seed-item-green-curry-chicken",
    categoryId: "seed-cat-soup",
    stationId: "seed-station-hot",
    name: "Bún chả Hà Nội",
    description: "Chả nướng than hoa, bún tươi, rau sống và nước chấm chua ngọt.",
    basePrice: 65_000,
    sortOrder: 4,
    groupIds: ["seed-mg-spice"],
  },
  {
    id: "seed-item-red-curry-chicken",
    categoryId: "seed-cat-soup",
    stationId: "seed-station-hot",
    name: "Cà ri gà",
    description: "Cà ri gà nước cốt dừa với khoai lang, ăn kèm bánh mì.",
    basePrice: 75_000,
    sortOrder: 5,
    groupIds: ["seed-mg-spice"],
  },

  // ── Món khai vị ──────────────────────────────────────────────────────────
  {
    id: "seed-item-fried-spring-rolls",
    categoryId: "seed-cat-appetizer",
    stationId: "seed-station-hot",
    name: "Chả giò",
    description: "Chả giò chiên giòn nhân thịt, miến và mộc nhĩ.",
    basePrice: 45_000,
    sortOrder: 1,
    groupIds: ["seed-mg-topping"],
  },
  {
    id: "seed-item-chicken-wings",
    categoryId: "seed-cat-appetizer",
    stationId: "seed-station-hot",
    name: "Cánh gà chiên nước mắm",
    description: "Cánh gà chiên giòn áo nước mắm tỏi.",
    basePrice: 65_000,
    sortOrder: 2,
    groupIds: ["seed-mg-spice"],
  },
  {
    id: "seed-item-fried-tofu",
    categoryId: "seed-cat-appetizer",
    stationId: "seed-station-hot",
    name: "Gỏi cuốn tôm thịt",
    description: "Bánh tráng cuốn tôm, thịt, bún và rau thơm, chấm tương đậu phộng.",
    basePrice: 45_000,
    sortOrder: 3,
    groupIds: ["seed-mg-topping"],
  },
  {
    id: "seed-item-shrimp-cakes",
    categoryId: "seed-cat-appetizer",
    stationId: "seed-station-hot",
    name: "Chạo tôm",
    description: "Chả tôm quấn mía nướng thơm.",
    basePrice: 55_000,
    sortOrder: 4,
    groupIds: ["seed-mg-topping"],
  },
  {
    id: "seed-item-french-fries",
    categoryId: "seed-cat-appetizer",
    stationId: "seed-station-hot",
    name: "Khoai tây chiên",
    description: "Khoai tây chiên giòn, rắc muối.",
    basePrice: 35_000,
    sortOrder: 5,
    groupIds: ["seed-mg-size"],
  },

  // ── Đồ uống ──────────────────────────────────────────────────────────────
  {
    id: "seed-item-thai-tea",
    categoryId: "seed-cat-drink",
    stationId: "seed-station-bar",
    name: "Cà phê sữa đá",
    description: "Cà phê phin pha với sữa đặc, rót trên đá.",
    basePrice: 29_000,
    sortOrder: 1,
    groupIds: ["seed-mg-sweetness", "seed-mg-size"],
  },
  {
    id: "seed-item-water",
    categoryId: "seed-cat-drink",
    // ไม่ผูกสถานี = หยิบจากตู้เย็นหน้าร้านได้เลย ไม่ต้องขึ้นจอครัว
    // (นี่คือ "No Kitchen Station" ของสเปก — เป็น stationId: null ไม่ใช่แถวใน Station
    //  สร้างเป็นสถานีจริงเมื่อไหร่ น้ำขวดจะไปโผล่บนจอครัวแล้วค้างอยู่ตรงนั้น)
    stationId: null,
    name: "Nước suối",
    description: null,
    basePrice: 15_000,
    sortOrder: 2,
    groupIds: [],
  },
  {
    id: "seed-item-thai-green-tea",
    categoryId: "seed-cat-drink",
    stationId: "seed-station-bar",
    name: "Trà đào cam sả",
    description: "Trà đen ủ lạnh với đào miếng, cam tươi và sả.",
    basePrice: 45_000,
    sortOrder: 3,
    groupIds: ["seed-mg-size", "seed-mg-sweetness"],
  },
  {
    id: "seed-item-iced-coffee",
    categoryId: "seed-cat-drink",
    stationId: "seed-station-bar",
    name: "Cà phê đen đá",
    description: "Cà phê phin nguyên chất, đậm và thơm.",
    basePrice: 25_000,
    sortOrder: 4,
    groupIds: ["seed-mg-size", "seed-mg-sweetness"],
  },
  {
    id: "seed-item-lemon-tea",
    categoryId: "seed-cat-drink",
    stationId: "seed-station-bar",
    name: "Trà chanh",
    description: "Trà xanh pha chanh tươi, mát lạnh.",
    basePrice: 25_000,
    sortOrder: 5,
    groupIds: ["seed-mg-size", "seed-mg-sweetness"],
  },
  {
    id: "seed-item-lime-soda",
    categoryId: "seed-cat-drink",
    stationId: "seed-station-bar",
    name: "Soda chanh",
    description: "Soda chanh tươi với lá bạc hà.",
    basePrice: 35_000,
    sortOrder: 6,
    groupIds: ["seed-mg-size", "seed-mg-sweetness"],
  },
  {
    id: "seed-item-coke",
    categoryId: "seed-cat-drink",
    stationId: "seed-station-bar",
    name: "Coca-Cola",
    description: null,
    basePrice: 25_000,
    sortOrder: 7,
    groupIds: ["seed-mg-size"],
  },
  {
    id: "seed-item-orange-juice",
    categoryId: "seed-cat-drink",
    stationId: "seed-station-bar",
    name: "Nước cam ép",
    description: "Cam sành ép tươi mỗi ngày.",
    basePrice: 40_000,
    sortOrder: 8,
    groupIds: ["seed-mg-size"],
  },

  // ── Tráng miệng ──────────────────────────────────────────────────────────
  {
    id: "seed-item-bingsu",
    categoryId: "seed-cat-dessert",
    stationId: "seed-station-dessert",
    name: "Chè ba màu",
    description: "Đậu xanh, đậu đỏ, thạch lá dứa và nước cốt dừa trên đá bào.",
    basePrice: 35_000,
    sortOrder: 1,
    groupIds: ["seed-mg-sweetness"],
  },
  {
    id: "seed-item-mango-sticky-rice",
    categoryId: "seed-cat-dessert",
    stationId: "seed-station-dessert",
    name: "Chè khúc bạch",
    description: "Khúc bạch sữa hạnh nhân với nhãn và vải, nước đường thanh.",
    basePrice: 40_000,
    sortOrder: 2,
    groupIds: ["seed-mg-size"],
  },
  {
    id: "seed-item-coconut-ice-cream",
    categoryId: "seed-cat-dessert",
    stationId: "seed-station-dessert",
    name: "Kem dừa",
    description: "Kem dừa mát lạnh phục vụ trong trái dừa.",
    basePrice: 35_000,
    sortOrder: 3,
    groupIds: ["seed-mg-dessert-topping"],
  },
  {
    id: "seed-item-thai-tea-toast",
    categoryId: "seed-cat-dessert",
    stationId: "seed-station-dessert",
    name: "Bánh flan",
    description: "Bánh flan trứng sữa với lớp caramel và cà phê.",
    basePrice: 25_000,
    sortOrder: 4,
    groupIds: ["seed-mg-dessert-topping"],
  },
  {
    id: "seed-item-banana-roti",
    categoryId: "seed-cat-dessert",
    stationId: "seed-station-dessert",
    name: "Chuối nướng nước cốt dừa",
    description: "Chuối nếp nướng, rưới nước cốt dừa và đậu phộng rang.",
    basePrice: 35_000,
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
    name: "Quầy mang đi",
    tableCode: "counter1",
    seats: 0,
    sortOrder: 90,
    kind: "COUNTER" as const,
  },
];

/** PIN คงเดิมทุกคน (001=1234 …) — smoke ทุกชุดและ dev:staff-cookie อ้างถึงค่าพวกนี้ */
const STAFF = [
  { id: "seed-staff-owner", code: "001", name: "Nguyễn Văn An", role: "OWNER" as const, pin: "1234" },
  { id: "seed-staff-cashier", code: "002", name: "Trần Thị Bình", role: "CASHIER" as const, pin: "2345" },
  { id: "seed-staff-server", code: "003", name: "Lê Văn Cường", role: "SERVER" as const, pin: "3456" },
  { id: "seed-staff-kitchen", code: "004", name: "Phạm Thị Dung", role: "KITCHEN" as const, pin: "4567" },
];

/**
 * ข้อมูลผู้ขายที่ต้องขึ้นบนใบเสร็จ (บทที่ 12)
 *
 * เป็นข้อมูลสมมติสำหรับ dev — ก่อนใช้งานจริงต้องแก้เป็นของร้านจริง
 * และ **ต้องให้ผู้สอบบัญชี/เจ้าหน้าที่ภาษีตรวจรูปแบบใบก่อน** เนื้อหาภาษีในโปรเจกต์นี้
 * ไม่ใช่คำแนะนำทางกฎหมาย
 *
 * MST เวียดนาม 10 หลัก — ไม่ขึ้นบนใบของสาขา VND อยู่แล้ว (receipt-issue.ts ตัด
 * เลขผู้เสียภาษีทิ้งสำหรับเอกสารที่ไม่ใช่ใบกำกับภาษีอย่างย่อของไทย)
 *
 * หมายเหตุ: Receipt snapshot ค่าพวกนี้ไว้ในแถวของตัวเองตอนออกใบ
 * แก้ที่นี่แล้วใบที่ออกไปก่อนหน้าไม่เปลี่ยนตาม ซึ่งเป็นพฤติกรรมที่ต้องการ
 */
const SELLER = {
  tenantName: "Nhà hàng Sen Vàng",
  branchName: "Chi nhánh trung tâm",
  taxId: "0312345678",
  addressLine: "128 Nguyễn Huệ, Quận 1, TP. Hồ Chí Minh",
  phone: "028 3822 1234",
  receiptFooter: "Cảm ơn quý khách — hẹn gặp lại!",
};

/** ชุดเอกสารที่ต้องมีตัวเดินเลขพร้อมใช้ตั้งแต่วินาทีแรกของสาขา */
const DOCUMENT_SERIES = ["ABB"] as const;

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { id: "seed-tenant" },
    update: { taxId: SELLER.taxId },
    create: {
      id: "seed-tenant",
      name: SELLER.tenantName,
      taxId: SELLER.taxId,
    },
  });

  const branch = await prisma.branch.upsert({
    where: { tenantId_code: { tenantId: tenant.id, code: "HQ" } },
    /**
     * ⚠ `update` ไม่แตะสกุลเงิน/timezone/อัตราโดยตั้งใจ — สาขาที่เคยรับเงินแล้ว
     * สลับสกุลไม่ได้ (ยอดทุกคอลัมน์เป็นหน่วยย่อยของสกุลเดิม) ฐานเก่าที่ยังเป็นบาท
     * ต้อง `npm run db:reset` แล้ว seed ใหม่ ไม่ใช่ให้ seed ไปเขียนทับ (ดูคำเตือนท้าย main)
     */
    update: { addressLine: SELLER.addressLine, phone: SELLER.phone },
    create: {
      tenantId: tenant.id,
      code: "HQ",
      name: SELLER.branchName,
      addressLine: SELLER.addressLine,
      phone: SELLER.phone,
      receiptFooter: SELLER.receiptFooter,
      // 500 basis point = phí phục vụ 5% — จำนวนเต็มเสมอ ห้าม float
      // **จงใจไม่ใช่ 0** — 0 จะลบความต่างระหว่างนั่งกินกับซื้อกลับที่ chargesServiceCharge()
      // มีไว้เพื่อสิ่งนี้ แล้วเทสต์ที่ตรึงเรื่องนั้นจะกลายเป็นเทสต์เปล่า
      serviceChargeBp: 500,
      // VAT 8% — อัตราลดของเวียดนามที่ครอบอาหาร/เครื่องดื่ม (อัตรามาตรฐานคือ 10%)
      vatRateBp: 800,
      /**
       * เมนูนั่งทานของเวียดนามส่วนใหญ่เขียน "giá chưa bao gồm VAT và phí phục vụ"
       * = ราคายังไม่รวม VAT → calculateBill() เดินเส้นทาง "บวกเพิ่ม" ซึ่งเป็นคนละสูตร
       * กับเส้นทาง "ถอดออก" ที่สาขาไทยเดิมใช้ · อยากได้ราคารวมทุกอย่างในตัวเลขเดียว
       * ให้พลิกค่านี้เป็น true ฟิลด์เดียว สูตรรองรับทั้งสองทางอยู่แล้ว
       */
      pricesIncludeVat: false,
      /**
       * ⚠ VND ไม่มีหน่วยย่อย — 45000 คือ 45.000 ₫ ราคาทุกตัวข้างบนเป็นดองเต็มจำนวน
       * เขียนไว้ตรง ๆ เพราะสกุลเงินเป็นสิ่งที่ "ต้องตั้งใจเลือก" ไม่ใช่ค่าที่ปล่อยผ่าน
       */
      currency: "VND",
      /**
       * ⚠ ตัวนี้ลืมง่ายที่สุดในไฟล์ — timezone คุม branchDayKey() ซึ่งใช้ทั้งกับ
       * เลขบิลรายวัน (orderNumber) และ unique key ของเลขคิว [branchId, queueDay, queueNumber]
       * ทิ้งไว้เป็นเวลาไทยแล้ววันจะตัดผิดชั่วโมง (เวียดนามกับไทยเวลาเดียวกันก็จริง
       * แต่ชื่อโซนต้องถูก — รายงานและเอกสารแสดงชื่อโซนนี้)
       */
      timezone: "Asia/Ho_Chi_Minh",
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
      `seeded tenant=${tenant.name} branch=${branch.code} (${branch.id}) ${branch.currency} ${branch.timezone}`,
      `  stations=${STATIONS.length} categories=${CATEGORIES.length} items=${MENU_ITEMS.length}`,
      `  modifierGroups=${MODIFIER_GROUPS.length} tables=${TABLES.length} staff=${STAFF.length}`,
      `  ลองเปิดหน้าลูกค้าที่ /t/${TABLES[0].tableCode}`,
      `  PIN พนักงาน dev: ${STAFF.map((s) => `${s.code}=${s.pin}`).join(" ")}`,
    ].join("\n"),
  );

  // ฐานเก่าที่สร้างก่อนเปลี่ยนเป็นร้านเวียดนาม — upsert ไม่เขียนทับสกุลเงิน (ดูเหตุผลข้างบน)
  // ราคาเมนูใหม่เป็นดองเต็มจำนวน ถ้าสาขายังเป็นบาท 65000 จะกลายเป็น ฿650.00
  if (branch.currency !== "VND") {
    console.warn(
      `\n⚠ สาขานี้ยังเป็น ${branch.currency} แต่ราคาใน seed เป็นดอง — สั่ง npm run db:reset ` +
        "แล้ว npx prisma migrate dev และ npm run db:seed ใหม่",
    );
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
