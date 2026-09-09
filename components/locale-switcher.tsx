"use client";

import { useTransition } from "react";

import { setLocale } from "@/app/locale-actions";
import { useT } from "@/components/i18n-provider";
import { LOCALES } from "@/lib/i18n/locales";

/**
 * ปุ่มสลับภาษา VI / EN
 *
 * ── ที่ที่ต้องมี ────────────────────────────────────────────────────────
 * ทุกเชลล์ **และหน้าล็อกอินของทุกจอ** — คนที่อ่านหน้าล็อกอินไม่ออกเข้าไปหา
 * ปุ่มที่อยู่หลังการล็อกอินไม่ได้
 *
 * ── กับดักสองข้อที่โปรเจกต์นี้เคยโดนมาแล้ว ──────────────────────────────
 * 1. ห้ามใช้ utility คลาสเดียว (เช่น `lg:hidden`) ซ่อนตัวเองในเชลล์ POS —
 *    คลาสของ design system เขียนเป็น `.pos-skin .xxx` (specificity 0-2-0)
 *    ซึ่งชนะ utility ของ Tailwind (0-1-0) ถ้าต้องซ่อนตามขนาดจอ ให้ครอบด้วย
 *    <div> เปล่าแล้วซ่อนตัวครอบแทน
 * 2. `data-print-hide` ต้องมี ไม่งั้นปุ่มนี้จะติดไปบนใบเสร็จที่พิมพ์ออกกระดาษ
 *    (บทที่ 12 เคยเจอมาแล้วกับแถบหัวจอกับแถบโมดูล)
 *
 * ชื่อภาษาบนปุ่มเขียนด้วยภาษานั้นเองเสมอ ("Tiếng Việt" ไม่ใช่ "Vietnamese")
 * — คนที่กำลังหาภาษาของตัวเองอ่านภาษาปัจจุบันไม่ออกอยู่แล้ว
 */
export function LocaleSwitcher({ className = "" }: { className?: string }) {
  const { locale, t } = useT();
  const [pending, startTransition] = useTransition();

  return (
    <div
      className={`flex items-center gap-1 ${className}`}
      data-print-hide
      role="group"
      aria-label={t("common.language")}
    >
      {LOCALES.map((value) => {
        const active = value === locale;

        return (
          <button
            key={value}
            type="button"
            lang={value}
            title={t(`locale.${value}`)}
            aria-pressed={active}
            disabled={pending || active}
            onClick={() => startTransition(() => setLocale(value))}
            className={
              active
                ? "px-2 py-1 text-xs font-bold uppercase tracking-wide bg-neutral-900 text-neutral-50"
                : "px-2 py-1 text-xs font-bold uppercase tracking-wide text-neutral-500 hover:text-neutral-900 disabled:opacity-50"
            }
          >
            {value}
          </button>
        );
      })}
    </div>
  );
}
