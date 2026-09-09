import "dotenv/config";

import { canAssignRole, canManageStaff } from "@/lib/rbac";
import { prisma } from "@/lib/server/db";
import { verifyPin } from "@/lib/server/pin";
import {
  createStaffMember,
  getStaffMember,
  listStaff,
  resetStaffPin,
  revokeStaffSessions,
  updateStaffMember,
} from "@/lib/server/staff-admin";
import type { CurrentStaff } from "@/lib/server/staff-session";
import { createStaffSession, loadActiveStaffSession } from "@/lib/server/staff-session-store";

/**
 * Smoke test ของหน้าจัดการพนักงาน (บทที่ 13b · spec §12 §13)
 *
 *     npm run smoke:staff-admin
 *
 * ── สิ่งที่ต้องพิสูจน์ และเป็นเหตุผลที่เขียนเทสต์ก่อนทำหน้าจอ ──────────────
 *   1. **ผู้จัดการตั้งบัญชี OWNER ให้ตัวเองไม่ได้** — ถ้าทำได้ สิทธิ์ทั้งระบบ
 *      ไม่มีความหมายเลย เพราะข้ามได้ในสองคลิก
 *   2. **รีเซ็ต PIN / ปิดบัญชี = เตะ session ทุกใบทันที** ไม่งั้นเครื่องที่เปิด
 *      ค้างอยู่ยังใช้ต่อได้จนหมดอายุ แล้วการรีเซ็ตแทบไม่มีความหมาย
 *   3. **ต้องเหลือเจ้าของร้านที่ใช้งานได้เสมอ** ไม่งั้นร้านจะล็อกตัวเองออกถาวร
 *
 * ใช้พนักงานที่สร้างขึ้นเองทั้งหมด (รหัสขึ้นต้น `T9`) แล้วลบทิ้งตอนจบ
 * — ไม่แตะพนักงาน seed เพื่อไม่ให้ชนกับ smoke ชุดอื่นที่ล็อกอินด้วยรหัสเดิม
 */

const PREFIX = "T9";

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

