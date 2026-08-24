import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ReceiptDocument } from "@/components/receipt-document";
import { ReceiptPrintButton } from "@/components/receipt-print-button";
import { canAccessScreen, canBrowseReceipts, canReprintReceipt } from "@/lib/rbac";
import { salePointDisplayName } from "@/lib/sale-point";
import { getReceipt } from "@/lib/server/receipt";
import { getCurrentStaff } from "@/lib/server/staff-session";

import { adminPrintReceiptAction } from "../../actions";

/**
 * ใบเสร็จบนจอหลังร้าน (บทที่ 12)
 *
 * คู่แฝดของ app/(pos)/pos/receipt/[receiptId]/page.tsx — ต่างกันแค่ cookie
 * ที่อ่านกับทางกลับ ส่วนตัวเอกสารเป็นคอมโพเนนต์เดียวกัน
 *
 * **สองสิทธิ์ ไม่ใช่หนึ่ง:** เปิดหน้านี้ต้อง canBrowseReceipts (เห็นยอดขายย้อนหลัง)
 * แต่ปุ่มพิมพ์ต้อง canReprintReceipt ซึ่งเป็นคนละชุด — ผู้จัดการได้ทั้งคู่
 * ส่วนแคชเชียร์พิมพ์ได้แต่ค้นย้อนหลังไม่ได้ จึงเข้าถึงใบผ่านจอ POS เท่านั้น
 */
export default async function AdminReceiptPage({
  params,
}: {
  params: Promise<{ receiptId: string }>;
}) {
  const staff = await getCurrentStaff("admin");

  if (!staff || !canAccessScreen(staff.role, "admin")) {
    redirect("/admin/login");
  }

  if (!canBrowseReceipts(staff.role)) {
    return (
      <main className="flex min-h-0 flex-1 flex-col overflow-auto p-4 lg:p-6">
        <div className="panel mx-auto mt-8 flex max-w-[520px] flex-col gap-2 p-6">
          <span className="display text-[20px]">ดูใบเสร็จย้อนหลังไม่ได้</span>
          <p className="text-[var(--color-neutral-700)]">
            ลิสต์ใบเสร็จแสดงยอดขายทั้งสาขา จึงจำกัดไว้ที่เจ้าของและผู้จัดการ —
            ถ้าต้องพิมพ์ใบให้ลูกค้าที่ยืนอยู่ตรงหน้า ให้เปิดจากหน้าคิดเงินที่จอ POS
          </p>
        </div>
      </main>
    );
  }

  const { receiptId } = await params;
  const detail = await getReceipt(staff.branchId, receiptId);

  if (!detail) {
    notFound();
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-auto bg-[var(--color-neutral-100)]">
      <div
        data-print-hide
        className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-[var(--color-text)] bg-[var(--color-bg)] px-4 py-3 lg:px-6"
      >
        <div className="flex min-w-0 flex-col">
          <span className="display text-[17px]">ใบเสร็จ {detail.receipt.number}</span>
          <span className="kicker">
            {salePointDisplayName(detail.payment.tableSession.table, detail.payment.tableSession)}{" "}
            · พิมพ์แล้ว {detail.receipt.printCount} ครั้ง
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link href="/admin/receipts" className="btn btn-ghost h-10 text-[14px]">
            ‹ กลับไปลิสต์ใบเสร็จ
          </Link>

          {canReprintReceipt(staff.role) ? (
            <ReceiptPrintButton
              action={adminPrintReceiptAction.bind(null, detail.receipt.id)}
              className="btn btn-primary h-10 text-[14px]"
            />
          ) : (
            <span className="kicker">ตำแหน่งของคุณพิมพ์ใบเสร็จไม่ได้</span>
          )}
        </div>
      </div>

      <div className="flex-1 p-4 lg:p-8">
        <ReceiptDocument detail={detail} />
      </div>
    </main>
  );
}
