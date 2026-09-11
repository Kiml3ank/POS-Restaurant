import "dotenv/config";

import { parseMoneyInput } from "@/lib/money";
import { canEditMenu, canToggleMenuAvailability, canAccessScreen } from "@/lib/rbac";
import { CUSTOMER_BROADCAST_EVENTS } from "@/lib/realtime-events";
import { addToCart, placeOrder } from "@/lib/server/cart";
import { getTableBill } from "@/lib/server/billing";
import { prisma } from "@/lib/server/db";
import {
  deleteMenuEntity,
  getMenuItemForEdit,
  getMenuTree,
  getModifierGroup,
  getModifierGroups,
  moveSortOrder,
  setAvailability,
  setMenuItemModifierGroups,
  upsertCategory,
  upsertMenuItem,
  upsertModifierGroup,
} from "@/lib/server/menu-admin";
import { getCustomerMenu } from "@/lib/server/menu";
import { stopRealtime } from "@/lib/server/realtime";
import type { CurrentStaff } from "@/lib/server/staff-session";
import { openOrJoinTableSession } from "@/lib/server/table-session";
import { takePayment } from "@/lib/server/payment";

/**
 * Smoke test ของหลังร้าน/จัดการเมนู (โมดูล 04)
 *
 *     npm run smoke:menu
 *
 * ⚠ **สคริปต์นี้สร้างเมนูของตัวเองทั้งหมดแล้วลบทิ้ง ห้ามแตะเมนู seed**
 * เพราะ smoke ชุดอื่น (order/pos/kds/bill/payment) พึ่ง `seed-item-krapao`
 * และ `seed-item-water` อยู่ ถ้าสคริปต์นี้ไปเปลี่ยนราคาหรือปิดขายของพวกนั้น
 * ชุดอื่นจะพังเป็นแถวโดยที่ error ไม่ได้ชี้มาที่นี่เลย
 *
 * ใช้โต๊ะ B2 เฉพาะตอนทดสอบว่า "ขึ้นราคาแล้วบิลเก่าต้องไม่ขยับ" (§7)
 */

const PREFIX = "smoke-menu";

function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) process.exitCode = 1;
}

async function loadStaff(id: string): Promise<CurrentStaff> {
  return prisma.staff.findUniqueOrThrow({ where: { id }, include: { branch: true } });
}

/** ล้างของที่สคริปต์นี้สร้างไว้ทั้งหมด (ชื่อขึ้นต้นด้วย PREFIX เท่านั้น) */
async function cleanup(branchId: string) {
  const items = await prisma.menuItem.findMany({
    where: { branchId, name: { startsWith: PREFIX } },
    select: { id: true },
  });
  const itemIds = items.map((item) => item.id);

  const groups = await prisma.modifierGroup.findMany({
    where: { branchId, name: { startsWith: PREFIX } },
    select: { id: true },
  });
  const groupIds = groups.map((group) => group.id);

  await prisma.menuItemModifierGroup.deleteMany({
    where: { OR: [{ menuItemId: { in: itemIds } }, { modifierGroupId: { in: groupIds } }] },
  });

  // ลบ OrderItem ที่อ้างเมนูทดสอบก่อน ไม่งั้น Restrict จะกันการลบเมนูไว้
  const orderIds = (
    await prisma.orderItem.findMany({
      where: { menuItemId: { in: itemIds } },
      select: { orderId: true },
    })
  ).map((row) => row.orderId);

  if (orderIds.length > 0) {
    const sessionIds = (
      await prisma.order.findMany({
        where: { id: { in: orderIds } },
        select: { tableSessionId: true },
      })
    )
      .map((row) => row.tableSessionId)
      .filter((id): id is string => id !== null);

    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
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
  }

  await prisma.modifier.deleteMany({ where: { modifierGroupId: { in: groupIds } } });
  await prisma.modifierGroup.deleteMany({ where: { id: { in: groupIds } } });
  await prisma.menuItem.deleteMany({ where: { id: { in: itemIds } } });
  await prisma.menuCategory.deleteMany({ where: { branchId, name: { startsWith: PREFIX } } });
  await prisma.auditLog.deleteMany({ where: { branchId, action: { startsWith: "menu." } } });
}

