import "dotenv/config";

import { randomBytes } from "node:crypto";

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
  check("required group ไม่เลือก => error", !missing.ok, missing.ok ? "" : missing.error);

  // 2. ส่ง modifier ของเมนูอื่นเข้ามา ต้องถูกปฏิเสธ
  const foreign = await addToCart({
    ...base,
    menuItemId: "seed-item-krapao",
    quantity: 1,
    modifierIds: ["seed-mod-spice-mild", "seed-mod-size-regular", "seed-mod-sweet-0"],
    note: null,
  });
  check("modifier ข้ามเมนู => error", !foreign.ok, foreign.ok ? "" : foreign.error);

  // 3. ท็อปปิ้งเกิน maxSelect (3) ต้องถูกปฏิเสธ -> ใส่ 3 ตัวพอดีต้องผ่าน
  const ok1 = await addToCart({
    ...base,
    menuItemId: "seed-item-krapao",
    quantity: 2,
    modifierIds: ["seed-mod-spice-hot", "seed-mod-size-large", "seed-mod-top-egg"],
    note: "  ไม่ใส่ผักชี  ",
  });
  check("ใส่ตะกร้าถูกกฎ => ok", ok1.ok, ok1.ok ? "" : ok1.error);

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
  check("แก้ตะกร้าข้าม session => error", !stranger.ok, stranger.ok ? "" : stranger.error);

  // 8. ส่งเข้าครัว แล้วกดซ้ำสองครั้งพร้อมกัน ต้องไม่เกิดบิลซ้ำ
  const [first, second] = await Promise.all([placeOrder(session.id), placeOrder(session.id)]);
  check("placeOrder ครั้งที่ 1 ok", first.ok, first.ok ? String(first.data.orderNumber) : first.error);
  check(
    "placeOrder ซ้ำพร้อมกัน ไม่ error และไม่สร้างบิลใหม่",
    second.ok && first.ok && (second.data.orderNumber === null || second.data.orderNumber === first.data.orderNumber),
    second.ok ? String(second.data.orderNumber) : second.error,
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
