import { notFound, redirect } from "next/navigation";

import { canAccessScreen } from "@/lib/rbac";
import { salePointDisplayName } from "@/lib/sale-point";
import { getSessionBill } from "@/lib/server/billing";
import { getT } from "@/lib/server/locale";
import { getPayment } from "@/lib/server/payment";
import { getCurrentStaff } from "@/lib/server/staff-session";

import { BillScreen, PaidSummary } from "../../../_components/bill-screen";

/**
 * หน้าคิดเงิน/รับเงินของบิลซื้อกลับหนึ่งใบ
 *
 * ── ต่างจากหน้าโต๊ะตรงไหน ────────────────────────────────────────────────
 * ใช้ `getSessionBill()` ไม่ใช่ `getTableBill()` เพราะเคาน์เตอร์มีบิลเปิดพร้อมกัน
 * หลายใบ — ถามด้วยจุดขายจะได้บิลของคนที่มาทีหลังเสมอ แล้วคนแรกที่ยืนรอจ่ายเงิน
 * จะเห็นบิลว่างเปล่า
 *
 * และส่ง `sessionId` ต่อเข้าไปในแผงรับเงิน เพื่อให้ `takePayment()` ปิดถูกใบ
 * (ถ้าไม่ส่ง มันจะปฏิเสธแทนที่จะเดา — ดู lib/server/payment.ts)
 */
export default async function PosCounterBillPage({
  params,
  searchParams,
}: {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<{ paid?: string }>;
}) {
  const { t } = await getT();
  const staff = await getCurrentStaff("pos");

  if (!staff || !canAccessScreen(staff.role, "pos")) {
    redirect("/pos/login");
  }

  const { sessionId } = await params;
  const { paid } = await searchParams;

  if (paid) {
    const receipt = await getPayment(staff.branchId, paid);

    /**
     * บิลปิดไปแล้ว รอบขายจึงหายไปด้วย — ปุ่มกลับต้องพาไป **แถบคิว**
     * ไม่ใช่กลับไปที่บิลใบเดิมซึ่งตอนนี้ 404 ไปแล้ว
     */
    if (receipt) {
      return <PaidSummary receipt={receipt} base="/pos/counter" />;
    }
  }

  const detail = await getSessionBill(staff.branchId, sessionId);

  if (!detail?.session) {
    notFound();
  }

  return (
    <BillScreen
      staff={staff}
      detail={detail}
      base={`/pos/counter/${sessionId}`}
      heading={`${t("pos.tab.checkout")} · ${salePointDisplayName(detail.table, detail.session, t)}`}
      sessionId={detail.session.id}
    />
  );
}
