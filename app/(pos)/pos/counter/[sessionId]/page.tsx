import { notFound, redirect } from "next/navigation";

import { canAccessScreen } from "@/lib/rbac";
import { salePointDisplayName } from "@/lib/sale-point";
import { getT } from "@/lib/server/locale";
import { getPosSession } from "@/lib/server/pos";
import { getCurrentStaff } from "@/lib/server/staff-session";

import { SalePointScreen } from "../../_components/sale-point-screen";

/**
 * จอสั่งอาหารของ "บิลซื้อกลับหนึ่งใบ"
 *
 * ── ทำไม route ชี้ด้วย sessionId ไม่ใช่ tableId ─────────────────────────
 * เคาน์เตอร์มีบิลเปิดพร้อมกันได้หลายใบ (ลูกค้าต่อคิวกันสามคน) ที่อยู่ที่ชี้ด้วย
 * จุดขายจึงกำกวม — `/pos/counter/<เคาน์เตอร์>` ตอบไม่ได้ว่าหมายถึงบิลใบไหน
 * และถ้าให้ระบบเดา ("รอบล่าสุด") พนักงานจะกดเพิ่มของให้คิว 12 แล้วของไปโผล่
 * ในบิลของคิว 14 โดยที่หน้าจอดูปกติทุกอย่าง
 *
 * หน้าตาและตรรกะทั้งหมดใช้ `SalePointScreen` ตัวเดียวกับโต๊ะนั่ง
 * ต่างกันแค่ base ของลิงก์กับข้อความบนหัวจอ
 */
export default async function PosCounterBillPage({
  params,
  searchParams,
}: {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<{ view?: string; cat?: string }>;
}) {
  const { t } = await getT();
  const staff = await getCurrentStaff("pos");

  if (!staff || !canAccessScreen(staff.role, "pos")) {
    redirect("/pos/login");
  }

  const { sessionId } = await params;
  const detail = await getPosSession(staff.branchId, sessionId);

  /**
   * ไม่เจอ = บิลถูกปิดไปแล้ว (รับเงินเสร็จ) หรือไม่ใช่บิลของสาขานี้
   * ทั้งสองกรณีจบที่ 404 เหมือนกัน — บิลที่ปิดแล้วต้องไปดูที่ใบเสร็จ (บทที่ 12)
   * ไม่ใช่กลับมาสั่งของเพิ่มในรอบที่ปิดไปแล้ว
   */
  if (!detail?.session) {
    notFound();
  }

  const { view, cat } = await searchParams;
  const { table, session } = detail;

  return (
    <SalePointScreen
      staff={staff}
      detail={detail}
      base={`/pos/counter/${session.id}`}
      backHref="/pos/counter"
      heading={salePointDisplayName(table, session, t)}
      subtitle={`${table.name} · ${t("pos.subtitle.opened", {
        time: formatTime(session.openedAt, staff.branch.timezone),
      })}${session.customerName ? ` · ${session.customerName}` : ""}`}
      view={view}
      cat={cat}
    />
  );
}

function formatTime(value: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit" }).format(
    value,
  );
}
