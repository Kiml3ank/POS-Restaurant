import "dotenv/config";

import type { StaffScreen } from "@/lib/rbac";
import { STAFF_SCREEN_KIND, STAFF_SESSION_COOKIES } from "@/lib/staff-session-cookie";
import { prisma } from "@/lib/server/db";
import { createStaffToken } from "@/lib/server/staff-session";
import { createStaffSession } from "@/lib/server/staff-session-store";

/**
 * ออก cookie ของพนักงานไว้ทดสอบหน้าจอด้วย curl โดยไม่ต้องกดผ่านเบราว์เซอร์
 * (คู่กับ `npm run dev:session` ที่ทำแบบเดียวกันให้ฝั่งลูกค้า)
 *
 *     npm run dev:staff-cookie 001            # ค่าเริ่มต้นคือจอ POS
 *     npm run dev:staff-cookie 001 kds
 *     curl -H "Cookie: kds_staff_session=<token>" http://localhost:3000/kds
 *
 * ── เปลี่ยนไปจากเดิมในบทที่ 13b ──────────────────────────────────────────
 * token ใบเดียวใช้ได้ **จอเดียว** แล้ว ไม่ใช่ทั้งสามจอเหมือนก่อน เพราะ session
 * เป็นแถวใน `StaffSession` ที่ผูกกับจอไว้ตั้งแต่ตอนสร้าง — ต้องการทดสอบสองจอ
 * พร้อมกันก็สั่งสองครั้งด้วยชื่อจอต่างกัน
 *
 * สคริปต์นี้จึง **สร้างแถว session จริง** ไม่ใช่ปลอม token ขึ้นมาเฉย ๆ
 * (ปลอมแล้วจะใช้ไม่ได้ เพราะ getCurrentStaff() ตรวจกับ DB ทุก request)
 * และประกอบ token ด้วย `createStaffToken()` ตัวเดียวกับที่ระบบใช้จริง
 * — ห้ามเขียนสูตร token ซ้ำที่นี่อีก ไม่งั้นวันที่รูปแบบเปลี่ยนจะพังแบบเงียบ ๆ
 *
 * ตั้งใจให้เป็นเครื่องมือ dev เท่านั้น — มันข้ามการตรวจ PIN ทั้งหมด
 * จึงเช็ค NODE_ENV ก่อน และตัวลายเซ็นยังต้องตรงกับ AUTH_SECRET ของเครื่องนั้นอยู่ดี
 */
const SCREENS: StaffScreen[] = ["pos", "kds", "admin"];

function parseScreen(value: string | undefined): StaffScreen {
  if (!value) {
    return "pos";
  }

  const screen = SCREENS.find((name) => name === value);

  if (!screen) {
    throw new Error(`ไม่รู้จักจอ "${value}" — ใช้ได้: ${SCREENS.join(" · ")}`);
  }

  return screen;
}

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("สคริปต์นี้ใช้ได้เฉพาะเครื่อง dev");
  }

  const secret = process.env.AUTH_SECRET;

  if (!secret || secret.length < 32) {
    throw new Error("ไม่พบ AUTH_SECRET (หรือสั้นเกินไป) — ดู .env.example");
  }

  const staffCode = process.argv[2];

  if (!staffCode) {
    const staff = await prisma.staff.findMany({
      where: { isActive: true },
      orderBy: { code: "asc" },
      select: { code: true, name: true, role: true },
    });

    console.error("ใช้: npm run dev:staff-cookie <รหัสพนักงาน> [pos|kds|admin]");
    console.error("พนักงานที่มีอยู่:");
    for (const row of staff) {
      console.error(`  ${row.code}  ${row.name} (${row.role})`);
    }
    process.exit(1);
  }

  const screen = parseScreen(process.argv[3]);

  const staff = await prisma.staff.findFirst({
    where: { code: staffCode, isActive: true },
    include: { branch: true },
  });

  if (!staff) {
    throw new Error(`ไม่พบพนักงานรหัส ${staffCode}`);
  }

  /**
   * ปิดใบเก่าที่สคริปต์นี้เคยออกให้คนเดียวกัน **ก่อน** ออกใบใหม่
   *
   * ไม่งั้นทุกครั้งที่รันเพื่อทดสอบจะทิ้ง session ค้างไว้อีกใบ แล้วหน้า
   * /admin/staff จะขึ้นว่าคนนี้ "ล็อกอินอยู่ 5 เครื่อง" ทั้งที่เป็นเครื่องมือ dev
   * ล้วน ๆ — ซึ่งทำให้ตัวเลขที่ควรใช้จับเครื่องแปลกปลอมกลายเป็นตัวเลขที่ไม่มีใครเชื่อ
   *
   * ปิดเฉพาะใบที่ไม่มี IP (คือใบที่ออกจากสคริปต์นี้เท่านั้น) — ใบที่ล็อกอินจริง
   * จากเบราว์เซอร์มี IP ติดมาเสมอ จึงไม่ถูกแตะ ไม่งั้นเครื่องมือ dev จะเตะ
   * คนที่กำลังเปิดจอทดสอบอยู่ออกโดยไม่มีใครสั่ง
   */
  const staleDevSessions = await prisma.staffSession.updateMany({
    where: { staffId: staff.id, screen: STAFF_SCREEN_KIND[screen], revokedAt: null, ipAddress: null },
    data: { revokedAt: new Date(), revokedReason: "logout" },
  });

  const session = await createStaffSession({
    staffId: staff.id,
    branchId: staff.branchId,
    screen,
    ipAddress: null,
  });

  const token = createStaffToken({
    jti: session.id,
    sid: staff.id,
    bid: staff.branchId,
    exp: session.expiresAt.getTime(),
  });

  console.error(`${staff.name} (${staff.role}) · สาขา ${staff.branch.name} · จอ ${screen}`);
  console.error(
    `หมดอายุ ${session.expiresAt.toISOString()} · session ${session.id}` +
      (staleDevSessions.count > 0 ? ` · ปิดใบเก่าของเครื่องมือ dev ${staleDevSessions.count} ใบ` : ""),
  );
  console.error(
    `curl -H "Cookie: ${STAFF_SESSION_COOKIES[screen]}=<token>" http://localhost:3000/${screen === "admin" ? "admin/menu" : screen}`,
  );
  console.log(token);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
