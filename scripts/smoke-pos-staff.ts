import "dotenv/config";

import { canAccessScreen, canCancelOrderItem } from "@/lib/rbac";
import { addToCart, getCart, placeOrder } from "@/lib/server/cart";
import { prisma } from "@/lib/server/db";
import { hashPin, verifyPin } from "@/lib/server/pin";
import {
  cancelOrderItemByStaff,
  closeTableSession,
  getPosTable,
  getPosTables,
  openTableByStaff,
} from "@/lib/server/pos";
import type { CurrentStaff } from "@/lib/server/staff-session";

/**
 * Smoke test ของเครื่องพนักงาน (บทที่ 9) — รันกับ dev DB จริง แล้วลบข้อมูลที่สร้างทิ้งเอง
 *
 *     npm run smoke:pos
 *
 * ทำไมไม่ทดสอบ loginStaff()/getCurrentStaff() ตรง ๆ: สองตัวนั้นเรียก `cookies()`
 * ของ next/headers ซึ่ง throw เมื่อไม่มี request context ของ Next.js —
 * สคริปต์นี้จึงทดสอบชั้นที่อยู่ใต้ลงไปแทน (hashPin/verifyPin + ฟังก์ชันใน pos.ts
 * ที่รับ `staff` เป็นพารามิเตอร์อยู่แล้ว) ส่วนตัว cookie ทดสอบด้วยมือผ่านเบราว์เซอร์
 *
 * ใช้โต๊ะ B1/B2 ไม่ใช่ A1 เพื่อไม่ชนกับ `npm run smoke:order` และหน้าที่เปิดค้างไว้ที่ /t/a1x7qk
 */

const MAIN_TABLE_ID = "seed-table-b1";
const CLOSE_TABLE_ID = "seed-table-b2";
const OTHER_BRANCH_ID = "ไม่มีสาขานี้";

function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) process.exitCode = 1;
}

/** พนักงานที่ล็อกอินแล้ว — รูปร่างเดียวกับที่ getCurrentStaff() คืนออกมา */
async function loadStaff(id: string): Promise<CurrentStaff> {
  return prisma.staff.findUniqueOrThrow({ where: { id }, include: { branch: true } });
}

/** ล้างรอบโต๊ะ+บิล+AuditLog ของโต๊ะที่ใช้ทดสอบ ให้กลับไปเป็นโต๊ะว่าง (dev DB เท่านั้น) */
async function resetTables(tableIds: string[]) {
  const sessions = await prisma.tableSession.findMany({
    where: { tableId: { in: tableIds } },
    select: { id: true, orders: { select: { id: true } } },
  });

  const sessionIds = sessions.map((session) => session.id);
  const orderIds = sessions.flatMap((session) => session.orders.map((order) => order.id));
  const itemIds = orderIds.length
    ? (await prisma.orderItem.findMany({ where: { orderId: { in: orderIds } }, select: { id: true } })).map(
        (item) => item.id,
      )
    : [];

  await prisma.auditLog.deleteMany({ where: { entityId: { in: [...sessionIds, ...itemIds] } } });
  await prisma.order.deleteMany({ where: { tableSessionId: { in: sessionIds } } });
  // ต้องลบหลัง Order (Order → Payment เป็น Restrict) และก่อน TableSession
  // (Payment → TableSession เป็น Restrict) — บทที่ 11
  // ใบเสร็จต้องถูกลบก่อนการรับเงิน — Receipt.paymentId เป็น Restrict (บทที่ 12)
  const paymentIds = (
    await prisma.payment.findMany({
      where: { tableSessionId: { in: sessionIds } },
      select: { id: true },
    })
  ).map((payment) => payment.id);
  await prisma.receipt.deleteMany({ where: { paymentId: { in: paymentIds } } });
  await prisma.payment.deleteMany({ where: { tableSessionId: { in: sessionIds } } });
  await prisma.tableSession.deleteMany({ where: { id: { in: sessionIds } } });
  await prisma.restaurantTable.updateMany({
    where: { id: { in: tableIds } },
    data: { status: "AVAILABLE" },
  });
}

