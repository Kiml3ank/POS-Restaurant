import "dotenv/config";

import { randomBytes } from "node:crypto";

import { branchDayKey } from "@/lib/branch-day";
import { dailyOrderNumber, orderNumberDay } from "@/lib/order-number";
import { addToCart, getCart, getPlacedOrders, placeOrder, setCartLineQuantity } from "@/lib/server/cart";
import { prisma } from "@/lib/server/db";

function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) process.exitCode = 1;
}

async function main() {
  const table = await prisma.restaurantTable.findUniqueOrThrow({
    where: { tableCode: "a1x7qk" },
    include: { branch: true },
  });

  const session = await prisma.tableSession.create({
    data: {
      branchId: table.branchId,
      tableId: table.id,
      token: `smoke-${randomBytes(8).toString("hex")}`,
      pax: 2,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });

  const base = {
    tableSessionId: session.id,
    branchId: table.branchId,
    tableId: table.id,
    timezone: table.branch.timezone,
  };

  // 1. เมนูที่มีกลุ่ม required แต่ไม่เลือกอะไรเลย ต้องถูกปฏิเสธ
  const missing = await addToCart({
    ...base,
    menuItemId: "seed-item-krapao",
    quantity: 1,
    modifierIds: [],
    note: null,
  });
  check("required group ไม่เลือก => error", !missing.ok, missing.ok ? "" : missing.errorKey);

  // 2. ส่ง modifier ของเมนูอื่นเข้ามา ต้องถูกปฏิเสธ
  const foreign = await addToCart({
    ...base,
    menuItemId: "seed-item-krapao",
    quantity: 1,
    modifierIds: ["seed-mod-spice-mild", "seed-mod-size-regular", "seed-mod-sweet-0"],
    note: null,
  });
  check("modifier ข้ามเมนู => error", !foreign.ok, foreign.ok ? "" : foreign.errorKey);

  // 3. ท็อปปิ้งเกิน maxSelect (3) ต้องถูกปฏิเสธ -> ใส่ 3 ตัวพอดีต้องผ่าน
  const ok1 = await addToCart({
    ...base,
    menuItemId: "seed-item-krapao",
    quantity: 2,
    modifierIds: ["seed-mod-spice-hot", "seed-mod-size-large", "seed-mod-top-egg"],
    note: "  ไม่ใส่ผักชี  ",
  });
  check("ใส่ตะกร้าถูกกฎ => ok", ok1.ok, ok1.ok ? "" : ok1.errorKey);

  // 4. ใส่ซ้ำเป๊ะ ๆ ต้องรวมบรรทัดเดิม ไม่ใช่เพิ่มบรรทัดใหม่
  await addToCart({
    ...base,
    menuItemId: "seed-item-krapao",
    quantity: 1,
    modifierIds: ["seed-mod-spice-hot", "seed-mod-size-large", "seed-mod-top-egg"],
    note: "ไม่ใส่ผักชี",
  });

  // 5. เมนูไม่มีตัวเลือกเลย
  await addToCart({
    ...base,
    menuItemId: "seed-item-water",
    quantity: 2,
    modifierIds: [],
    note: null,
  });

  const cart = await getCart(session.id);
  check("ตะกร้ามี 2 บรรทัด", cart?.items.length === 2, `ได้ ${cart?.items.length}`);

  const krapao = cart!.items.find((item) => item.menuItemId === "seed-item-krapao")!;
  check("รวมบรรทัดซ้ำเป็น qty 3", krapao.quantity === 3, `ได้ ${krapao.quantity}`);
  check("trim หมายเหตุ", krapao.note === "ไม่ใส่ผักชี", `ได้ ${JSON.stringify(krapao.note)}`);
  // 6000 (กะเพรา) + 2000 (พิเศษ) + 1500 (ไข่ดาว) = 9500 สตางค์ ต่อหน่วย
  check("modifierTotal = 3500", krapao.modifierTotal === 3500, `ได้ ${krapao.modifierTotal}`);
  check("lineTotal = 9500 x 3", krapao.lineTotal === 28500, `ได้ ${krapao.lineTotal}`);
  // 28500 + น้ำเปล่า 2000 x 2 = 32500
  check("subtotal = 32500", cart!.subtotal === 32500, `ได้ ${cart!.subtotal}`);
  check("orderNumber มีรูปแบบ YYYYMMDD-NNNN", /^\d{8}-\d{4}$/.test(cart!.orderNumber), cart!.orderNumber);

  // 6. แก้จำนวน แล้วลบทิ้ง
  const water = cart!.items.find((item) => item.menuItemId === "seed-item-water")!;
  await setCartLineQuantity(session.id, water.id, 1);
  await setCartLineQuantity(session.id, krapao.id, 0);
  const afterEdit = await getCart(session.id);
  check("ลบบรรทัดแล้วเหลือ 1 บรรทัด", afterEdit?.items.length === 1, `ได้ ${afterEdit?.items.length}`);
  check("subtotal คิดใหม่ = 2000", afterEdit!.subtotal === 2000, `ได้ ${afterEdit!.subtotal}`);

  // 7. แก้บรรทัดของ session อื่นไม่ได้
  const stranger = await setCartLineQuantity("ไม่มี-session-นี้", afterEdit!.items[0].id, 5);
  check("แก้ตะกร้าข้าม session => error", !stranger.ok, stranger.ok ? "" : stranger.errorKey);

  // 8. ส่งเข้าครัว แล้วกดซ้ำสองครั้งพร้อมกัน ต้องไม่เกิดบิลซ้ำ
  const [first, second] = await Promise.all([placeOrder(session.id), placeOrder(session.id)]);
  check("placeOrder ครั้งที่ 1 ok", first.ok, first.ok ? String(first.data.orderNumber) : first.errorKey);
  check(
    "placeOrder ซ้ำพร้อมกัน ไม่ error และไม่สร้างบิลใหม่",
    second.ok && first.ok && (second.data.orderNumber === null || second.data.orderNumber === first.data.orderNumber),
    second.ok ? String(second.data.orderNumber) : second.errorKey,
  );

  const placed = await getPlacedOrders(session.id);
  check("มีบิลที่ส่งแล้ว 1 ใบ", placed.length === 1, `ได้ ${placed.length}`);
  /**
   * ถึงตรงนี้ในตะกร้าเหลือแค่ "น้ำเปล่า" (กะเพราถูกลบไปในเคสที่ 6) ซึ่งเป็นเมนู
   * ที่ `stationId = null` — ไม่ต้องผ่านครัว
   *
   * ตั้งแต่บทที่ 8 ของแบบนี้จะข้ามไป READY ตั้งแต่วินาทีที่กดส่ง ไม่ใช่ PLACED
   * เพราะมันไม่ขึ้นจอครัวเลย จึงไม่มีใครกดเปลี่ยนสถานะให้มันได้ ถ้าปล่อยเป็น
   * PLACED บิลจะค้างไม่มีวันถึง SERVED แล้วคิดเงินไม่ได้ในบทที่ 10
   * (ดู placeOrder ใน lib/server/cart.ts และเคสเต็มใน npm run smoke:kds)
   */
  check("สถานะบิลที่มีแต่ของหยิบเอง = READY", placed[0]?.status === "READY", placed[0]?.status);
  check(
    "รายการที่ไม่ผูกสถานีครัว = READY ทันที",
    placed[0]?.items.every((item) => item.status === "READY") ?? false,
    placed[0]?.items.map((item) => `${item.nameSnapshot}:${item.status}`).join(", "),
  );
  check("placedAt ถูกเซ็ต", placed[0]?.placedAt !== null);
  check("ตะกร้าว่างหลังส่ง", (await getCart(session.id)) === null);

  // 9. สั่งเพิ่มหลังส่งแล้ว ต้องได้บิลใบใหม่คนละเลข
  await addToCart({ ...base, menuItemId: "seed-item-water", quantity: 1, modifierIds: [], note: null });
  const secondCart = await getCart(session.id);
  check(
    "สั่งเพิ่ม = บิลใบใหม่ เลขไม่ซ้ำ",
    !!secondCart && secondCart.orderNumber !== placed[0].orderNumber,
    `${placed[0].orderNumber} -> ${secondCart?.orderNumber}`,
  );

  console.log("\n── เลขที่บิลที่คนอ่าน ─────────────────────────────────────────────\n");

  /**
   * เลขในฐานเป็น "YYYYMMDD-NNNN" เพื่อกันซ้ำข้ามวันและใช้ทำรายงาน แต่คนพูดถึงบิล
   * ว่า "บิลที่ 7" — สองอย่างนี้ต้องแยกกัน และจอทุกจอต้องแสดงผ่าน
   * dailyOrderNumber() ไม่ใช่พิมพ์ค่าดิบออกไป
   */
  check(
    "เลขที่คนอ่าน = ตัดวันและศูนย์นำหน้าออก",
    dailyOrderNumber("20260824-0007") === "7",
    dailyOrderNumber("20260824-0007"),
  );
  check("บิลใบแรกของวันคือ 1 ไม่ใช่ 0", dailyOrderNumber("20260824-0001") === "1");
  check("เลขสามหลักไม่ถูกตัดผิด", dailyOrderNumber("20260824-0123") === "123");
  check("เลขเกินสี่หลักยังอ่านได้", dailyOrderNumber("20260824-12345") === "12345");
  check(
    "คนละวันใช้เลขเดียวกันได้ (รีเซ็ตทุกวันตามที่ตั้งใจ)",
    dailyOrderNumber("20260824-0003") === dailyOrderNumber("20260825-0003"),
  );
  check(
    "ค่าที่ไม่ตรงรูปแบบคืนทั้งก้อน ไม่ใช่หายไปจากจอ",
    dailyOrderNumber("LEGACY-7") === "LEGACY-7" && dailyOrderNumber("") === "",
  );
  check("อ่านวันของบิลจากเลขที่ได้", orderNumberDay("20260824-0007") === "20260824");
  check("รูปแบบแปลก ๆ คืนวันเป็น null ไม่ใช่เดา", orderNumberDay("LEGACY-7") === null);

  /**
   * เลขจริงจากฐาน — เทสต์นี้จะแดงทันทีถ้าใครเปลี่ยนรูปแบบของ nextOrderNumber()
   * โดยลืมว่ามีห้าจอที่แปลค่านี้ให้คนอ่าน
   */
  const todayPrefix = branchDayKey(table.branch.timezone);
  check(
    "เลขบิลจริงขึ้นต้นด้วยวันของสาขา",
    placed[0].orderNumber.startsWith(`${todayPrefix}-`),
    placed[0].orderNumber,
  );
  check(
    "เลขลำดับที่คนอ่านเป็นจำนวนเต็มบวก",
    Number.parseInt(dailyOrderNumber(placed[0].orderNumber), 10) >= 1,
    `#${dailyOrderNumber(placed[0].orderNumber)}`,
  );

  // ล้างข้อมูลที่สร้างระหว่างทดสอบ
  await prisma.order.deleteMany({ where: { tableSessionId: session.id } });
  await prisma.tableSession.delete({ where: { id: session.id } });
  await prisma.restaurantTable.update({ where: { id: table.id }, data: { status: "AVAILABLE" } });
  console.log("cleanup done");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