async function cleanup(branchId: string) {
  const created = await prisma.staff.findMany({
    where: { branchId, code: { startsWith: PREFIX } },
    select: { id: true },
  });
  const ids = created.map((row) => row.id);

  if (ids.length === 0) {
    return;
  }

  await prisma.staffSession.deleteMany({ where: { staffId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { entityType: "staff", entityId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { staffId: { in: ids } } });
  await prisma.staff.deleteMany({ where: { id: { in: ids } } });
}

async function main() {
  const owner = (await prisma.staff.findFirstOrThrow({
    where: { code: "001" },
    include: { branch: true },
  })) as CurrentStaff;
  const branchId = owner.branchId;

  await cleanup(branchId);

  console.log("── 1. ลำดับชั้นของตำแหน่ง (ตรรกะบริสุทธิ์) ───────────────────────\n");

  check("เจ้าของร้านจัดการพนักงานได้", canManageStaff("OWNER") === true);
  check("ผู้จัดการจัดการพนักงานได้", canManageStaff("MANAGER") === true);
  check("แคชเชียร์จัดการพนักงานไม่ได้", canManageStaff("CASHIER") === false);
  check("ครัวจัดการพนักงานไม่ได้", canManageStaff("KITCHEN") === false);

  check("เจ้าของร้านตั้งใครเป็นอะไรก็ได้", canAssignRole("OWNER", "OWNER") === true);
  check("ผู้จัดการตั้งคนเป็นเจ้าของร้านไม่ได้", canAssignRole("MANAGER", "OWNER") === false);
  check("ผู้จัดการตั้งคนเป็นผู้จัดการไม่ได้ (ตำแหน่งเท่ากัน)", canAssignRole("MANAGER", "MANAGER") === false);
  check("ผู้จัดการตั้งคนเป็นแคชเชียร์ได้", canAssignRole("MANAGER", "CASHIER") === true);
  check("แคชเชียร์ตั้งใครไม่ได้เลย", canAssignRole("CASHIER", "SERVER") === false);

  console.log("\n── 2. เพิ่มพนักงาน ───────────────────────────────────────────────\n");

  const created = await createStaffMember(owner, {
    code: `${PREFIX}01`,
    name: "ทดสอบ แคชเชียร์",
    role: "CASHIER",
    pin: "4321",
  });
  check("เพิ่มพนักงานใหม่ได้", created.ok === true, created.ok ? "" : created.errorKey);

  if (!created.ok) {
    throw new Error("เพิ่มพนักงานไม่สำเร็จ ทดสอบต่อไม่ได้");
  }

  const cashierId = created.staffId as string;
  const cashierRow = await prisma.staff.findUniqueOrThrow({ where: { id: cashierId } });

  check("PIN ถูกเก็บเป็น hash ไม่ใช่ตัวเลขดิบ", !cashierRow.pinHash.includes("4321"));
  check("PIN ที่ตั้งไว้ใช้ยืนยันได้จริง", verifyPin("4321", cashierRow.pinHash) === true);
  check("บัญชีใหม่เปิดใช้งานอยู่", cashierRow.isActive === true);

  const duplicate = await createStaffMember(owner, {
    code: `${PREFIX}01`,
    name: "ซ้ำ",
    role: "SERVER",
    pin: "1111",
  });
  check("รหัสพนักงานซ้ำในสาขาเดียวกัน = ปฏิเสธ", duplicate.ok === false, duplicate.ok ? "" : duplicate.errorKey);

  const shortPin = await createStaffMember(owner, {
    code: `${PREFIX}02`,
    name: "พินสั้น",
    role: "SERVER",
    pin: "12",
  });
  check("PIN สั้นเกินไป = ปฏิเสธ", shortPin.ok === false, shortPin.ok ? "" : shortPin.errorKey);

  const letterPin = await createStaffMember(owner, {
    code: `${PREFIX}02`,
    name: "พินมีตัวอักษร",
    role: "SERVER",
    pin: "12ab",
  });
  check("PIN ที่ไม่ใช่ตัวเลขล้วน = ปฏิเสธ", letterPin.ok === false, letterPin.ok ? "" : letterPin.errorKey);

  const managerCreated = await createStaffMember(owner, {
    code: `${PREFIX}03`,
    name: "ทดสอบ ผู้จัดการ",
    role: "MANAGER",
    pin: "5678",
  });
  check("เจ้าของร้านตั้งผู้จัดการได้", managerCreated.ok === true, managerCreated.ok ? "" : managerCreated.errorKey);

  const manager = (await prisma.staff.findFirstOrThrow({
    where: { code: `${PREFIX}03` },
    include: { branch: true },
  })) as CurrentStaff;

  console.log("\n── 3. กันการยกระดับสิทธิ์ตัวเอง ──────────────────────────────────\n");

  const escalate = await createStaffMember(manager, {
    code: `${PREFIX}04`,
    name: "เจ้าของปลอม",
    role: "OWNER",
    pin: "9999",
  });
  check(
    "ผู้จัดการสร้างบัญชีตำแหน่งเจ้าของร้านไม่ได้",
    escalate.ok === false,
    escalate.ok ? "สร้างได้ ซึ่งไม่ควรได้" : escalate.errorKey,
  );

  const promoteSelf = await updateStaffMember(manager, cashierId, {
    code: `${PREFIX}01`,
    name: "ทดสอบ แคชเชียร์",
    role: "OWNER",
    isActive: true,
  });
  check(
    "ผู้จัดการเลื่อนคนอื่นขึ้นเป็นเจ้าของร้านไม่ได้",
    promoteSelf.ok === false,
    promoteSelf.ok ? "" : promoteSelf.errorKey,
  );

  const editOwner = await updateStaffMember(manager, owner.id, {
    code: owner.code,
    name: owner.name,
    role: "SERVER",
    isActive: true,
  });
  check(
    "ผู้จัดการแก้บัญชีของเจ้าของร้านไม่ได้",
    editOwner.ok === false,
    editOwner.ok ? "" : editOwner.errorKey,
  );

  const resetOwnerPin = await resetStaffPin(manager, owner.id, "0000");
  check(
    "ผู้จัดการรีเซ็ต PIN ของเจ้าของร้านไม่ได้ (ไม่งั้นเข้าบัญชีเจ้าของได้ทันที)",
    resetOwnerPin.ok === false,
    resetOwnerPin.ok ? "" : resetOwnerPin.errorKey,
  );

  const editSelf = await updateStaffMember(manager, manager.id, {
    code: manager.code,
    name: manager.name,
    role: "MANAGER",
    isActive: true,
  });
  check("แก้บัญชีตัวเองจากหน้านี้ไม่ได้", editSelf.ok === false, editSelf.ok ? "" : editSelf.errorKey);

  const byCashier = await createStaffMember(
    { ...manager, role: "CASHIER" } as CurrentStaff,
    { code: `${PREFIX}05`, name: "โดยแคชเชียร์", role: "SERVER", pin: "2222" },
  );
  check("แคชเชียร์เพิ่มพนักงานไม่ได้", byCashier.ok === false, byCashier.ok ? "" : byCashier.errorKey);

  console.log("\n── 4. รีเซ็ต PIN แล้วเครื่องที่ค้างอยู่ต้องหลุดทันที ─────────────\n");

  const posSession = await createStaffSession({ staffId: cashierId, branchId, screen: "pos" });
  const kdsSession = await createStaffSession({ staffId: cashierId, branchId, screen: "kds" });
  check("จำลองว่าคนนี้ล็อกอินค้างอยู่สองเครื่อง", (await loadActiveStaffSession(posSession.id, "pos")) !== null);

  const reset = await resetStaffPin(manager, cashierId, "8765");
  check("ผู้จัดการรีเซ็ต PIN ของแคชเชียร์ได้", reset.ok === true, reset.ok ? "" : reset.errorKey);
  check(
    "บอกจำนวนเครื่องที่ถูกเตะออกกลับมาด้วย",
    reset.ok === true && reset.revokedSessions === 2,
    reset.ok ? String(reset.revokedSessions) : "",
  );
  check(
    "ทั้งสองเครื่องใช้ต่อไม่ได้ทันที",
    (await loadActiveStaffSession(posSession.id, "pos")) === null &&
      (await loadActiveStaffSession(kdsSession.id, "kds")) === null,
  );

  const afterReset = await prisma.staff.findUniqueOrThrow({ where: { id: cashierId } });
  check("PIN ใหม่ใช้ได้", verifyPin("8765", afterReset.pinHash) === true);
  check("PIN เก่าใช้ไม่ได้แล้ว", verifyPin("4321", afterReset.pinHash) === false);

  const pinLog = await prisma.auditLog.findFirst({
    where: { action: "staff.pin_reset", entityId: cashierId },
    orderBy: { createdAt: "desc" },
  });
  check("เขียน AuditLog ตอนรีเซ็ต PIN", pinLog !== null);
  check(
    "ห้ามมี PIN หรือ hash อยู่ใน log เด็ดขาด",
    pinLog !== null && !JSON.stringify(pinLog.metadata).includes("8765") &&
      !JSON.stringify(pinLog.metadata).includes("scrypt$"),
  );

  console.log("\n── 5. ปิดบัญชี ───────────────────────────────────────────────────\n");

  const stillOpen = await createStaffSession({ staffId: cashierId, branchId, screen: "pos" });
  const deactivated = await updateStaffMember(manager, cashierId, {
    code: `${PREFIX}01`,
    name: "ทดสอบ แคชเชียร์",
    role: "CASHIER",
    isActive: false,
  });
  check("ปิดบัญชีได้", deactivated.ok === true, deactivated.ok ? "" : deactivated.errorKey);
  check(
    "ปิดบัญชีแล้วเครื่องที่ค้างอยู่หลุดทันที",
    (await loadActiveStaffSession(stillOpen.id, "pos")) === null,
  );

  const deactivateLog = await prisma.auditLog.findFirst({
    where: { action: "staff.deactivate", entityId: cashierId },
    orderBy: { createdAt: "desc" },
  });
  check("เขียน AuditLog แยก action ตอนปิดบัญชี", deactivateLog !== null);
  check(
    "log เก็บค่าก่อน-หลังไว้ทั้งคู่",
    deactivateLog !== null &&
      JSON.stringify(deactivateLog.metadata).includes("before") &&
      JSON.stringify(deactivateLog.metadata).includes("after"),
  );

  /**
   * เคสที่ทำให้ร้านล็อกตัวเองออกถาวร: เจ้าของร้านคนสุดท้ายปิดบัญชีตัวเอง
   *
   * ⚠ ด่านที่ปฏิเสธจริงคือ "ห้ามแก้บัญชีตัวเอง" ไม่ใช่ด่าน "ต้องเหลือเจ้าของร้าน"
   * — เทียบข้อความที่ได้กลับมาให้ตรงตัวด้วย ไม่งั้นเทสต์นี้จะยังเขียวอยู่แม้วันที่
   * ด่านแรกถูกถอดออกไป ซึ่งเป็นวันที่มันควรจะแดงที่สุด
   * (ด่าน "ต้องเหลือเจ้าของร้าน" ใน updateStaffMember() เป็นตาข่ายรองรับที่
   * ยังเรียกไม่ถึงตราบใดที่ด่านแรกยังอยู่ — ดูคอมเมนต์ที่ฟังก์ชันนั้น)
   */
  const closeLastOwner = await updateStaffMember(owner, owner.id, {
    code: owner.code,
    name: owner.name,
    role: "OWNER",
    isActive: false,
  });
  check(
    "เจ้าของร้านปิดบัญชีตัวเองไม่ได้ (ถูกด่าน 'ห้ามแก้บัญชีตัวเอง' ปฏิเสธ)",
    closeLastOwner.ok === false && closeLastOwner.errorKey.includes("บัญชีของตัวเอง"),
    closeLastOwner.ok ? "ผ่าน ซึ่งไม่ควรผ่าน" : closeLastOwner.errorKey,
  );

  console.log("\n── 6. เตะออกทุกเครื่อง + ลิสต์บนหน้าจอ ──────────────────────────\n");

  await prisma.staff.update({ where: { id: cashierId }, data: { isActive: true } });
  const s1 = await createStaffSession({ staffId: cashierId, branchId, screen: "pos" });
  await createStaffSession({ staffId: cashierId, branchId, screen: "admin" });

  const list = await listStaff(branchId);
  const listed = list.find((row) => row.id === cashierId);
  check("ลิสต์พนักงานเห็นคนที่เพิ่งสร้าง", listed !== undefined, `${list.length} คน`);
  check("ลิสต์บอกจำนวนเครื่องที่ล็อกอินค้างอยู่", listed?.activeSessions === 2, String(listed?.activeSessions));

  const kicked = await revokeStaffSessions(manager, cashierId);
  check("เตะออกทุกเครื่องได้", kicked.ok === true && kicked.revokedSessions === 2, kicked.ok ? String(kicked.revokedSessions) : kicked.errorKey);
  check("เตะแล้วใช้ต่อไม่ได้", (await loadActiveStaffSession(s1.id, "pos")) === null);

  const detail = await getStaffMember(branchId, cashierId);
  check("หน้ารายคนอ่านข้อมูลได้", detail !== null && detail.staff.id === cashierId);
  check("หน้ารายคนไม่เหลือเครื่องที่ล็อกอินอยู่แล้ว", detail?.sessions.length === 0);
  check(
    "หน้ารายคนยังเห็นประวัติการเข้าย้อนหลัง",
    (detail?.history.length ?? 0) > 0,
    `${detail?.history.length} รายการ`,
  );

  const otherBranch = await getStaffMember("ไม่มีสาขานี้", cashierId);
  check("ถามข้ามสาขาไม่ได้", otherBranch === null);

  console.log("\n── ล้างข้อมูลที่สร้างระหว่างทดสอบ ───────────────────────────────\n");

  await cleanup(branchId);
  check(
    "ล้างพนักงานทดสอบหมดแล้ว",
    (await prisma.staff.count({ where: { branchId, code: { startsWith: PREFIX } } })) === 0,
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
