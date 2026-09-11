import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ReceiptDocument } from "@/components/receipt-document";
import { ReceiptPrintButton } from "@/components/receipt-print-button";
import { canAccessScreen, canReprintReceipt } from "@/lib/rbac";
import { salePointBasePath, salePointDisplayName, showsInTableMap } from "@/lib/sale-point";
import { getT } from "@/lib/server/locale";
import { getReceipt } from "@/lib/server/receipt";
import { getCurrentStaff } from "@/lib/server/staff-session";

import { posPrintReceiptAction } from "../../actions";

/**
 * ใบเสร็จบนจอ POS (บทที่ 12)
 *
 * เส้นทางบาง ๆ ที่ทำหน้าที่แค่ **ด่าน session ของจอนี้** แล้วส่งต่อให้
 * `<ReceiptDocument>` ซึ่งเป็นตัวเดียวกับที่ /admin/receipts/[id] ใช้
 * — ห้ามใส่ตรรกะการวางเอกสารลงในไฟล์นี้เด็ดขาด (ดูเหตุผลในคอมโพเนนต์นั้น)
 */
export default async function PosReceiptPage({
  params,
}: {
  params: Promise<{ receiptId: string }>;
}) {
  const { t } = await getT();
  const staff = await getCurrentStaff("pos");

  if (!staff || !canAccessScreen(staff.role, "pos")) {
    redirect("/pos/login");
  }

  const { receiptId } = await params;
  const detail = await getReceipt(staff.branchId, receiptId);

  if (!detail) {
    notFound();
  }

  const { table } = detail.payment.tableSession;

  /**
   * ปุ่มกลับต้องพาไป URL ตระกูลของจุดขายนั้น ไม่ใช่ `/pos/table/...` เสมอ
   * — บิลซื้อกลับชี้ด้วย sessionId เพราะเคาน์เตอร์มีบิลเปิดพร้อมกันได้หลายใบ
   */
  const base = salePointBasePath(table, detail.payment.tableSession);

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-auto bg-[var(--color-neutral-100)]">
      {/* แถบนี้เป็นของ "หน้าจอ" ไม่ใช่ของ "เอกสาร" จึงต้องไม่ติดไปกับกระดาษ */}
      <div
        data-print-hide
        className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-[var(--color-text)] bg-[var(--color-bg)] px-4 py-3 lg:px-6"
      >
        <div className="flex min-w-0 flex-col">
          <span className="display text-[17px]">Receipt {detail.receipt.number}</span>
          <span className="kicker">
            {salePointDisplayName(table, detail.payment.tableSession, t)} · printed{" "}
            {detail.receipt.printCount} time(s)
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link href={`${base}/bill?paid=${detail.payment.id}`} className="btn btn-ghost h-10 text-[14px]">
            ‹ Back to payment summary
          </Link>
          {showsInTableMap(table.kind) ? (
            <Link href="/pos" className="btn btn-secondary h-10 text-[14px]">
              Table map
            </Link>
          ) : (
            <Link href="/pos/counter" className="btn btn-secondary h-10 text-[14px]">
              Takeaway queue
            </Link>
          )}

          {/*
            ซ่อนปุ่มตามสิทธิ์ **และ** ตรวจซ้ำฝั่ง server ใน recordReceiptPrint()
            — การซ่อนปุ่มไม่ใช่การกันสิทธิ์ (กฎประจำโปรเจกต์)
          */}
          {canReprintReceipt(staff.role) ? (
            <ReceiptPrintButton
              action={posPrintReceiptAction.bind(null, detail.receipt.id)}
              className="btn btn-primary h-10 text-[14px]"
            />
          ) : (
            <span className="kicker">Your role can&apos;t print receipts</span>
          )}
        </div>
      </div>

      <div className="flex-1 p-4 lg:p-8">
        <ReceiptDocument detail={detail} />
      </div>
    </main>
  );
}
