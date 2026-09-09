import "dotenv/config";

import { canEditSettings } from "@/lib/rbac";
import { addToCart, placeOrder } from "@/lib/server/cart";
import { prisma } from "@/lib/server/db";
import { getPosTables } from "@/lib/server/pos";
import {
  deleteTable,
  getSettings,
  rotateTableCode,
  upsertTable,
} from "@/lib/server/settings";
import type { CurrentStaff } from "@/lib/server/staff-session";
import { openOrJoinTableSession, resolveSessionByToken } from "@/lib/server/table-session";

/**
 * Smoke test ของการจัดการจุดขาย — โต๊ะ / เคาน์เตอร์ / ช่องไรเดอร์
 *
 *     npm run smoke:tables
 *
 * ── สิ่งที่ต้องพิสูจน์ ────────────────────────────────────────────────────
 *   1. **`tableCode` ที่ออกให้ต้องเดาไม่ได้และไม่ซ้ำ** — มันคือสิ่งเดียวที่กัน
 *      คนนอกเปิดบิลของโต๊ะที่ตัวเองไม่ได้นั่ง
 *   2. **ออก QR ใหม่แล้วใบเก่าต้องตายทันที** ไม่ใช่ค่อย ๆ หมดอายุ
 *   3. **ลบจุดขายที่มีประวัติไม่ได้** — และต้องกัน `TableSession` ด้วย ไม่ใช่แค่
 *      `Order` เพราะ session เป็น Cascade ฐานข้อมูลจะไม่กันให้
 *   4. **ปิดใช้งานจุดขายที่มีบิลเปิดค้างไม่ได้** — บั๊กตระกูลเดียวกับ `expiresAt`
 *      ที่เคยทำให้บิลหายไปจากสายตาพนักงาน
 *   5. **เปลี่ยน `kind` ของจุดขายที่มีประวัติไม่ได้** — มันตัดสินว่าคิดค่าบริการไหม
 *
 * สร้างจุดขายของตัวเองทั้งหมด (ชื่อขึ้นต้น `ZZ-`) แล้วลบทิ้งใน finally
 * — ไม่แตะโต๊ะ seed เพราะ smoke ชุดอื่นใช้อยู่
 */

const PREFIX = "ZZ-SMOKE";

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (ok) {
    passed += 1;
  } else {
    failed += 1;
  }
}

/** ลบทุกอย่างที่สคริปต์นี้สร้าง ตามลำดับ ออร์เดอร์ → รอบขาย → จุดขาย */
async function cleanup(branchId: string) {
  const tables = await prisma.restaurantTable.findMany({
    where: { branchId, name: { startsWith: PREFIX } },
    select: { id: true },
  });
  const tableIds = tables.map((table) => table.id);

  if (tableIds.length === 0) {
    return;
  }

  const sessions = await prisma.tableSession.findMany({
    where: { tableId: { in: tableIds } },
    select: { id: true },
  });
  const sessionIds = sessions.map((session) => session.id);

  await prisma.orderItemModifier.deleteMany({
    where: { orderItem: { order: { tableSessionId: { in: sessionIds } } } },
  });
  await prisma.orderItem.deleteMany({ where: { order: { tableSessionId: { in: sessionIds } } } });
  await prisma.order.deleteMany({ where: { tableSessionId: { in: sessionIds } } });
  await prisma.tableSession.deleteMany({ where: { id: { in: sessionIds } } });
  await prisma.auditLog.deleteMany({ where: { entityId: { in: tableIds } } });
  await prisma.restaurantTable.deleteMany({ where: { id: { in: tableIds } } });
}

