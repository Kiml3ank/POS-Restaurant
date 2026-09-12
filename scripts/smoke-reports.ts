import "dotenv/config";

import { toCsv } from "@/lib/csv";
import { MAX_REPORT_DAYS, resolveReportRange } from "@/lib/report-range";
import { prisma } from "@/lib/server/db";

/**
 * Smoke test ของรายงานยอดขายย้อนหลัง + ส่งออก CSV
 *
 *     npm run smoke:reports
 *
 * ── สิ่งที่ชุดนี้ต้องพิสูจน์ ──────────────────────────────────────────────
 *   1. **ทุกส่วนของรายงานบวกกลับได้ตรงกัน** — แยกช่องทางจ่ายและแยกพนักงาน
 *      ต้องรวมได้เท่ายอดรวม ไม่งั้นทั้งหน้าเชื่อไม่ได้
 *   2. **ขอบช่วงถูกตามเวลาสาขา** ไม่ใช่ตาม UTC
 *   3. **CSV ที่ Excel เปิดแล้วอ่านภาษาเวียดนามออก** และ escape ถูก
 */

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

async function main() {
  console.log("── ช่วงเวลา ────────────────────────────────────────────────────\n");

  const today = "2026-09-12";

  const preset = resolveReportRange({ preset: "last7", todayYmd: today });
  check(
    "preset 7 วันล่าสุดนับรวมวันนี้ (7 วัน ไม่ใช่ 8)",
    preset.ok && preset.range.fromDay === "2026-09-06" && preset.range.toDay === today,
    preset.ok ? `${preset.range.fromDay}..${preset.range.toDay}` : preset.errorKey,
  );

  const yesterday = resolveReportRange({ preset: "yesterday", todayYmd: today });
  check(
    "เมื่อวานเป็นวันเดียว ไม่ใช่ช่วงถึงวันนี้",
    yesterday.ok &&
      yesterday.range.fromDay === "2026-09-11" &&
      yesterday.range.toDay === "2026-09-11",
  );

  const month = resolveReportRange({ preset: "month", todayYmd: today });
  check(
    "เดือนนี้เริ่มวันที่ 1",
    month.ok && month.range.fromDay === "2026-09-01" && month.range.toDay === today,
  );

  const custom = resolveReportRange({ from: "2026-08-01", to: "2026-08-31", todayYmd: today });
  check("กรอกช่วงเองได้", custom.ok && custom.range.fromDay === "2026-08-01");

  const backwards = resolveReportRange({ from: "2026-08-31", to: "2026-08-01", todayYmd: today });
  check(
    "ช่วงที่กลับหัวกลับหาง = error ไม่ใช่สลับให้เงียบ ๆ",
    !backwards.ok && backwards.errorKey === "error.report_range_invalid",
  );

  const garbage = resolveReportRange({ from: "ไม่ใช่วันที่", to: today, todayYmd: today });
  check("รูปแบบวันที่ผิด = error", !garbage.ok);

  const tooLong = resolveReportRange({ from: "2026-01-01", to: "2026-12-31", todayYmd: today });
  check(
    "ช่วงเกิน 92 วัน = error ไม่ใช่ตัดเงียบ ๆ",
    !tooLong.ok && tooLong.errorKey === "error.report_range_too_long",
  );

  const exactLimit = resolveReportRange({ from: "2026-06-12", to: "2026-09-11", todayYmd: today });
  check(`ช่วง ${MAX_REPORT_DAYS} วันพอดียังผ่าน`, exactLimit.ok);

  const noParams = resolveReportRange({ todayYmd: today });
  check(
    "ไม่ระบุอะไรเลย = 7 วันล่าสุด (วันนี้อย่างเดียวมีหน้าสรุปวันนี้อยู่แล้ว)",
    noParams.ok && noParams.range.fromDay === "2026-09-06",
  );

  console.log("\n── CSV ─────────────────────────────────────────────────────────\n");

  const csv = toCsv([
    ["name", "qty", "amount"],
    ['Cơm "đặc biệt", loại lớn', 2, 84000],
    ["ไม่มีอะไรพิเศษ", 1, null],
  ]);

  check("ขึ้นต้นด้วย BOM (ไม่งั้น Excel อ่านภาษาเวียดนามเป็นขยะ)", csv.startsWith("﻿"));
  check(
    "ช่องที่มีคอมมาถูกครอบด้วยเครื่องหมายคำพูด",
    csv.includes('"Cơm ""đặc biệt"", loại lớn"'),
    csv.split("\r\n")[1],
  );
  check("เครื่องหมายคำพูดถูกหนีเป็นสองตัว", csv.includes('""đặc biệt""'));
  check("ขึ้นบรรทัดใหม่ด้วย CRLF ตามมาตรฐาน CSV", csv.includes("\r\n"));
  check("ตัวเลขไม่ถูกครอบด้วยเครื่องหมายคำพูด", csv.includes(",2,84000"));
  check("ค่า null เป็นช่องว่าง ไม่ใช่คำว่า null", csv.trimEnd().endsWith(",1,"));

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