async function main() {
  const owner = await loadStaff("seed-staff-owner");
  const server = await loadStaff("seed-staff-server");
  const branchId = owner.branchId;

  /** id ของสิ่งที่ถูกเขียน AuditLog ระหว่างทดสอบ — เก็บไว้ล้างตอนจบ */
  const auditedEntityIds: string[] = [];

  // เริ่มจากโต๊ะว่างเสมอ: ถ้ารอบก่อนหน้าถูกขัดจังหวะกลางคัน (หรือมีคนเปิดโต๊ะนี้
  // ค้างไว้ตอนทดสอบด้วยมือ) openTableByStaff() จะ "เข้าร่วมรอบเดิม" ตามดีไซน์
  // แล้วยอดที่ค้างอยู่จะทำให้เคสที่เช็คตัวเลขพังทั้งชุด
  await resetTables([MAIN_TABLE_ID, CLOSE_TABLE_ID]);

  // ── 1. PIN ────────────────────────────────────────────────────────────────
  const hash = hashPin("1234");
  check("verifyPin PIN ถูก => true", verifyPin("1234", hash));
  check("verifyPin PIN ผิด => false", !verifyPin("9999", hash));
  check("hashPin สุ่ม salt ใหม่ทุกครั้ง", hashPin("1234") !== hash);
  check("hash รูปแบบพัง => false ไม่ throw", !verifyPin("1234", "ไม่ใช่ hash"));
  check(
    "PIN ของ seed ตรงกับที่เอกสารบอก (001=1234)",
    verifyPin("1234", (await loadStaff("seed-staff-owner")).pinHash),
  );

  // ── 2. RBAC ───────────────────────────────────────────────────────────────
  check("ครัวเข้าหน้า POS ไม่ได้", !canAccessScreen("KITCHEN", "pos"));
  check("เสิร์ฟเข้าหน้า POS ได้", canAccessScreen("SERVER", "pos"));
  check("เสิร์ฟยกเลิกรายการเองไม่ได้", !canCancelOrderItem("SERVER"));
  check("ผู้จัดการยกเลิกรายการได้", canCancelOrderItem("MANAGER"));

  // ── 3. เปิดโต๊ะ ───────────────────────────────────────────────────────────
  const tooFew = await openTableByStaff(owner, MAIN_TABLE_ID, 0);
  check("pax = 0 => error", !tooFew.ok, tooFew.ok ? "" : tooFew.error);

  const tooMany = await openTableByStaff(owner, MAIN_TABLE_ID, 51);
  check("pax = 51 => error", !tooMany.ok, tooMany.ok ? "" : tooMany.error);

  const foreignStaff: CurrentStaff = { ...owner, branchId: OTHER_BRANCH_ID };
  const foreignTable = await openTableByStaff(foreignStaff, MAIN_TABLE_ID, 2);
  check("เปิดโต๊ะข้ามสาขา => error", !foreignTable.ok, foreignTable.ok ? "" : foreignTable.error);

  const opened = await openTableByStaff(owner, MAIN_TABLE_ID, 4);
  check("เปิดโต๊ะถูกกฎ => ok", opened.ok, opened.ok ? opened.session.id : opened.error);
  if (!opened.ok) throw new Error("เปิดโต๊ะไม่สำเร็จ ทดสอบต่อไม่ได้");
  const sessionId = opened.session.id;

  check("บันทึกว่าใครเป็นคนเปิดโต๊ะ", opened.session.openedByStaffId === owner.id);
  check(
    "โต๊ะเปลี่ยนเป็น OCCUPIED",
    (await prisma.restaurantTable.findUniqueOrThrow({ where: { id: MAIN_TABLE_ID } })).status ===
      "OCCUPIED",
  );

  const joinedUp = await openTableByStaff(owner, MAIN_TABLE_ID, 6);
  check(
    "กดเปิดซ้ำ = เข้าร่วมรอบเดิม ไม่สร้างรอบใหม่",
    joinedUp.ok && joinedUp.session.id === sessionId,
  );
  check("pax เพิ่มขึ้นได้", joinedUp.ok && joinedUp.session.pax === 6);

  const joinedDown = await openTableByStaff(owner, MAIN_TABLE_ID, 2);
  check("pax ไม่ถูกลดโดยคนที่กดทีหลัง", joinedDown.ok && joinedDown.session.pax === 6);

  // ── 4. ผังโต๊ะ ────────────────────────────────────────────────────────────
  const table = await prisma.restaurantTable.findUniqueOrThrow({
    where: { id: MAIN_TABLE_ID },
    include: { branch: true },
  });

  const tablesBefore = await getPosTables(branchId);
  const cardBefore = tablesBefore.find((row) => row.id === MAIN_TABLE_ID);
  check("ผังโต๊ะเห็นโต๊ะที่เพิ่งเปิด", cardBefore?.session?.id === sessionId);
  check("ยังไม่มีของ => runningTotal = 0", cardBefore?.runningTotal === 0, `ได้ ${cardBefore?.runningTotal}`);

  check("getPosTable ข้ามสาขา => null", (await getPosTable(OTHER_BRANCH_ID, MAIN_TABLE_ID)) === null);
  check("getPosTable โต๊ะที่ไม่มีจริง => null", (await getPosTable(branchId, "ไม่มีโต๊ะนี้")) === null);

  // ── 5. สั่งแทนลูกค้า ──────────────────────────────────────────────────────
  const orderLine = {
    tableSessionId: sessionId,
    branchId,
    tableId: table.id,
    timezone: table.branch.timezone,
  };

  const added = await addToCart({
    ...orderLine,
    menuItemId: "seed-item-water",
    quantity: 2,
    modifierIds: [],
    note: null,
  });
  check("พนักงานสั่งแทนลูกค้าลงตะกร้าเดียวกัน => ok", added.ok, added.ok ? "" : added.error);

  // ชาเย็นผูกกับ "บาร์น้ำ" ส่วนน้ำเปล่าไม่ผูกสถานี — คู่นี้คือของที่ KDS บทที่ 8
  // ต้องแยกให้ถูก โดยอ่านจาก stationId ที่ snapshot ไว้ตอนสั่ง ไม่ใช่ join เมนูสด
  const addedTea = await addToCart({
    ...orderLine,
    menuItemId: "seed-item-thai-tea",
    quantity: 1,
    modifierIds: ["seed-mod-sweet-50", "seed-mod-size-regular"],
    note: null,
  });
  check("สั่งเมนูที่มีตัวเลือกบังคับ => ok", addedTea.ok, addedTea.ok ? "" : addedTea.error);

  const tablesWithDraft = await getPosTables(branchId);
  const cardDraft = tablesWithDraft.find((row) => row.id === MAIN_TABLE_ID);
  check("ผังโต๊ะขึ้นว่ามีตะกร้าค้าง", cardDraft?.draftCount === 1, `ได้ ${cardDraft?.draftCount}`);
  // น้ำเปล่า 2000 x 2 + ชาเย็น 4500 (ตัวเลือกไม่มีส่วนต่างราคา) = 8500 สตางค์
  check("runningTotal = 8500", cardDraft?.runningTotal === 8500, `ได้ ${cardDraft?.runningTotal}`);

  const placed = await placeOrder(sessionId);
  check("ส่งเข้าครัว => ok", placed.ok, placed.ok ? String(placed.data.orderNumber) : placed.error);
  check("ตะกร้าว่างหลังส่ง", (await getCart(sessionId)) === null);

  const tablesPlaced = await getPosTables(branchId);
  const cardPlaced = tablesPlaced.find((row) => row.id === MAIN_TABLE_ID);
  /**
   * บิลนี้มีน้ำเปล่า 2 ขวด (ไม่ผูกสถานีครัว) + ชาเย็น 1 แก้ว (บาร์น้ำ)
   *
   * ตั้งแต่บทที่ 8 ทั้งสองอย่างแยกทางกันตั้งแต่วินาทีที่กดส่ง:
   *   - ชาเย็น  → PLACED  รอครัวรับ  → นับเป็น pendingItems
   *   - น้ำเปล่า → READY   รอคนไปหยิบ → นับเป็น readyItems
   *
   * ตัวเลขคู่นี้คือสิ่งที่พนักงานเสิร์ฟอ่านจากผังโต๊ะ การที่น้ำเปล่าเด้งขึ้น
   * readyItems ทันทีจึงถูกแล้ว — มีของรอยกอยู่จริงตั้งแต่วินาทีนั้น
   */
  check("ผังโต๊ะนับของที่ครัวกำลังทำ = 1 ชิ้น (ชาเย็น)", cardPlaced?.pendingItems === 1, `ได้ ${cardPlaced?.pendingItems}`);
  check(
    "ผังโต๊ะนับของพร้อมเสิร์ฟ = 2 ชิ้น (น้ำเปล่าที่หยิบเองได้เลย)",
    cardPlaced?.readyItems === 2,
    `ได้ ${cardPlaced?.readyItems}`,
  );
  check("ตะกร้าค้างหายไปจากผังโต๊ะ", cardPlaced?.draftCount === 0);

  const detail = await getPosTable(branchId, MAIN_TABLE_ID);
  check("หน้าโต๊ะเห็นบิล 1 ใบ", detail?.orders.length === 1, `ได้ ${detail?.orders.length}`);
  check("บิลมี 2 บรรทัด", detail?.orders[0]?.items.length === 2, `ได้ ${detail?.orders[0]?.items.length}`);

  const waterLine = detail!.orders[0].items.find((item) => item.menuItemId === "seed-item-water")!;
  const teaLine = detail!.orders[0].items.find((item) => item.menuItemId === "seed-item-thai-tea")!;

  // ฐานของ KDS บทที่ 8: สถานีถูก snapshot ลงบรรทัดตั้งแต่ตอนสั่ง
  check("ชาเย็น snapshot สถานี = บาร์น้ำ", teaLine.stationId === "seed-station-bar", `ได้ ${teaLine.stationId}`);
  check("อ่านชื่อสถานีได้โดยไม่ต้อง join เมนูสด", teaLine.station?.name === "บาร์น้ำ", teaLine.station?.name);
  check("น้ำเปล่าไม่ผูกสถานี => ไม่ขึ้นจอครัว", waterLine.stationId === null, `ได้ ${waterLine.stationId}`);
  check("บรรทัดเก็บตัวเลือกที่เลือกไว้", teaLine.modifiers.length === 2, `ได้ ${teaLine.modifiers.length}`);

  const orderItemId = waterLine.id;

  // ── 6. ยกเลิกรายการ ───────────────────────────────────────────────────────
  const byServer = await cancelOrderItemByStaff(server, orderItemId, "ลูกค้าเปลี่ยนใจ");
  check("เสิร์ฟกดยกเลิกเอง => error", !byServer.ok, byServer.ok ? "" : byServer.error);

  const noReason = await cancelOrderItemByStaff(owner, orderItemId, "  x  ");
  check("ยกเลิกโดยไม่กรอกเหตุผล => error", !noReason.ok, noReason.ok ? "" : noReason.error);

  const crossBranch = await cancelOrderItemByStaff(foreignStaff, orderItemId, "ลองข้ามสาขา");
  check("ยกเลิกรายการข้ามสาขา => error", !crossBranch.ok, crossBranch.ok ? "" : crossBranch.error);

  const cancelled = await cancelOrderItemByStaff(owner, orderItemId, "  ครัวทำน้ำหก  ");
  check("ผู้จัดการ/เจ้าของยกเลิกได้ => ok", cancelled.ok, cancelled.ok ? "" : cancelled.error);
  auditedEntityIds.push(orderItemId);

  const cancelledItem = await prisma.orderItem.findUniqueOrThrow({ where: { id: orderItemId } });
  check("รายการเป็น CANCELLED", cancelledItem.status === "CANCELLED", cancelledItem.status);
  check("เก็บเหตุผลแบบ trim แล้ว", cancelledItem.cancelReason === "ครัวทำน้ำหก", `ได้ ${cancelledItem.cancelReason}`);
  check("บันทึกเวลาที่ยกเลิก", cancelledItem.cancelledAt !== null);

  const afterCancel = await prisma.order.findUniqueOrThrow({ where: { id: cancelledItem.orderId } });
  // 8500 - น้ำเปล่าที่ถูกยกเลิก 4000 = 4500 (เหลือชาเย็น)
  check("subtotal ของบิลถูกคิดใหม่เป็น 4500", afterCancel.subtotal === 4500, `ได้ ${afterCancel.subtotal}`);

  const log = await prisma.auditLog.findFirst({
    where: { entityId: orderItemId, action: "order_item.cancel" },
  });
  check("เขียน AuditLog พร้อมเหตุผลและคนกด", log?.staffId === owner.id, log?.action);
  check(
    "AuditLog เก็บ snapshot ยอดเงิน ณ ตอนกด",
    (log?.metadata as { lineTotal?: number } | null)?.lineTotal === 4000,
  );

  const again = await cancelOrderItemByStaff(owner, orderItemId, "กดซ้ำ");
  check("ยกเลิกรายการเดิมซ้ำ => error", !again.ok, again.ok ? "" : again.error);

  // ── 7. ปิดรอบโต๊ะ ─────────────────────────────────────────────────────────
  const shortReason = await closeTableSession(owner, sessionId, "x");
  check("ปิดรอบโดยไม่กรอกเหตุผล => error", !shortReason.ok, shortReason.ok ? "" : shortReason.error);

  const hasKitchenBill = await closeTableSession(owner, sessionId, "ลูกค้าลุกไปแล้ว");
  check(
    "ปิดรอบที่มีบิลส่งเข้าครัวแล้ว => error (ต้องคิดเงินก่อน)",
    !hasKitchenBill.ok,
    hasKitchenBill.ok ? "" : hasKitchenBill.error,
  );

  // โต๊ะอีกใบ: เปิดแล้วมีแค่ตะกร้าที่ยังไม่ส่ง — เคสเดียวที่ปิดรอบทิ้งได้
  const spare = await openTableByStaff(owner, CLOSE_TABLE_ID, 2);
  if (!spare.ok) throw new Error("เปิดโต๊ะสำรองไม่สำเร็จ");
  const spareSessionId = spare.session.id;

  await addToCart({
    tableSessionId: spareSessionId,
    branchId,
    tableId: CLOSE_TABLE_ID,
    timezone: table.branch.timezone,
    menuItemId: "seed-item-water",
    quantity: 1,
    modifierIds: [],
    note: null,
  });

  const foreignClose = await closeTableSession(foreignStaff, spareSessionId, "ลองข้ามสาขา");
  check("ปิดรอบข้ามสาขา => error", !foreignClose.ok, foreignClose.ok ? "" : foreignClose.error);

  const closed = await closeTableSession(owner, spareSessionId, "  เปิดโต๊ะผิดใบ  ");
  check("ปิดรอบที่มีแค่ตะกร้า => ok", closed.ok, closed.ok ? "" : closed.error);
  auditedEntityIds.push(spareSessionId);

  const closedSession = await prisma.tableSession.findUniqueOrThrow({ where: { id: spareSessionId } });
  check("รอบเป็น ABANDONED", closedSession.status === "ABANDONED", closedSession.status);
  check("บันทึกเวลาปิดรอบ", closedSession.closedAt !== null);
  check(
    "โต๊ะกลับเป็น AVAILABLE",
    (await prisma.restaurantTable.findUniqueOrThrow({ where: { id: CLOSE_TABLE_ID } })).status ===
      "AVAILABLE",
  );
  check(
    "ตะกร้าที่ยังไม่ส่งถูกลบไปพร้อมรอบ",
    (await prisma.order.count({ where: { tableSessionId: spareSessionId } })) === 0,
  );
  check(
    "เขียน AuditLog ตอนปิดรอบ",
    (await prisma.auditLog.count({
      where: { entityId: spareSessionId, action: "table_session.abandon", staffId: owner.id },
    })) === 1,
  );

  const closeTwice = await closeTableSession(owner, spareSessionId, "กดซ้ำ");
  check("ปิดรอบเดิมซ้ำ => error", !closeTwice.ok, closeTwice.ok ? "" : closeTwice.error);

  // ── ล้างข้อมูลที่สร้างระหว่างทดสอบ ────────────────────────────────────────
  // AuditLog ห้าม update/delete จาก "โค้ดแอป" — สคริปต์ทดสอบเก็บกวาดของตัวเอง
  // ในฐาน dev เป็นคนละเรื่องกัน และดีกว่าปล่อยขยะค้างจนอ่านของจริงไม่ออก
  await prisma.auditLog.deleteMany({ where: { entityId: { in: auditedEntityIds } } });
  await resetTables([MAIN_TABLE_ID, CLOSE_TABLE_ID]);
  console.log("cleanup done");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