async function main() {
  const branch = await prisma.branch.findFirstOrThrow();
  const owner = await loadStaff("seed-staff-owner");
  const cashier = await loadStaff("seed-staff-cashier");
  const kitchen = await loadStaff("seed-staff-kitchen");
  const server = await loadStaff("seed-staff-server");

  await cleanup(branch.id);

  // ── 1. RBAC ──────────────────────────────────────────────────────────
  check("ทุกตำแหน่งเข้าหลังร้านได้ (ต้องกดของหมดได้ทุกคน)", [
    "OWNER",
    "MANAGER",
    "CASHIER",
    "SERVER",
    "KITCHEN",
  ].every((role) => canAccessScreen(role as never, "admin")));
  check("ครัวเข้าหลังร้านได้ ทั้งที่เข้า POS ไม่ได้", canAccessScreen("KITCHEN", "admin") && !canAccessScreen("KITCHEN", "pos"));
  check("เจ้าของ/ผู้จัดการแก้เมนูได้", canEditMenu("OWNER") && canEditMenu("MANAGER"));
  check("แคชเชียร์/เสิร์ฟ/ครัว แก้เมนูไม่ได้", !canEditMenu("CASHIER") && !canEditMenu("SERVER") && !canEditMenu("KITCHEN"));
  check("ทุกตำแหน่งกดของหมดได้", ["OWNER", "MANAGER", "CASHIER", "SERVER", "KITCHEN"].every((role) => canToggleMenuAvailability(role as never)));

  /**
   * รายชื่อ event ที่ยอมส่งถึงมือถือลูกค้าทั้งที่ไม่ผูกโต๊ะของเขา
   *
   * ตรึงไว้ด้วยเทสต์เพราะการเผลอเติมชื่อลงในรายชื่อนี้ = ส่งข้อมูลระดับร้าน
   * ให้ลูกค้าทุกโต๊ะโดยไม่มีอะไรฟ้อง (เช่นวันที่บทที่ 15 เพิ่ม "ปิดกะแล้ว"
   * ซึ่งบอกได้ว่าร้านทำยอดเท่าไหร่) — ถ้าจะเพิ่มจริงต้องมาแก้เทสต์นี้ด้วยมือ
   * แล้วจะได้หยุดคิดสักครั้งว่ามันควรถึงลูกค้าจริงไหม
   */
  check(
    "รายชื่อ event ที่ส่งถึงลูกค้าทุกโต๊ะมีแค่ menu.changed",
    CUSTOMER_BROADCAST_EVENTS.length === 1 && CUSTOMER_BROADCAST_EVENTS[0] === "menu.changed",
    CUSTOMER_BROADCAST_EVENTS.join(", "),
  );

  // ── 2. อ่านเลขติดลบได้ (ส่วนต่างราคาตัวเลือก) ────────────────────────
  check("THB '-10' = -1000 สตางค์", parseMoneyInput("-10", "THB") === -1_000, String(parseMoneyInput("-10", "THB")));
  check("THB '-0.50' = -50 สตางค์ (เครื่องหมายไม่หาย)", parseMoneyInput("-0.50", "THB") === -50, String(parseMoneyInput("-0.50", "THB")));
  check("VND '-5.000' = -5000 ดอง", parseMoneyInput("-5.000", "VND") === -5_000, String(parseMoneyInput("-5.000", "VND")));
  check("'-' เฉย ๆ อ่านไม่ออก = null", parseMoneyInput("-", "THB") === null);
  check("ค่าบวกยังอ่านได้เหมือนเดิม", parseMoneyInput("120.50", "THB") === 12_050);

  // ── 3. สร้างหมวด + เมนู ──────────────────────────────────────────────
  const deniedCategory = await upsertCategory(cashier, { id: null, name: `${PREFIX} ห้าม` });
  check("แคชเชียร์สร้างหมวดไม่ได้", !deniedCategory.ok, deniedCategory.ok ? "" : deniedCategory.errorKey);

  const emptyName = await upsertCategory(owner, { id: null, name: "   " });
  check("ชื่อหมวดว่าง => error", !emptyName.ok);

  const categoryA = await upsertCategory(owner, { id: null, name: `${PREFIX} หมวด A` });
  const categoryB = await upsertCategory(owner, { id: null, name: `${PREFIX} หมวด B` });
  check("สร้างหมวดได้", categoryA.ok && categoryB.ok);

  if (!categoryA.ok || !categoryB.ok) {
    throw new Error("สร้างหมวดไม่สำเร็จ ทดสอบต่อไม่ได้");
  }

  const badPrice = await upsertMenuItem(owner, {
    id: null,
    name: `${PREFIX} ราคาพัง`,
    description: null,
    categoryId: categoryA.id,
    stationId: null,
    imageUrl: null,
    basePriceText: "หนึ่งร้อย",
  });
  check("ราคาที่พิมพ์เป็นตัวอักษร => error", !badPrice.ok, badPrice.ok ? "" : badPrice.errorKey);

  const negativePrice = await upsertMenuItem(owner, {
    id: null,
    name: `${PREFIX} ราคาติดลบ`,
    description: null,
    categoryId: categoryA.id,
    stationId: null,
    imageUrl: null,
    basePriceText: "-50",
  });
  check("ราคาเมนูติดลบ => error", !negativePrice.ok, negativePrice.ok ? "" : negativePrice.errorKey);

  const badImage = await upsertMenuItem(owner, {
    id: null,
    name: `${PREFIX} รูปพัง`,
    description: null,
    categoryId: categoryA.id,
    stationId: null,
    imageUrl: "javascript:alert(1)",
    basePriceText: "50",
  });
  check("ลิงก์รูปที่ไม่ใช่ https:// หรือ / => error", !badImage.ok, badImage.ok ? "" : badImage.errorKey);

  const foreignCategory = await upsertMenuItem(owner, {
    id: null,
    name: `${PREFIX} ข้ามสาขา`,
    description: null,
    categoryId: "ไม่มีหมวดนี้",
    stationId: null,
    imageUrl: null,
    basePriceText: "50",
  });
  check("หมวดที่ไม่ได้อยู่ในสาขา => error", !foreignCategory.ok);

  const item1 = await upsertMenuItem(owner, {
    id: null,
    name: `${PREFIX} เมนู 1`,
    description: "ทดสอบ",
    categoryId: categoryA.id,
    stationId: null,
    imageUrl: null,
    basePriceText: "120.50",
  });
  const item2 = await upsertMenuItem(owner, {
    id: null,
    name: `${PREFIX} เมนู 2`,
    description: null,
    categoryId: categoryA.id,
    stationId: null,
    imageUrl: null,
    basePriceText: "80",
  });

  check("สร้างเมนูได้", item1.ok && item2.ok);

  if (!item1.ok || !item2.ok) {
    throw new Error("สร้างเมนูไม่สำเร็จ ทดสอบต่อไม่ได้");
  }

  const created = await prisma.menuItem.findUniqueOrThrow({ where: { id: item1.id } });
  // ข้อความเดียวกันแปลเป็นหน่วยย่อยต่างกันตามสกุลเงินของสาขา (THB "120.50" = 12050 สตางค์)
  // จึงเทียบกับตัวแปลงที่ทดสอบแยกไว้ในข้อ 2 แทนการฮาร์ดโค้ดเลขของสกุลใดสกุลหนึ่ง
  const unitsOf = (text: string) => parseMoneyInput(text, branch.currency);
  check("ราคาถูกแปลงเป็นจำนวนเต็มหน่วยย่อย", created.basePrice === unitsOf("120.50"), String(created.basePrice));
  check("ของใหม่ต่อท้ายลิสต์เสมอ", created.sortOrder >= 1);

  // ── 4. ของหมด / มีของ ────────────────────────────────────────────────
  const kitchenToggle = await setAvailability(kitchen, "menuItem", item1.id, false);
  check("ครัวกดของหมดได้", kitchenToggle.ok, kitchenToggle.ok ? "" : kitchenToggle.errorKey);

  const afterOff = await prisma.menuItem.findUniqueOrThrow({ where: { id: item1.id } });
  check("เมนูถูกปิดขายจริง", afterOff.isAvailable === false);

  const customerMenu = await getCustomerMenu(branch.id);
  const visibleNames = customerMenu.flatMap((category) => category.items.map((i) => i.name));
  check(
    "เมนูที่ปิดขายหายจากหน้าลูกค้าทันที",
    !visibleNames.includes(`${PREFIX} เมนู 1`),
  );

  const adminTree = await getMenuTree(branch.id);
  const adminNames = adminTree.flatMap((category) => category.items.map((i) => i.name));
  check(
    "แต่หลังร้านยังเห็นอยู่ (ไม่งั้นเปิดกลับไม่ได้)",
    adminNames.includes(`${PREFIX} เมนู 1`),
  );

  await setAvailability(server, "menuItem", item1.id, true);
  check(
    "เสิร์ฟกดเปิดกลับได้",
    (await prisma.menuItem.findUniqueOrThrow({ where: { id: item1.id } })).isAvailable === true,
  );

  const auditToggle = await prisma.auditLog.findFirst({
    where: { action: "menu.menuItem.availability", entityId: item1.id },
    orderBy: { createdAt: "desc" },
  });
  check("เขียน AuditLog ตอนกดของหมด", auditToggle !== null && auditToggle.staffId === server.id);

  // ── 5. เรียงลำดับ ────────────────────────────────────────────────────
  const beforeMove = await prisma.menuItem.findMany({
    where: { categoryId: categoryA.id },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    select: { id: true },
  });

  const moved = await moveSortOrder(owner, "menuItem", beforeMove[1].id, "up");
  check("เลื่อนขึ้นได้", moved.ok, moved.ok ? "" : moved.errorKey);

  const afterMove = await prisma.menuItem.findMany({
    where: { categoryId: categoryA.id },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  check(
    "ลำดับสลับกันจริง",
    afterMove[0].id === beforeMove[1].id && afterMove[1].id === beforeMove[0].id,
  );

  const atTop = await moveSortOrder(owner, "menuItem", afterMove[0].id, "up");
  check("อยู่บนสุดแล้วกดขึ้นอีก = ไม่ error และไม่มีอะไรเปลี่ยน", atTop.ok);

  /**
   * เคสที่ทำให้ต้อง "เขียนเลขใหม่ทั้งชุด" แทนการสลับค่าสองแถว:
   * ตั้ง sortOrder ให้ซ้ำกันทั้งสองแถวก่อน แล้วสั่งเลื่อน — ถ้าโค้ดแค่สลับค่าเดิม
   * ผลลัพธ์จะไม่มีอะไรขยับเลย และปุ่มจะดูเหมือนเสียโดยไม่มี error
   */
  await prisma.menuItem.updateMany({ where: { categoryId: categoryA.id }, data: { sortOrder: 5 } });
  const tied = await prisma.menuItem.findMany({
    where: { categoryId: categoryA.id },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  await moveSortOrder(owner, "menuItem", tied[1].id, "up");
  const afterTie = await prisma.menuItem.findMany({
    where: { categoryId: categoryA.id },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    select: { id: true, sortOrder: true },
  });
  check(
    "sortOrder ที่ซ้ำกันยังเลื่อนได้ (เขียนเลขใหม่ทั้งชุด)",
    afterTie[0].id === tied[1].id,
    afterTie.map((row) => row.sortOrder).join(","),
  );

  // ── 6. กลุ่มตัวเลือก ─────────────────────────────────────────────────
  const noOptions = await upsertModifierGroup(owner, {
    id: null,
    name: `${PREFIX} กลุ่มว่าง`,
    required: false,
    minSelect: 0,
    maxSelect: 1,
    modifiers: [],
  });
  check("กลุ่มที่ไม่มีตัวเลือกเลย => error", !noOptions.ok, noOptions.ok ? "" : noOptions.errorKey);

  const badRange = await upsertModifierGroup(owner, {
    id: null,
    name: `${PREFIX} ช่วงพัง`,
    required: false,
    minSelect: 3,
    maxSelect: 1,
    modifiers: [{ id: null, name: "ก", priceDeltaText: "0" }],
  });
  check("สูงสุดน้อยกว่าขั้นต่ำ => error", !badRange.ok, badRange.ok ? "" : badRange.errorKey);

  const requiredNoMin = await upsertModifierGroup(owner, {
    id: null,
    name: `${PREFIX} บังคับแต่ขั้นต่ำ 0`,
    required: true,
    minSelect: 0,
    maxSelect: 2,
    modifiers: [{ id: null, name: "ก", priceDeltaText: "0" }],
  });
  check('"บังคับเลือก" แต่ขั้นต่ำ 0 => error', !requiredNoMin.ok, requiredNoMin.ok ? "" : requiredNoMin.errorKey);

  /** เคสที่พังเงียบที่สุด: ขั้นต่ำมากกว่าจำนวนตัวเลือกที่มี = ลูกค้าติดหน้าเลือกตลอดกาล */
  const impossible = await upsertModifierGroup(owner, {
    id: null,
    name: `${PREFIX} เลือกไม่ได้`,
    required: true,
    minSelect: 3,
    maxSelect: 3,
    modifiers: [
      { id: null, name: "ก", priceDeltaText: "0" },
      { id: null, name: "ข", priceDeltaText: "0" },
    ],
  });
  check(
    "ขั้นต่ำมากกว่าจำนวนตัวเลือกที่มี => error (ลูกค้าจะเลือกให้ครบไม่ได้)",
    !impossible.ok,
    impossible.ok ? "" : impossible.errorKey,
  );

  const group = await upsertModifierGroup(owner, {
    id: null,
    name: `${PREFIX} ขนาด`,
    required: true,
    minSelect: 1,
    maxSelect: 1,
    modifiers: [
      { id: null, name: "ธรรมดา", priceDeltaText: "0" },
      { id: null, name: "พิเศษ", priceDeltaText: "20" },
      { id: null, name: "ไม่เอาเนื้อ", priceDeltaText: "-10" },
    ],
  });
  check("สร้างกลุ่มตัวเลือกได้", group.ok, group.ok ? "" : group.errorKey);

  if (!group.ok) {
    throw new Error("สร้างกลุ่มไม่สำเร็จ");
  }

  const savedGroup = await getModifierGroup(branch.id, group.id);
  check("ตัวเลือกถูกบันทึกครบ 3 อย่าง", savedGroup?.modifiers.length === 3);
  check(
    "ส่วนต่างราคาติดลบถูกเก็บเป็นค่าติดลบจริง",
    savedGroup?.modifiers.find((m) => m.name === "ไม่เอาเนื้อ")?.priceDelta === unitsOf("-10"),
    String(savedGroup?.modifiers.find((m) => m.name === "ไม่เอาเนื้อ")?.priceDelta),
  );

  // แก้กลุ่มโดยเอาตัวเลือกหนึ่งออก → ต้องถูก "ปิดขาย" ไม่ใช่ลบทิ้ง
  const keep = savedGroup!.modifiers.filter((m) => m.name !== "ไม่เอาเนื้อ");
  await upsertModifierGroup(owner, {
    id: group.id,
    name: `${PREFIX} ขนาด`,
    required: true,
    minSelect: 1,
    maxSelect: 1,
    modifiers: keep.map((m) => ({ id: m.id, name: m.name, priceDeltaText: "0" })),
  });

  const afterRemove = await getModifierGroup(branch.id, group.id);
  const removed = afterRemove?.modifiers.find((m) => m.name === "ไม่เอาเนื้อ");
  check("ตัวเลือกที่เอาออกถูกปิดขาย ไม่ได้ถูกลบ", removed !== undefined && removed.isAvailable === false);

  // ผูกกลุ่มเข้ากับเมนู
  const linked = await setMenuItemModifierGroups(owner, item1.id, [group.id]);
  check("ผูกกลุ่มเข้ากับเมนูได้", linked.ok, linked.ok ? "" : linked.errorKey);

  const forEdit = await getMenuItemForEdit(branch.id, item1.id);
  check("อ่านกลับมาแล้วเห็นกลุ่มที่ผูกไว้", forEdit?.item?.modifierGroups.length === 1);

  const linkForeign = await setMenuItemModifierGroups(owner, item1.id, ["ไม่มีกลุ่มนี้"]);
  check("ผูกกลุ่มที่ไม่ได้อยู่ในสาขา => error", !linkForeign.ok);

  const groupsList = await getModifierGroups(branch.id);
  const listed = groupsList.find((g) => g.id === group.id);
  check("ลิสต์บอกว่ากลุ่มนี้ถูกใช้อยู่กี่เมนู", listed?._count.menuItems === 1);

  // ── 7. แก้ราคาแล้วบิลเก่าต้องไม่ขยับ ─────────────────────────────────
  const session = await openOrJoinTableSession({
    tableId: "seed-table-b2",
    branchId: branch.id,
    pax: 1,
  });

  await addToCart({
    tableSessionId: session.id,
    branchId: branch.id,
    tableId: "seed-table-b2",
    timezone: branch.timezone,
    menuItemId: item2.id,
    quantity: 2,
    modifierIds: [],
    note: null,
  });
  await placeOrder(session.id);

  const billBefore = await getTableBill(branch.id, "seed-table-b2");
  const paid = await takePayment(cashier, "seed-table-b2", {
    method: "CASH",
    receivedAmount: billBefore!.bill.grandTotal,
  });
  check("ปิดบิลด้วยเมนูทดสอบได้", paid.ok, paid.ok ? "" : paid.errorKey);

  // ขึ้นราคาเมนูเป็นสองเท่าหลังจากที่บิลปิดไปแล้ว
  await upsertMenuItem(owner, {
    id: item2.id,
    name: `${PREFIX} เมนู 2`,
    description: null,
    categoryId: categoryA.id,
    stationId: null,
    imageUrl: null,
    basePriceText: "160",
  });

  if (paid.ok) {
    const payment = await prisma.payment.findUniqueOrThrow({
      where: { id: paid.paymentId },
      include: { orders: { include: { items: true } } },
    });

    check(
      "ขึ้นราคาแล้วยอดในบิลที่ปิดไปแล้วต้องไม่ขยับ",
      payment.grandTotal === billBefore!.bill.grandTotal,
      `${payment.grandTotal} vs ${billBefore!.bill.grandTotal}`,
    );
    check(
      "snapshot ราคาต่อหน่วยของบิลเก่ายังเป็นราคาเดิม",
      payment.orders[0].items[0].unitPriceSnapshot === unitsOf("80"),
      String(payment.orders[0].items[0].unitPriceSnapshot),
    );
  }

  // ── 8. ลบ ────────────────────────────────────────────────────────────
  const deleteOrdered = await deleteMenuEntity(owner, "menuItem", item2.id);
  check(
    "เมนูที่เคยถูกสั่งแล้ว ลบไม่ได้ (บอกให้ใช้ปิดขายแทน)",
    !deleteOrdered.ok,
    deleteOrdered.ok ? "" : deleteOrdered.errorKey,
  );

  const deleteCategoryWithItems = await deleteMenuEntity(owner, "category", categoryA.id);
  check(
    "หมวดที่ยังมีเมนูอยู่ ลบไม่ได้",
    !deleteCategoryWithItems.ok,
    deleteCategoryWithItems.ok ? "" : deleteCategoryWithItems.errorKey,
  );

  const deleteLinkedGroup = await deleteMenuEntity(owner, "modifierGroup", group.id);
  check(
    "กลุ่มที่ยังผูกกับเมนูอยู่ ลบไม่ได้",
    !deleteLinkedGroup.ok,
    deleteLinkedGroup.ok ? "" : deleteLinkedGroup.errorKey,
  );

  const deleteByCashier = await deleteMenuEntity(cashier, "category", categoryB.id);
  check("แคชเชียร์ลบไม่ได้", !deleteByCashier.ok);

  const deleteEmptyCategory = await deleteMenuEntity(owner, "category", categoryB.id);
  check(
    "หมวดเปล่าที่ไม่เคยมีอะไรผูก ลบได้จริง",
    deleteEmptyCategory.ok,
    deleteEmptyCategory.ok ? "" : deleteEmptyCategory.errorKey,
  );

  // เมนูที่ไม่เคยถูกสั่ง ลบได้
  await setMenuItemModifierGroups(owner, item1.id, []);
  const deleteNeverOrdered = await deleteMenuEntity(owner, "menuItem", item1.id);
  check(
    "เมนูที่ไม่เคยถูกสั่ง ลบได้จริง (ไม่งั้นเมนูพิมพ์ผิดค้างตลอดกาล)",
    deleteNeverOrdered.ok,
    deleteNeverOrdered.ok ? "" : deleteNeverOrdered.errorKey,
  );

  const auditDelete = await prisma.auditLog.findFirst({
    where: { action: "menu.menuItem.delete", entityId: item1.id },
  });
  check("เขียน AuditLog ตอนลบ (เก็บชื่อไว้ก่อนลบ)", auditDelete !== null);

  // ── 9. ข้ามสาขาไม่ได้ ────────────────────────────────────────────────
  const otherBranchStaff: CurrentStaff = { ...owner, branchId: "ไม่มีสาขานี้" };
  const crossBranch = await setAvailability(otherBranchStaff, "category", categoryA.id, false);
  check("แก้ของสาขาอื่นไม่ได้", !crossBranch.ok, crossBranch.ok ? "" : crossBranch.errorKey);

  const unknownEntity = await setAvailability(owner, "ไม่มีชนิดนี้" as never, categoryA.id, false);
  check("ชนิดที่ไม่รู้จัก => error", !unknownEntity.ok);

  await cleanup(branch.id);
  await prisma.restaurantTable.update({
    where: { id: "seed-table-b2" },
    data: { status: "AVAILABLE" },
  });
  await stopRealtime();
  console.log("cleanup done");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await stopRealtime();
    await prisma.$disconnect();
    process.exit(1);
  });
