"use client";

import { useState, useTransition } from "react";
import { useT } from "@/components/i18n-provider";
import type { MessageParams } from "@/lib/i18n/translate";
import type { MessageKey } from "@/lib/i18n/vi";

/**
 * ปุ่มพิมพ์ใบเสร็จ (บทที่ 12)
 *
 * ── ทำไมต้องบันทึกก่อน แล้วค่อยสั่งพิมพ์ ────────────────────────────────
 * `printCount` คือตัวเลขที่ตอบคำถาม "ใบนี้ถูกออกไปกี่ใบ" ตอนตรวจสอบย้อนหลัง
 * จึงต้องนับจาก **การกระทำที่ตั้งใจ** ไม่ใช่จาก event ของเบราว์เซอร์:
 * `onafterprint` ยิงตอนผู้ใช้กด Ctrl+P เองด้วย ยิงตอนกดยกเลิกในกล่องพิมพ์ด้วย
 * และแต่ละเบราว์เซอร์ยิงไม่เหมือนกัน — "เปิดหน้าดูเฉย ๆ" ต้องไม่ถูกนับ
 *
 * ถ้าบันทึกไม่สำเร็จ **จะไม่เปิดกล่องพิมพ์เลย** เพราะใบที่ออกไปโดยไม่มีร่องรอย
 * แย่กว่าใบที่พิมพ์ไม่ออก — พิมพ์ใหม่ได้เสมอ แต่ย้อนไปเขียน log ไม่ได้
 *
 * `router.refresh()` ไม่ต้องเรียกเอง — Server Action ฝั่งนั้นสั่ง refresh ให้แล้ว
 * ป้าย "สำเนา" บนหัวใบจึงอัปเดตทันหน้าที่กำลังจะถูกพิมพ์
 */
export function ReceiptPrintButton({
  action,
  className = "",
}: {
  /** Server Action ที่ bind receiptId ไว้แล้ว — คนละตัวระหว่างจอ POS กับหลังร้าน */
  action: () => Promise<{ ok: boolean; errorKey?: MessageKey; params?: MessageParams }>;
  className?: string;
}) {
  const { t } = useT();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <button
        type="button"
        disabled={pending}
        aria-busy={pending}
        className={`transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await action();

            if (!result.ok) {
              setError(t(result.errorKey ?? "error.print_record_failed", result.params));
              return;
            }

            /**
             * รอให้ DOM ได้ค่าใหม่จาก refresh ก่อนหนึ่งเฟรม ไม่งั้นกล่องพิมพ์
             * อาจเปิดทับ HTML เวอร์ชันก่อนหน้าที่ยังไม่มีป้าย "สำเนา"
             */
            requestAnimationFrame(() => window.print());
          });
        }}
      >
        {pending ? "กำลังบันทึก…" : "พิมพ์ใบเสร็จ"}
      </button>

      {error ? (
        <p role="alert" className="alert" data-print-hide>
          {error}
        </p>
      ) : null}
    </>
  );
}
