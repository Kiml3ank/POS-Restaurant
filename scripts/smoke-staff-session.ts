import "dotenv/config";

import { prisma } from "@/lib/server/db";
import {
  LOCKOUT_MINUTES,
  MAX_FAILED_ATTEMPTS,
  checkLoginThrottle,
  clearLoginThrottle,
  recordFailedLogin,
} from "@/lib/server/staff-login-throttle";
import { loginStaff } from "@/lib/server/staff-session";
import {
  SESSION_REVOKE_REASONS,
  createStaffSession,
  listActiveStaffSessions,
  listStaffLoginHistory,
  loadActiveStaffSession,
  purgeExpiredStaffSessions,
  revokeAllStaffSessions,
  revokeStaffSession,
} from "@/lib/server/staff-session-store";

/**
 * Smoke test ของ session พนักงาน + ตัวนับ PIN ผิด (บทที่ 13b)
 *
 *     npm run smoke:staff-session
 *
 * ── สองอย่างที่ก้อนนี้ต้องพิสูจน์ ────────────────────────────────────────
 *   1. **ยกเลิก session ได้ทันที** — ก่อนหน้านี้ทำไม่ได้เลย (cookie ที่เซ็น HMAC
 *      ใช้ได้จนหมดอายุ 8 ชม.) พนักงานที่ถูกให้ออกตอนบ่ายยังเปิดเครื่องได้ถึงเย็น
 *   2. **ตัวนับ PIN ผิดอยู่ใน DB** ไม่ใช่ memory ของ process — ไม่งั้น deploy
 *      หลาย instance เมื่อไหร่ คนไล่สุ่ม PIN ได้โควตาใหม่ทุกครั้งที่สลับเครื่อง
 *
 * ทดสอบ `loginStaff()` ได้เฉพาะ **เส้นทางที่ผิด** เพราะเส้นทางสำเร็จจบด้วยการ
 * เขียน cookie ผ่าน `cookies()` ของ next/headers ซึ่งเรียกนอก request ของ Next ไม่ได้
 * — ฝั่งสำเร็จจึงทดสอบผ่าน `createStaffSession()` ตรง ๆ ซึ่งเป็นฟังก์ชันเดียวกับที่
 * `loginStaff()` เรียกจริง
 */

const CASHIER_CODE = "002";
const SERVER_CODE = "003";

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

/** ล้างของที่สคริปต์นี้สร้าง — session กับตัวนับของพนักงานสองคนที่ใช้ทดสอบ */
async function cleanup(staffIds: string[], branchId: string) {
  await prisma.staffSession.deleteMany({ where: { staffId: { in: staffIds } } });
  await prisma.staffLoginThrottle.deleteMany({
    where: { branchId, staffCode: { in: [CASHIER_CODE, SERVER_CODE] } },
  });
  await prisma.auditLog.deleteMany({
    where: { staffId: { in: staffIds }, action: { in: ["staff.login", "staff.login_failed"] } },
  });
}

