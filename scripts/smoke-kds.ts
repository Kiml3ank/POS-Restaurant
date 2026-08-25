import "dotenv/config";

import { REALTIME_EVENT_VERSION, type RealtimeEvent } from "@/lib/realtime-events";
import { rollUpOrderStatus } from "@/lib/order-status";
import { canAccessScreen, canCookOrderItem, canServeOrderItem } from "@/lib/rbac";
import { addToCart, placeOrder } from "@/lib/server/cart";
import { prisma } from "@/lib/server/db";
import {
  advanceKitchenItem,
  advanceKitchenTicket,
  getKitchenStations,
  getKitchenTickets,
  serveOrderItem,
} from "@/lib/server/kds";
import { cancelOrderItemByStaff } from "@/lib/server/pos";
import {
  REALTIME_PG_CHANNEL,
  publishRealtimeEvent,
  startRealtime,
  stopRealtime,
  subscribeToBranch,
} from "@/lib/server/realtime";
import type { CurrentStaff } from "@/lib/server/staff-session";
import { openOrJoinTableSession } from "@/lib/server/table-session";

/**
 * Smoke test ของจอครัว + ท่อ realtime (บทที่ 8)
 * รันกับ dev DB จริง แล้วลบข้อมูลที่สร้างทิ้งเอง
 *
 *     npm run smoke:kds
 *
 * ใช้โต๊ะ A2/A3 เพื่อไม่ชนกับ `smoke:order` (A1) และ `smoke:pos` (B1/B2)
 *
 * ตัว SSE route handler ไม่ได้ทดสอบที่นี่เพราะต้องมี request context ของ Next.js
 * (เหตุผลเดียวกับที่ smoke:pos ไม่ทดสอบ loginStaff) — ทดสอบผ่าน curl แทน
 * ดูคำสั่งที่ archive/report/2026-08-22-kds-realtime-sse.md
 */

const KITCHEN_TABLE_ID = "seed-table-a2";
const ROLLUP_TABLE_ID = "seed-table-a3";

const HOT_STATION = "seed-station-hot";
const BAR_STATION = "seed-station-bar";

const KRAPAO = "seed-item-krapao";
const THAI_TEA = "seed-item-thai-tea";
/** ไม่ผูกสถานี — ตัวเอกของการทดสอบครึ่งหนึ่งในไฟล์นี้ */
const WATER = "seed-item-water";

/**
 * ตัวเลือกที่ "จำเป็น" ของแต่ละเมนู (required + minSelect ตาม seed)
 * ต้องส่งครบไม่งั้น addToCart ปฏิเสธตั้งแต่ต้น — ซึ่งเป็นพฤติกรรมที่ถูกของบทที่ 7
 */
const KRAPAO_OPTIONS = ["seed-mod-spice-mild", "seed-mod-size-regular"];
const THAI_TEA_OPTIONS = ["seed-mod-sweet-50", "seed-mod-size-regular"];

function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) process.exitCode = 1;
}

async function loadStaff(id: string): Promise<CurrentStaff> {
  return prisma.staff.findUniqueOrThrow({ where: { id }, include: { branch: true } });
}

async function resetTables(tableIds: string[]) {
  const sessions = await prisma.tableSession.findMany({
    where: { tableId: { in: tableIds } },
    select: { id: true, orders: { select: { id: true } } },
  });

  const sessionIds = sessions.map((session) => session.id);
  const orderIds = sessions.flatMap((session) => session.orders.map((order) => order.id));
  const itemIds = orderIds.length
    ? (
        await prisma.orderItem.findMany({
          where: { orderId: { in: orderIds } },
          select: { id: true },
        })
      ).map((item) => item.id)
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

/** เปิดโต๊ะ → ใส่ของลงตะกร้า → ส่งเข้าครัว แล้วคืนบิลที่เพิ่งส่ง */
async function placeTestOrder(
  tableId: string,
  branchId: string,
  timezone: string,
  items: { menuItemId: string; quantity: number; modifierIds?: string[] }[],
) {
  const session = await openOrJoinTableSession({ tableId, branchId, pax: 2 });

  for (const item of items) {
    const added = await addToCart({
      tableSessionId: session.id,
      branchId,
      tableId,
      timezone,
      menuItemId: item.menuItemId,
      quantity: item.quantity,
      modifierIds: item.modifierIds ?? [],
      note: null,
    });

    if (!added.ok) {
      throw new Error(`addToCart ล้มเหลว: ${added.error}`);
    }
  }

  const placed = await placeOrder(session.id);

  if (!placed.ok) {
    throw new Error(`placeOrder ล้มเหลว: ${placed.error}`);
  }

  const order = await prisma.order.findFirstOrThrow({
    where: { tableSessionId: session.id, status: { not: "DRAFT" } },
    include: { items: true },
  });

  return { session, order };
}

const statusOf = async (orderId: string) =>
  (await prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { status: true } }))
    .status;

