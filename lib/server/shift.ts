import "server-only";

import { Prisma } from "@/lib/generated/prisma/client";
import type { MessageKey } from "@/lib/i18n/vi";
import { canManageShift } from "@/lib/rbac";
import { REALTIME_EVENT_VERSION } from "@/lib/realtime-events";
import { prisma } from "@/lib/server/db";
import { publishRealtimeEvent } from "@/lib/server/realtime";
import type { CurrentStaff } from "@/lib/server/staff-session";

/**
 * กะการขาย (บทที่ 15)
 *
 * ── หนึ่งสาขา = หนึ่งกะที่เปิดอยู่ ──────────────────────────────────────
 * ร้านมีลิ้นชักเดียว ใครรับเงินก็เข้ากะเดียวกัน — ถ้าวันหนึ่งต้องมีหลายลิ้นชัก
 * ต้องเพิ่มคอลัมน์ `register` ที่ `Shift` **ห้ามแก้เป็น "หนึ่งคนหนึ่งกะ" เฉย ๆ**
 * เพราะเงินในลิ้นชักใบเดียวจะถูกนับซ้ำโดยสองคน
 *
 * ── ระบบกะไม่ใช่ด่านขวางการขาย ─────────────────────────────────────────
 * ไม่มีกะเปิดก็รับเงินได้ (`Payment.shiftId = null`) เงินพวกนั้นถูกนับแยกและ
 * แสดงบนหน้าเปิดกะ — ร้านที่ลืมเปิดกะต้องขายได้ต่อไป ไม่ใช่หยุดรับเงินทั้งร้าน
 *
 * ── ไฟล์นี้ไม่แปลภาษา ──────────────────────────────────────────────────
 * คืน `errorKey` ให้หน้าจอไปแปลเอง (กฎจากก้อน i18n) — smoke จึงตรวจ **คีย์**
 * ไม่ใช่ประโยค ซึ่งไม่พังเมื่อมีคนแก้ถ้อยคำในพจนานุกรม
 */

type ShiftFailure = { ok: false; errorKey: MessageKey };

/** กะที่เปิดอยู่ของสาขานี้ — null = ยังไม่ได้เปิดกะ */
export async function getOpenShift(branchId: string) {
  return prisma.shift.findFirst({
    where: { branchId, status: "OPEN" },
    orderBy: { openedAt: "desc" },
  });
}

export async function openShift(
  staff: CurrentStaff,
  input: { openingFloat: number },
): Promise<{ ok: true; shiftId: string } | ShiftFailure> {
  // การซ่อนปุ่มบนหน้าจอไม่ใช่การกันสิทธิ์ — action ถูกยิงตรงด้วย POST ได้
  if (!canManageShift(staff.role)) {
    return { ok: false, errorKey: "error.cannot_manage_shift" };
  }

  if (!Number.isInteger(input.openingFloat) || input.openingFloat < 0) {
    return { ok: false, errorKey: "error.opening_float_invalid" };
  }

  try {
    const shift = await prisma.$transaction(async (tx) => {
      const created = await tx.shift.create({
        data: {
          branchId: staff.branchId,
          openedByStaffId: staff.id,
          openingFloat: input.openingFloat,
        },
        select: { id: true },
      });

      await tx.auditLog.create({
        data: {
          branchId: staff.branchId,
          staffId: staff.id,
          action: "shift.open",
          entityType: "shift",
          entityId: created.id,
          metadata: { openingFloat: input.openingFloat },
        },
      });

      return created;
    });

    await publishRealtimeEvent({
      v: REALTIME_EVENT_VERSION,
      type: "shift.changed",
      branchId: staff.branchId,
      tableId: null,
      at: Date.now(),
    });

    return { ok: true, shiftId: shift.id };
  } catch (error) {
    /**
     * ชนกับ partial unique index = มีกะเปิดอยู่แล้ว
     *
     * ปล่อยให้ฐานเป็นคนตอบแทนที่จะ "อ่านก่อนแล้วค่อยสร้าง" เพราะสองคำสั่งนั้น
     * มีช่องว่างระหว่างกัน — สองเครื่องที่กดพร้อมกันจะผ่านด่านอ่านทั้งคู่
     */
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: false, errorKey: "error.shift_already_open" };
    }

    throw error;
  }
}
