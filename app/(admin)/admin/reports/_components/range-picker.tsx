"use client";

import Link from "next/link";

import { useT } from "@/components/i18n-provider";
import { REPORT_PRESETS, type ReportRange } from "@/lib/report-range";

/**
 * ตัวเลือกช่วงเวลา — เขียนลง URL ไม่ใช่ state ในหน้า
 *
 * เพราะหน้านี้ต้องส่งลิงก์ให้กันได้ และ **ปุ่มส่งออก CSV ใช้พารามิเตอร์ชุดเดียวกัน**
 * ถ้าเก็บใน state ปุ่มส่งออกจะต้องรู้ state นั้นด้วย ซึ่งเป็นสองแหล่งความจริงทันที
 *
 * preset เป็น `<Link>` ธรรมดา ไม่ใช่ปุ่มที่ยิง action — การเปลี่ยนช่วงคือการเปิด
 * URL อื่น ไม่ใช่การกระทำที่เปลี่ยนข้อมูล
 */
export function RangePicker({ range, exportHref }: { range: ReportRange; exportHref: string }) {
  const { t } = useT();

  return (
    <div className="panel flex flex-col gap-4 p-4">
      <div className="flex flex-wrap gap-2">
        {REPORT_PRESETS.map((preset) => (
          <Link
            key={preset}
            href={`/admin/reports?preset=${preset}`}
            className="btn btn-secondary h-10 px-3 text-[14px]"
          >
            {t(`admin.reports.preset.${preset}`)}
          </Link>
        ))}
      </div>

      <form action="/admin/reports" className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="kicker">{t("admin.reports.from")}</span>
          <input type="date" name="from" defaultValue={range.fromDay} className="input h-11 px-2" />
        </label>

        <label className="flex flex-col gap-1">
          <span className="kicker">{t("admin.reports.to")}</span>
          <input type="date" name="to" defaultValue={range.toDay} className="input h-11 px-2" />
        </label>

        <button type="submit" className="btn btn-primary h-11 px-4 text-[14px]">
          {t("admin.reports.apply")}
        </button>

        {/*
          ดาวน์โหลดเป็น <a> ธรรมดาไปที่ Route Handler — Server Action คืนไฟล์ให้
          เบราว์เซอร์ดาวน์โหลดตรง ๆ ไม่ได้ (ดู spec §7)
        */}
        <a href={exportHref} className="btn btn-secondary h-11 px-4 text-[14px]">
          {t("admin.reports.export")}
        </a>
      </form>
    </div>
  );
}