async function main() {
  const cashier = await prisma.staff.findFirstOrThrow({
    where: { code: CASHIER_CODE },
    include: { branch: true },
  });
  const server = await prisma.staff.findFirstOrThrow({ where: { code: SERVER_CODE } });
  const branchId = cashier.branchId;

  await cleanup([cashier.id, server.id], branchId);

  console.log("── 1. ตัวนับ PIN ผิดอยู่ใน DB ────────────────────────────────────\n");

  const first = await recordFailedLogin(branchId, CASHIER_CODE);
  check("ผิดครั้งแรกนับเป็น 1", first === 1, String(first));

  const row = await prisma.staffLoginThrottle.findUnique({
    where: { branchId_staffCode: { branchId, staffCode: CASHIER_CODE } },
  });
  check(
    "ตัวนับถูกเขียนลงตาราง ไม่ใช่ค้างอยู่ใน memory ของ process",
    row !== null && row.failedCount === 1,
    `failedCount=${row?.failedCount}`,
  );
  check("ยังไม่ถูกล็อกตั้งแต่ครั้งแรก", (await checkLoginThrottle(branchId, CASHIER_CODE)).locked === false);

  for (let i = first + 1; i < MAX_FAILED_ATTEMPTS; i++) {
    await recordFailedLogin(branchId, CASHIER_CODE);
  }
  check(
    `ผิดครบ ${MAX_FAILED_ATTEMPTS - 1} ครั้งแล้วยังไม่ล็อก`,
    (await checkLoginThrottle(branchId, CASHIER_CODE)).locked === false,
  );

  const atLimit = await recordFailedLogin(branchId, CASHIER_CODE);
  const locked = await checkLoginThrottle(branchId, CASHIER_CODE);
  check(`ผิดครบ ${MAX_FAILED_ATTEMPTS} ครั้ง = ถูกล็อก`, atLimit === MAX_FAILED_ATTEMPTS && locked.locked === true, String(atLimit));
  check(
    "บอกได้ว่าเหลืออีกกี่นาที",
    locked.locked === true && locked.minutesLeft > 0 && locked.minutesLeft <= LOCKOUT_MINUTES,
    locked.locked ? `${locked.minutesLeft} นาที` : "",
  );

  /**
   * เส้นทางจริงที่ผู้ใช้เจอ: กรอกผิดจนโดนล็อก แล้ว `loginStaff()` ต้องปฏิเสธ
   * **ก่อนถึงขั้นตรวจ PIN** — ถ้าตรวจ PIN ก่อนแล้วค่อยดูล็อก คนที่เดา PIN ถูก
   * ในครั้งที่ 6 จะเข้าได้ทั้งที่ควรถูกล็อกอยู่
   */
  const blocked = await loginStaff(CASHIER_CODE, "1234", "pos");
  check(
    "loginStaff() ปฏิเสธตอนถูกล็อก แม้จะกรอก PIN มาถูกก็ตาม",
    blocked.ok === false && blocked.error.includes("ลองใหม่ในอีก"),
    blocked.ok ? "ผ่าน ซึ่งไม่ควรผ่าน" : blocked.error,
  );

  await clearLoginThrottle(branchId, CASHIER_CODE);
  check(
    "ล็อกอินสำเร็จ = ล้างตัวนับทิ้งทั้งแถว",
    (await prisma.staffLoginThrottle.count({ where: { branchId, staffCode: CASHIER_CODE } })) === 0,
  );

  /**
   * ตัวนับต้อง "ลืม" ความผิดที่นานมากแล้ว ไม่งั้นพนักงานที่พิมพ์ผิดสองครั้ง
   * เมื่อเดือนที่แล้วจะเหลือโควตาแค่สามครั้งไปตลอดกาล ซึ่งดูเหมือนระบบเสีย
   */
  await recordFailedLogin(branchId, SERVER_CODE);
  await recordFailedLogin(branchId, SERVER_CODE);
  await prisma.staffLoginThrottle.update({
    where: { branchId_staffCode: { branchId, staffCode: SERVER_CODE } },
    data: { firstFailedAt: new Date(Date.now() - 60 * 60 * 1000) },
  });
  const afterWindow = await recordFailedLogin(branchId, SERVER_CODE);
  check(
    "ความผิดที่เก่าเกินหน้าต่างเวลา = เริ่มนับใหม่จาก 1",
    afterWindow === 1,
    String(afterWindow),
  );

  const wrongPin = await loginStaff(SERVER_CODE, "0000", "pos");
  check(
    "PIN ผิด = ข้อความกลาง ๆ ไม่บอกว่ารหัสพนักงานมีอยู่จริงไหม",
    wrongPin.ok === false && wrongPin.error === "รหัสพนักงานหรือ PIN ไม่ถูกต้อง",
    wrongPin.ok ? "" : wrongPin.error,
  );
  const unknownCode = await loginStaff("ไม่มีรหัสนี้", "0000", "pos");
  check(
    "รหัสที่ไม่มีอยู่จริง = ข้อความเดียวกันเป๊ะ",
    unknownCode.ok === false && unknownCode.error === wrongPin.error,
    unknownCode.ok ? "" : unknownCode.error,
  );
  check(
    "PIN ผิดถูกบันทึกลง AuditLog ทุกครั้ง",
    (await prisma.auditLog.count({
      where: { staffId: server.id, action: "staff.login_failed" },
    })) > 0,
  );

  await clearLoginThrottle(branchId, SERVER_CODE);

  console.log("\n── 2. session ที่ยกเลิกได้ทันที ──────────────────────────────────\n");

  const posSession = await createStaffSession({
    staffId: cashier.id,
    branchId,
    screen: "pos",
    ipAddress: "127.0.0.1",
  });

  check("สร้าง session แล้วอ่านกลับมาได้", (await loadActiveStaffSession(posSession.id, "pos")) !== null);
  check(
    "session ของจอ POS ใช้กับจอครัวไม่ได้ (คนละ cookie คนละสิทธิ์)",
    (await loadActiveStaffSession(posSession.id, "kds")) === null,
  );
  check(
    "ไม่ระบุจอ = อ่านได้ (ทางเข้าเดียวที่ตั้งใจให้ผ่านคือ /api/realtime)",
    (await loadActiveStaffSession(posSession.id)) !== null,
  );
  check(
    "อ่าน session แล้วได้ข้อมูลพนักงาน+สาขามาด้วย ไม่ต้อง query ซ้ำ",
    (await loadActiveStaffSession(posSession.id, "pos"))?.staff.branch.id === branchId,
  );

  const revoked = await revokeStaffSession(posSession.id, {
    reason: SESSION_REVOKE_REASONS.logout,
  });
  check("ล็อกจอ = ปิด session หนึ่งใบ", revoked === 1, String(revoked));
  check(
    "ปิดแล้วใช้ต่อไม่ได้ทันที ไม่ต้องรอหมดอายุ",
    (await loadActiveStaffSession(posSession.id, "pos")) === null,
  );
  check(
    "ปิดซ้ำใบเดิมไม่นับเพิ่ม (กันกดรัวแล้วตัวเลขบนจอเพี้ยน)",
    (await revokeStaffSession(posSession.id, { reason: SESSION_REVOKE_REASONS.logout })) === 0,
  );

  const kept = await createStaffSession({ staffId: cashier.id, branchId, screen: "pos" });
  const other1 = await createStaffSession({ staffId: cashier.id, branchId, screen: "kds" });
  const other2 = await createStaffSession({ staffId: cashier.id, branchId, screen: "admin" });

  const kickedCount = await revokeAllStaffSessions(cashier.id, {
    reason: SESSION_REVOKE_REASONS.revokedAll,
    byStaffId: server.id,
    exceptSessionId: kept.id,
  });
  check("เตะออกทุกเครื่องคืนจำนวนใบที่ปิดจริง", kickedCount === 2, String(kickedCount));
  check("ใบที่ยกเว้นไว้ยังใช้ได้", (await loadActiveStaffSession(kept.id, "pos")) !== null);
  check(
    "ใบที่เหลือใช้ไม่ได้แล้วทั้งหมด",
    (await loadActiveStaffSession(other1.id, "kds")) === null &&
      (await loadActiveStaffSession(other2.id, "admin")) === null,
  );
  check(
    "บันทึกไว้ว่าใครเป็นคนเตะออก (ไม่ใช่แค่ว่าโดนเตะ)",
    (await prisma.staffSession.findUniqueOrThrow({ where: { id: other1.id } })).revokedByStaffId ===
      server.id,
  );

  /**
   * บัญชีถูกปิด = ทุกใบต้องใช้ไม่ได้ทันที **แม้ยังไม่ได้กด revoke**
   * เพราะการปิดบัญชีคือคำสั่งที่แรงกว่าการปิด session ทีละใบ
   */
  await prisma.staff.update({ where: { id: cashier.id }, data: { isActive: false } });
  check(
    "บัญชีถูกปิด = session ที่ยังไม่หมดอายุก็ใช้ไม่ได้",
    (await loadActiveStaffSession(kept.id, "pos")) === null,
  );
  await prisma.staff.update({ where: { id: cashier.id }, data: { isActive: true } });
  check(
    "เปิดบัญชีคืน = ใบเดิมกลับมาใช้ได้ (ยังไม่ได้ถูก revoke)",
    (await loadActiveStaffSession(kept.id, "pos")) !== null,
  );

  const expired = await createStaffSession({ staffId: server.id, branchId, screen: "pos" });
  await prisma.staffSession.update({
    where: { id: expired.id },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });
  check("session ที่หมดอายุใช้ไม่ได้", (await loadActiveStaffSession(expired.id, "pos")) === null);

  console.log("\n── 3. หน้าจอจัดการ: ใครล็อกอินอยู่ · ประวัติการเข้า ─────────────\n");

  const active = await listActiveStaffSessions(branchId);
  check(
    "ลิสต์เครื่องที่ล็อกอินอยู่เห็นใบที่ยังใช้ได้",
    active.some((session) => session.id === kept.id),
    `${active.length} ใบ`,
  );
  check(
    "ลิสต์ไม่มีใบที่ถูกปิดหรือหมดอายุปนมา",
    active.every((session) => session.id !== other1.id && session.id !== expired.id),
  );
  check(
    "ลิสต์บอกชื่อ/รหัส/ตำแหน่งของเจ้าของใบมาด้วย",
    active.find((session) => session.id === kept.id)?.staff.code === CASHIER_CODE,
  );

  const history = await listStaffLoginHistory(branchId, cashier.id);
  check(
    "ประวัติการเข้าเห็นใบที่ถูกปิดไปแล้วด้วย (ไม่ใช่ลบทิ้งตอนล็อกจอ)",
    history.some((entry) => entry.id === posSession.id),
    `${history.length} รายการ`,
  );
  check(
    "ประวัติบอกเหตุผลที่ถูกปิด",
    history.find((entry) => entry.id === other1.id)?.revokedReason ===
      SESSION_REVOKE_REASONS.revokedAll,
  );
  check(
    "ประวัติเรียงใหม่ไปเก่า",
    history.every(
      (entry, index) =>
        index === 0 || entry.createdAt.getTime() <= history[index - 1].createdAt.getTime(),
    ),
  );

  console.log("\n── 4. เก็บกวาดของเก่า ────────────────────────────────────────────\n");

  const ancient = await createStaffSession({ staffId: server.id, branchId, screen: "pos" });
  await prisma.staffSession.update({
    where: { id: ancient.id },
    data: { expiresAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000) },
  });

  await purgeExpiredStaffSessions();
  check(
    "ใบที่หมดอายุเกิน 30 วันถูกลบทิ้ง",
    (await prisma.staffSession.count({ where: { id: ancient.id } })) === 0,
  );
  check(
    "ใบที่เพิ่งหมดอายุยังอยู่ (ยังต้องตอบคำถามย้อนหลังได้)",
    (await prisma.staffSession.count({ where: { id: expired.id } })) === 1,
  );

  console.log("\n── ล้างข้อมูลที่สร้างระหว่างทดสอบ ───────────────────────────────\n");

  await cleanup([cashier.id, server.id], branchId);
  check(
    "ล้าง session ที่สร้างไว้หมดแล้ว",
    (await prisma.staffSession.count({ where: { staffId: { in: [cashier.id, server.id] } } })) === 0,
  );

  console.log(`\nรวม ${passed + failed} เคส — PASS ${passed} · FAIL ${failed}`);
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