async function main() {
  const owner = (await prisma.staff.findFirstOrThrow({
    where: { code: "001" },
    include: { branch: true },
  })) as CurrentStaff;
  const cashier = (await prisma.staff.findFirstOrThrow({
    where: { code: "002" },
    include: { branch: true },
  })) as CurrentStaff;
  const branchId = owner.branchId;

  await cleanup(branchId);

  try {
    console.log("\n-- 1. Permissions -------------------------------------------\n");

    check("owner can edit sale points", canEditSettings("OWNER") === true);
    check("manager can edit sale points", canEditSettings("MANAGER") === true);
    check("cashier cannot edit sale points", canEditSettings("CASHIER") === false);

    const denied = await upsertTable(cashier, null, {
      name: `${PREFIX}-DENIED`,
      seats: 4,
      sortOrder: 1,
      kind: "DINE_IN",
      isActive: true,
    });
    check("cashier is refused by the server, not just the UI", denied.ok === false);

    const deniedRows = await prisma.restaurantTable.count({
      where: { branchId, name: `${PREFIX}-DENIED` },
    });
    check("refused create wrote no row", deniedRows === 0);

    console.log("\n-- 2. Creating a table --------------------------------------\n");

    const created = await upsertTable(owner, null, {
      name: `${PREFIX}-A`,
      seats: 4,
      sortOrder: 900,
      kind: "DINE_IN",
      isActive: true,
    });
    check("owner can create a table", created.ok === true);
    check("a QR code is issued on create", Boolean(created.ok && created.tableCode));

    const code = created.ok ? (created.tableCode ?? "") : "";
    check("code is 6 characters", code.length === 6, code);
    check(
      "code avoids look-alike characters (0 O 1 l I)",
      !/[01olI]/.test(code),
      code,
    );

    const tableId = created.ok ? (created.tableId ?? "") : "";
    const row = await prisma.restaurantTable.findUniqueOrThrow({ where: { id: tableId } });
    check("stored in the actor's own branch", row.branchId === branchId);
    check("seats saved", row.seats === 4);
    check("kind saved", row.kind === "DINE_IN");
    check("status defaults to AVAILABLE", row.status === "AVAILABLE");

    console.log("\n-- 3. Validation --------------------------------------------\n");

    const dupe = await upsertTable(owner, null, {
      name: `${PREFIX}-A`,
      seats: 2,
      sortOrder: 901,
      kind: "DINE_IN",
      isActive: true,
    });
    check("duplicate name in the same branch is refused", dupe.ok === false);

    const blank = await upsertTable(owner, null, {
      name: "   ",
      seats: 2,
      sortOrder: 902,
      kind: "DINE_IN",
      isActive: true,
    });
    check("blank name is refused", blank.ok === false);

    const negative = await upsertTable(owner, null, {
      name: `${PREFIX}-NEG`,
      seats: -1,
      sortOrder: 903,
      kind: "DINE_IN",
      isActive: true,
    });
    check("negative seats are refused", negative.ok === false);

    const fractional = await upsertTable(owner, null, {
      name: `${PREFIX}-FRAC`,
      seats: 2.5,
      sortOrder: 904,
      kind: "DINE_IN",
      isActive: true,
    });
    check("fractional seats are refused", fractional.ok === false);

    const missing = await upsertTable(owner, "does-not-exist", {
      name: `${PREFIX}-GHOST`,
      seats: 2,
      sortOrder: 905,
      kind: "DINE_IN",
      isActive: true,
    });
    check("editing a table outside your branch is refused", missing.ok === false);

    console.log("\n-- 4. Unique codes ------------------------------------------\n");

    const second = await upsertTable(owner, null, {
      name: `${PREFIX}-B`,
      seats: 6,
      sortOrder: 906,
      kind: "DINE_IN",
      isActive: true,
    });
    check("second table created", second.ok === true);
    check(
      "two tables never share a code",
      second.ok && second.tableCode !== code,
      `${code} vs ${second.ok ? second.tableCode : "?"}`,
    );

    console.log("\n-- 5. Reissuing a QR code -----------------------------------\n");

    const session = await openOrJoinTableSession({ tableId, branchId, pax: 2 });
    const beforeToken = await resolveSessionByToken(branchId, session.token);
    check("the open round resolves before the QR is reissued", beforeToken !== null);

    const rotated = await rotateTableCode(owner, tableId);
    check("owner can reissue a QR code", rotated.ok === true);
    check(
      "the code actually changed",
      rotated.ok && rotated.tableCode !== code,
      rotated.ok ? rotated.tableCode : "",
    );

    const afterRotate = await prisma.restaurantTable.findUniqueOrThrow({ where: { id: tableId } });
    check(
      "the old code no longer resolves to any table",
      (await prisma.restaurantTable.count({ where: { tableCode: code } })) === 0,
    );
    check(
      "the new code is the one stored",
      rotated.ok && afterRotate.tableCode === rotated.tableCode,
    );

    /**
     * รอบที่เปิดค้างอยู่ต้องไม่ถูกฆ่าไปด้วย — ลูกค้าที่กำลังกินอยู่ถือ cookie ของ
     * รอบนั้น ไม่ได้ถือ tableCode การพิมพ์ QR ใหม่จึงกันแค่ "คนที่จะสแกนต่อจากนี้"
     */
    const afterToken = await resolveSessionByToken(branchId, session.token);
    check("reissuing a QR does NOT kill the round already open", afterToken !== null);

    const rotateDenied = await rotateTableCode(cashier, tableId);
    check("cashier cannot reissue a QR code", rotateDenied.ok === false);

    console.log("\n-- 6. Open bills block destructive edits --------------------\n");

    const branch = await prisma.branch.findUniqueOrThrow({ where: { id: branchId } });
    await addToCart({
      tableSessionId: session.id,
      branchId,
      tableId,
      timezone: branch.timezone,
      note: null,
      menuItemId: "seed-item-krapao",
      quantity: 1,
      modifierIds: ["seed-mod-spice-mild", "seed-mod-size-regular"],
    });
    await placeOrder(session.id);

    const disable = await upsertTable(owner, tableId, {
      name: `${PREFIX}-A`,
      seats: 4,
      sortOrder: 900,
      kind: "DINE_IN",
      isActive: false,
    });
    check("cannot disable a sale point that has an open bill", disable.ok === false);

    const stillActive = await prisma.restaurantTable.findUniqueOrThrow({ where: { id: tableId } });
    check("the refused disable changed nothing", stillActive.isActive === true);

    const retype = await upsertTable(owner, tableId, {
      name: `${PREFIX}-A`,
      seats: 4,
      sortOrder: 900,
      kind: "COUNTER",
      isActive: true,
    });
    check("cannot change the type once it has sales history", retype.ok === false);

    const stillDineIn = await prisma.restaurantTable.findUniqueOrThrow({ where: { id: tableId } });
    check("the refused type change changed nothing", stillDineIn.kind === "DINE_IN");

    const rename = await upsertTable(owner, tableId, {
      name: `${PREFIX}-A2`,
      seats: 8,
      sortOrder: 900,
      kind: "DINE_IN",
      isActive: true,
    });
    check("renaming a table with history is still allowed", rename.ok === true);

    console.log("\n-- 7. Deleting ----------------------------------------------\n");

    const used = await deleteTable(owner, tableId);
    check("cannot delete a sale point with sales history", used.ok === false);
    check(
      "the refused delete left the row in place",
      (await prisma.restaurantTable.count({ where: { id: tableId } })) === 1,
    );

    const freshId = second.ok ? (second.tableId ?? "") : "";
    const fresh = await deleteTable(owner, freshId);
    check("a never-used sale point can be deleted", fresh.ok === true);
    check(
      "the row is gone",
      (await prisma.restaurantTable.count({ where: { id: freshId } })) === 0,
    );

    /**
     * ⚠ เคสที่ฐานข้อมูลไม่กันให้: `TableSession.tableId` เป็น Cascade
     * โต๊ะที่เปิดรอบแล้วแต่ยังไม่มีออร์เดอร์จะลบผ่านฉลุยแล้วพารอบหายไปด้วย
     */
    const sessionOnly = await upsertTable(owner, null, {
      name: `${PREFIX}-C`,
      seats: 2,
      sortOrder: 907,
      kind: "DINE_IN",
      isActive: true,
    });
    const sessionOnlyId = sessionOnly.ok ? (sessionOnly.tableId ?? "") : "";
    await openOrJoinTableSession({ tableId: sessionOnlyId, branchId, pax: 1 });

    const sessionOnlyDelete = await deleteTable(owner, sessionOnlyId);
    check(
      "a table with a round but no orders still cannot be deleted (Cascade trap)",
      sessionOnlyDelete.ok === false,
    );

    const deleteDenied = await deleteTable(cashier, sessionOnlyId);
    check("cashier cannot delete", deleteDenied.ok === false);

    console.log("\n-- 8. Wiring into the rest of the system --------------------\n");

    const settings = await getSettings(branchId);
    const listed = settings?.tables.find((table) => table.id === tableId);
    check("the table is listed on the settings screen", Boolean(listed));
    check("it is flagged as not deletable", listed?.deletable === false);
    check("it is flagged as having an open bill", listed?.hasOpenSession === true);

    const map = await getPosTables(branchId);
    const onMap = map.find((entry) => entry.id === tableId);
    check("a table created here shows up on the POS table map", Boolean(onMap));
    check("the map shows its open round", Boolean(onMap?.session));

    const counter = await upsertTable(owner, null, {
      name: `${PREFIX}-COUNTER`,
      seats: 0,
      sortOrder: 908,
      kind: "COUNTER",
      isActive: true,
    });
    check("a takeaway counter can be created", counter.ok === true);

    const counterId = counter.ok ? (counter.tableId ?? "") : "";
    const mapAfter = await getPosTables(branchId);
    check(
      "a counter does NOT appear on the table map",
      !mapAfter.some((entry) => entry.id === counterId),
    );

    console.log("\n-- 9. Audit trail -------------------------------------------\n");

    const logs = await prisma.auditLog.findMany({
      where: { entityId: tableId },
      orderBy: { createdAt: "asc" },
      select: { action: true, metadata: true },
    });
    const actions = logs.map((log) => log.action);

    check("creating writes an audit row", actions.includes("settings.table_upsert"));
    check("reissuing a QR writes its own action", actions.includes("settings.table_rotate_qr"));

    const rotateLog = logs.find((log) => log.action === "settings.table_rotate_qr");
    const meta = rotateLog?.metadata as { before?: { tableCode?: string } } | null;
    check(
      "the audit row keeps the OLD code, so a printed QR can still be traced",
      meta?.before?.tableCode === code,
      `${meta?.before?.tableCode ?? "?"} vs ${code}`,
    );

    const denialLogs = await prisma.auditLog.count({
      where: { branchId, action: "settings.table_upsert", entityId: "" },
    });
    check("refused actions write no audit row", denialLogs === 0);
  } finally {
    await cleanup(branchId);
    console.log("\ncleanup done");
  }

  console.log(`\n${passed} passed · ${failed} failed`);
}

main()
  .catch((error) => {
    console.error(error);
    failed += 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(failed > 0 ? 1 : 0);
  });
