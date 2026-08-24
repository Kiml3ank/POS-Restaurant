import { notFound, redirect } from "next/navigation";

import { canAccessScreen } from "@/lib/rbac";
import { getTableBill } from "@/lib/server/billing";
import { getPayment } from "@/lib/server/payment";
import { getCurrentStaff } from "@/lib/server/staff-session";

import { BillScreen, PaidSummary } from "../../../_components/bill-screen";

/**
 * หน้าคิดเงิน/รับเงินของโต๊ะนั่ง (บทที่ 10 คิด · บทที่ 11 รับ)
 *
 * เหลือแค่ "หาบิลของโต๊ะนี้แล้วส่งให้จอกลาง" — หน้าตาและตรรกะอยู่ที่ `BillScreen`
 * ซึ่งใช้ร่วมกับ `/pos/counter/[sessionId]/bill` **ตัวเดียวกันจริง ๆ**
 */
export default async function PosBillPage({
  params,
  searchParams,
}: {
  params: Promise<{ tableId: string }>;
  searchParams: Promise<{ paid?: string }>;
}) {
  const staff = await getCurrentStaff("pos");

  if (!staff || !canAccessScreen(staff.role, "pos")) {
    redirect("/pos/login");
  }

  const { tableId } = await params;
  const { paid } = await searchParams;
  const base = `/pos/table/${tableId}`;

  if (paid) {
    const receipt = await getPayment(staff.branchId, paid);

    /**
     * ไม่พบใบที่อ้างถึง (พิมพ์ URL มั่ว หรือของสาขาอื่น) → ตกลงไปโหมดปกติ
     * ไม่ใช่ 404 เพราะโต๊ะยังมีอยู่จริงและอาจมีบิลใหม่เปิดอยู่แล้ว
     */
    if (receipt) {
      return <PaidSummary receipt={receipt} base={base} />;
    }
  }

  const detail = await getTableBill(staff.branchId, tableId);

  if (!detail) {
    notFound();
  }

  return (
    <BillScreen
      staff={staff}
      detail={detail}
      base={base}
      heading={`คิดเงิน · โต๊ะ ${detail.table.name}`}
    />
  );
}