const itemStatusOf = async (itemId: string) =>
  (await prisma.orderItem.findUniqueOrThrow({ where: { id: itemId } })).status;

async function main() {
  const owner = await loadStaff("seed-staff-owner");
  const kitchen = await loadStaff("seed-staff-kitchen");
  const server = await loadStaff("seed-staff-server");
  const cashier = await loadStaff("seed-staff-cashier");
  const branchId = owner.branchId;
  const timezone = owner.branch.timezone;

  await resetTables([KITCHEN_TABLE_ID, ROLLUP_TABLE_ID]);

  // ── 1. RBAC ของจอครัว ────────────────────────────────────────────────────
  check("ครัวเข้าจอครัวได้", canAccessScreen(kitchen.role, "kds"));
  check("เสิร์ฟเข้าจอครัวได้ (ต้องเห็นว่าของโต๊ะไหนพร้อมยก)", canAccessScreen(server.role, "kds"));
  check("แคชเชียร์เข้าจอครัวไม่ได้", !canAccessScreen(cashier.role, "kds"));
  check("ครัวเข้าหน้า POS ไม่ได้ (ของเดิมจากบทที่ 9)", !canAccessScreen(kitchen.role, "pos"));

  check("ครัวกดปุ่มของครัวได้", canCookOrderItem(kitchen.role));
  check("เสิร์ฟกดปุ่มของครัวไม่ได้", !canCookOrderItem(server.role));
  check("ครัวกดเสิร์ฟไม่ได้", !canServeOrderItem(kitchen.role));
  check("เสิร์ฟกดเสิร์ฟได้", canServeOrderItem(server.role));
  check("แคชเชียร์กดเสิร์ฟได้ (เข้าจอครัวไม่ได้แต่ยกอาหารได้)", canServeOrderItem(cashier.role));

  // ── 2. roll-up สถานะบิลจากรายการ (ตรรกะล้วน ไม่แตะ DB) ───────────────────
  check("บิลว่าง => null", rollUpOrderStatus([]) === null);
  check("ทุกรายการ PLACED => PLACED", rollUpOrderStatus(["PLACED", "PLACED"]) === "PLACED");
  check(
    "ช้าที่สุดชนะ: [READY, PLACED] => PLACED",
    rollUpOrderStatus(["READY", "PLACED"]) === "PLACED",
  );
  check(
    "รายการที่ยกเลิกไม่นับ: [CANCELLED, READY] => READY",
    rollUpOrderStatus(["CANCELLED", "READY"]) === "READY",
  );
  check("ยกเลิกหมดทั้งใบ => CANCELLED", rollUpOrderStatus(["CANCELLED"]) === "CANCELLED");
  check("ทุกรายการ SERVED => SERVED", rollUpOrderStatus(["SERVED", "SERVED"]) === "SERVED");

  // ── 3. ส่งออร์เดอร์ที่มีทั้งของครัวและของหยิบเอง ──────────────────────────
  const { order } = await placeTestOrder(KITCHEN_TABLE_ID, branchId, timezone, [
    { menuItemId: KRAPAO, quantity: 2, modifierIds: KRAPAO_OPTIONS },
    { menuItemId: THAI_TEA, quantity: 1, modifierIds: THAI_TEA_OPTIONS },
    { menuItemId: WATER, quantity: 1 },
  ]);

  const krapaoItem = order.items.find((item) => item.menuItemId === KRAPAO)!;
  const teaItem = order.items.find((item) => item.menuItemId === THAI_TEA)!;
  const waterItem = order.items.find((item) => item.menuItemId === WATER)!;

  check("ของครัวเป็น PLACED ตอนส่ง", (await itemStatusOf(krapaoItem.id)) === "PLACED");
  check(
    "ของหยิบเอง (stationId = null) ข้ามไป READY ตั้งแต่ตอนส่ง",
    (await itemStatusOf(waterItem.id)) === "READY",
  );
  check("บิลที่ยังมีของครัวค้างอยู่เป็น PLACED", (await statusOf(order.id)) === "PLACED");

  // ── 4. การกรองตามสถานี ───────────────────────────────────────────────────
  const allTickets = await getKitchenTickets(branchId);
  const ticket = allTickets.find((row) => row.id === order.id);

  check("บิลขึ้นจอครัว", ticket !== undefined);
  check(
    "น้ำเปล่าไม่ขึ้นจอครัวเลย",
    ticket?.items.every((item) => item.stationId !== null) === true,
    `เห็น ${ticket?.items.length} รายการบนจอ (สั่งไป 3)`,
  );
  check("จอ 'ทุกสถานี' เห็นสองรายการ", ticket?.items.length === 2);

  const hotTickets = await getKitchenTickets(branchId, { stationId: HOT_STATION });
  const hotTicket = hotTickets.find((row) => row.id === order.id);
  check(
    "ครัวร้อนเห็นเฉพาะกะเพรา",
    hotTicket?.items.length === 1 && hotTicket.items[0]?.stationId === HOT_STATION,
    `เห็น: ${hotTicket?.items.map((item) => item.nameSnapshot).join(", ")}`,
  );

  const barTickets = await getKitchenTickets(branchId, { stationId: BAR_STATION });
  const barTicket = barTickets.find((row) => row.id === order.id);
  check("บาร์น้ำเห็นเฉพาะชาเย็น", barTicket?.items.length === 1);

  const stations = await getKitchenStations(branchId);
  check(
    "ตัวนับของครัวร้อนขึ้นเป็น 1",
    (stations.find((item) => item.id === HOT_STATION)?.queued ?? 0) >= 1,
  );
  check(
    "ตัวนับของหวานยังเป็น 0",
    (stations.find((item) => item.code === "DESSERT")?.queued ?? 0) === 0,
  );

  // ── 5. ครัวเดินสถานะ ─────────────────────────────────────────────────────
  const serverCooks = await advanceKitchenItem(server, krapaoItem.id);
  check("เสิร์ฟกดปุ่มครัว => error", !serverCooks.ok, serverCooks.ok ? "" : serverCooks.error);
  check("สถานะไม่ถูกแตะ", (await itemStatusOf(krapaoItem.id)) === "PLACED");

  const startKrapao = await advanceKitchenItem(kitchen, krapaoItem.id);
  check("ครัวกดรับออร์เดอร์", startKrapao.ok && startKrapao.changed === 1);
  check("กะเพราเป็น IN_PROGRESS", (await itemStatusOf(krapaoItem.id)) === "IN_PROGRESS");
  check(
    "ประทับ startedAt ไว้แล้ว (เอาไปวัดเวลาครัวในบทที่ 15)",
    (await prisma.orderItem.findUniqueOrThrow({ where: { id: krapaoItem.id } })).startedAt !== null,
  );
  check(
    "บิลยังเป็น PLACED เพราะชาเย็นยังไม่มีใครรับ",
    (await statusOf(order.id)) === "PLACED",
  );

  const startTea = await advanceKitchenItem(kitchen, teaItem.id);
  check("ครัวรับชาเย็นต่อ", startTea.ok && startTea.changed === 1);
  check(
    "รับครบทุกรายการแล้ว บิลขยับเป็น IN_PROGRESS",
    (await statusOf(order.id)) === "IN_PROGRESS",
  );

  // ── 6. บั๊มทั้งใบ ────────────────────────────────────────────────────────
  const bump = await advanceKitchenTicket(kitchen, order.id, null);
  check("บั๊มทั้งใบดันสองรายการพร้อมกัน", bump.ok && bump.changed === 2, `changed=${bump.ok ? bump.changed : "-"}`);
  check("กะเพราเป็น READY", (await itemStatusOf(krapaoItem.id)) === "READY");
  check("ชาเย็นเป็น READY", (await itemStatusOf(teaItem.id)) === "READY");
  check("ทุกรายการพร้อมแล้ว บิลเป็น READY", (await statusOf(order.id)) === "READY");

  const bumpAgain = await advanceKitchenTicket(kitchen, order.id, null);
  check(
    "บั๊มซ้ำไม่ทำอะไรและไม่ error (อีกจอกดไปแล้ว)",
    bumpAgain.ok && bumpAgain.changed === 0,
  );

  const advanceReady = await advanceKitchenItem(kitchen, krapaoItem.id);
  check(
    "ครัวกดต่อจาก READY ไม่ได้ (ต้องให้เสิร์ฟกด) แต่ไม่ถือเป็น error",
    advanceReady.ok && advanceReady.changed === 0,
  );

  // ── 7. เสิร์ฟ ────────────────────────────────────────────────────────────
  const kitchenServes = await serveOrderItem(kitchen, krapaoItem.id);
  check("ครัวกดเสิร์ฟ => error", !kitchenServes.ok, kitchenServes.ok ? "" : kitchenServes.error);

  const serverServes = await serveOrderItem(server, krapaoItem.id);
  check("เสิร์ฟกดยกกะเพราไปเสิร์ฟ", serverServes.ok && serverServes.changed === 1);
  check("กะเพราเป็น SERVED", (await itemStatusOf(krapaoItem.id)) === "SERVED");
  check("บิลยังเป็น READY เพราะยังมีของรอยก", (await statusOf(order.id)) === "READY");

  await serveOrderItem(server, teaItem.id);
  check(
    "น้ำเปล่ายังไม่ถูกยก บิลจึงยังไม่ SERVED",
    (await statusOf(order.id)) === "READY",
    "นี่คือเคสที่ทำให้ต้องมีปุ่มเสิร์ฟบนหน้า POS ด้วย",
  );

  await serveOrderItem(server, waterItem.id);
  check("ยกครบทุกอย่างแล้ว บิลเป็น SERVED", (await statusOf(order.id)) === "SERVED");
  check(
    "ประทับ servedAt ของบิลไว้แล้ว",
    (await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).servedAt !== null,
  );

  const ticketsAfter = await getKitchenTickets(branchId);
  check(
    "บิลที่เสิร์ฟครบแล้วหลุดออกจากจอครัว",
    ticketsAfter.every((row) => row.id !== order.id),
  );

  // ── 8. ยกเลิกรายการแล้วบิลต้อง roll-up ตาม ───────────────────────────────
  const { order: order2 } = await placeTestOrder(ROLLUP_TABLE_ID, branchId, timezone, [
    { menuItemId: KRAPAO, quantity: 1, modifierIds: KRAPAO_OPTIONS },
    { menuItemId: WATER, quantity: 1 },
  ]);

  const krapao2 = order2.items.find((item) => item.menuItemId === KRAPAO)!;
  const water2 = order2.items.find((item) => item.menuItemId === WATER)!;

  check("บิลใหม่เริ่มที่ PLACED", (await statusOf(order2.id)) === "PLACED");

  const cancelled = await cancelOrderItemByStaff(owner, krapao2.id, "ของหมด");
  check("ยกเลิกกะเพราสำเร็จ", cancelled.ok, cancelled.ok ? "" : cancelled.error);
  check(
    "เหลือแต่น้ำเปล่าที่ READY อยู่แล้ว บิลกระโดดจาก PLACED ไป READY",
    (await statusOf(order2.id)) === "READY",
    "ถ้าไม่ roll-up ตรงนี้ บิลจะค้างที่ PLACED แล้วคิดเงินไม่ได้ในบทที่ 10",
  );

  const cancelled2 = await cancelOrderItemByStaff(owner, water2.id, "ลูกค้าไม่เอาแล้ว");
  check("ยกเลิกน้ำเปล่าด้วย", cancelled2.ok);
  check("ยกเลิกหมดทั้งใบ บิลเป็น CANCELLED", (await statusOf(order2.id)) === "CANCELLED");

  // ── 9. ท่อ realtime ──────────────────────────────────────────────────────
  await startRealtime();

  const received: RealtimeEvent[] = [];
  const unsubscribe = subscribeToBranch(branchId, (event) => received.push(event));

  const otherBranch: RealtimeEvent = {
    v: REALTIME_EVENT_VERSION,
    type: "order.placed",
    branchId: "ไม่ใช่สาขานี้",
    tableId: null,
    at: Date.now(),
  };
  const sameBranch: RealtimeEvent = {
    v: REALTIME_EVENT_VERSION,
    type: "order.placed",
    branchId,
    tableId: KITCHEN_TABLE_ID,
    at: Date.now(),
  };

  await publishRealtimeEvent(otherBranch);
  await publishRealtimeEvent(sameBranch);

  check("รับ event ของสาขาตัวเองได้", received.some((event) => event.at === sameBranch.at));
  check(
    "event ของสาขาอื่นถูกกรองทิ้ง",
    received.every((event) => event.branchId === branchId),
  );

  /**
   * ── เส้นทาง LISTEN/NOTIFY (เฉพาะตอนเปิด driver postgres) ──────────────
   *
   * event ที่ process นี้ publish เองจะถูกกรองทิ้งตอนเด้งกลับมาทาง NOTIFY
   * (originId ตรงกัน) จึงทดสอบด้วยการ publish ธรรมดาไม่ได้ — ต้อง **ปลอมตัวเป็น
   * instance อื่น** ด้วยการยิง pg_notify เข้ามาตรง ๆ พร้อม originId คนละตัว
   *
   * นี่คือเส้นทางเดียวกับที่ instance A รับออร์เดอร์แล้วจอครัวที่เสียบอยู่กับ
   * instance B ต้องได้ยิน ซึ่งเป็นเหตุผลทั้งหมดที่ driver นี้มีอยู่
   */
  if (process.env.REALTIME_DRIVER === "postgres") {
    const fromOtherInstance: RealtimeEvent = {
      v: REALTIME_EVENT_VERSION,
      type: "order_item.status",
      branchId,
      tableId: null,
      at: Date.now() + 1,
    };

    const crossInstance = new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        stop();
        resolve(false);
      }, 5_000);

      const stop = subscribeToBranch(branchId, (event) => {
        if (event.at === fromOtherInstance.at) {
          clearTimeout(timer);
          stop();
          resolve(true);
        }
      });
    });

    await prisma.$executeRaw`SELECT pg_notify(${REALTIME_PG_CHANNEL}, ${JSON.stringify({
      o: "instance-อื่นที่ไม่ใช่เรา",
      e: fromOtherInstance,
    })})`;

    check(
      "รับ event จาก instance อื่นผ่าน Postgres LISTEN/NOTIFY ได้",
      await crossInstance,
      "ถ้า FAIL แปลว่าจอครัวบน Vercel หลาย instance จะไม่เห็นออร์เดอร์ที่เข้าคนละ instance",
    );
  }

  /**
   * นับก่อนเลิกฟังแล้วเทียบว่า "ไม่โต" ไม่ใช่เช็คว่าเท่ากับ 1
   *
   * เพราะตอนเปิด driver postgres บล็อกด้านบนยิง event ของสาขาเดียวกันเข้ามาอีกตัว
   * ซึ่ง listener ตัวนี้ก็ต้องได้ยินด้วย (ถูกแล้ว) — ถ้า hardcode เป็น 1 ไว้
   * เคสนี้จะ FAIL ทั้งที่ระบบทำงานถูกต้อง
   */
  const beforeUnsubscribe = received.length;

  unsubscribe();
  await publishRealtimeEvent(sameBranch);
  check(
    "เลิกฟังแล้วไม่ได้รับอีก",
    received.length === beforeUnsubscribe,
    `ก่อนเลิกฟัง ${beforeUnsubscribe} · หลังเลิกฟัง ${received.length}`,
  );

  console.log(
    `\n[realtime] driver = ${process.env.REALTIME_DRIVER === "postgres" ? "postgres (LISTEN/NOTIFY)" : "memory"}` +
      " — ทดสอบ driver postgres ด้วย REALTIME_DRIVER=postgres npm run smoke:kds",
  );

  // ── ล้างข้อมูลที่สร้างระหว่างทดสอบ ────────────────────────────────────────
  await resetTables([KITCHEN_TABLE_ID, ROLLUP_TABLE_ID]);
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
