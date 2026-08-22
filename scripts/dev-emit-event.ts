import "dotenv/config";

import { REALTIME_EVENT_VERSION, type RealtimeEventType } from "@/lib/realtime-events";
import { prisma } from "@/lib/server/db";
import { publishRealtimeEvent } from "@/lib/server/realtime";

/**
 * ยิง event realtime หนึ่งตัวเข้าไปในระบบจาก "process อื่น" (เครื่องมือ dev)
 *
 *     REALTIME_DRIVER=postgres npm run dev:emit                     # order.placed
 *     REALTIME_DRIVER=postgres npm run dev:emit order_item.status
 *
 * ใช้ทำอะไร: ทดสอบว่าจอที่เปิดค้างอยู่ (KDS / ผังโต๊ะ / หน้าติดตามของลูกค้า)
 * ขยับจริงไหม โดยไม่ต้องไปกดสั่งอาหารครบทั้งเส้นทาง
 *
 * **ต้องตั้ง REALTIME_DRIVER=postgres ทั้งที่นี่และที่ตัว server** ไม่งั้นไม่มีอะไรเกิดขึ้น
 * เพราะ driver memory คุยกันข้าม process ไม่ได้ — ซึ่งเป็นการสาธิตข้อจำกัดของมัน
 * ได้ตรงที่สุด: นี่คือสถานการณ์เดียวกับ Vercel ที่ instance รับออร์เดอร์กับ
 * instance ที่ถือสาย SSE ของจอครัวเป็นคนละตัวกัน
 */
const TYPES: RealtimeEventType[] = [
  "cart.changed",
  "order.placed",
  "order_item.status",
  "order_item.cancelled",
  "table_session.changed",
];

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("สคริปต์นี้ใช้ได้เฉพาะเครื่อง dev");
  }

  const type = (process.argv[2] ?? "order.placed") as RealtimeEventType;

  if (!TYPES.includes(type)) {
    console.error(`ไม่รู้จัก event "${type}" — ที่มีให้เลือก: ${TYPES.join(", ")}`);
    process.exit(1);
  }

  const branch = await prisma.branch.findFirstOrThrow({ select: { id: true, name: true } });
  const tableCode = process.argv[3];
  const table = tableCode
    ? await prisma.restaurantTable.findUnique({
        where: { tableCode },
        select: { id: true, name: true },
      })
    : null;

  const at = Date.now();

  await publishRealtimeEvent({
    v: REALTIME_EVENT_VERSION,
    type,
    branchId: branch.id,
    tableId: table?.id ?? null,
    at,
  });

  console.log(
    `ยิง ${type} ไปที่สาขา ${branch.name}` +
      `${table ? ` โต๊ะ ${table.name}` : " (ไม่ผูกโต๊ะ)"} · at=${at}`,
  );

  if (process.env.REALTIME_DRIVER !== "postgres") {
    console.warn(
      "\n⚠ REALTIME_DRIVER ไม่ได้ตั้งเป็น postgres — event นี้ไม่ออกจาก process นี้เลย\n" +
        "  สั่งใหม่ด้วย: REALTIME_DRIVER=postgres npm run dev:emit",
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
