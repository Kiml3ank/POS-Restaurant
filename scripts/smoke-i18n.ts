/**
 * Smoke test ของชั้นภาษา (i18n)
 *
 * **ไม่แตะ DB เลย** — ทุกอย่างในชั้นนี้เป็นฟังก์ชันบริสุทธิ์โดยตั้งใจ จึงทดสอบได้
 * โดยไม่ต้องมี request context (สคริปต์ smoke ไม่มี `cookies()` ให้เรียก)
 * นี่คือเหตุผลเดียวกับที่ `lib/server/*` ต้องคืน "คีย์" ไม่ใช่ "ประโยค":
 * ถ้าชั้นธุรกิจแปลเอง มันจะต้องอ่าน cookie แล้วเทสต์ชุดนี้ก็เขียนไม่ได้
 */
import { DICTIONARIES } from "@/lib/i18n/dictionaries";
import { en } from "@/lib/i18n/en";
import { DEFAULT_LOCALE, isLocale, LOCALES } from "@/lib/i18n/locales";
import { tCount, translate } from "@/lib/i18n/translate";
import { vi } from "@/lib/i18n/vi";
import { formatMoney } from "@/lib/money";

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (ok) {
    passed += 1;
  } else {
    failed += 1;
    process.exitCode = 1;
  }
}

async function main() {
  console.log("\n── 1. พจนานุกรมครบคู่ ────────────────────────────────────────\n");

  const viKeys = Object.keys(vi).sort();
  const enKeys = Object.keys(en).sort();

  check(
    "จำนวนคีย์เท่ากันทั้งสองภาษา",
    viKeys.length === enKeys.length,
    `vi ${viKeys.length} · en ${enKeys.length}`,
  );
  check("รายชื่อคีย์ตรงกันเป๊ะ", viKeys.join("|") === enKeys.join("|"));

  const viRecord = vi as Record<string, string>;
  const enRecord = en as Record<string, string>;

  check(
    "ไม่มีข้อความว่างหรือมีแต่ช่องว่าง",
    viKeys.every((key) => viRecord[key]?.trim() !== "") &&
      enKeys.every((key) => enRecord[key]?.trim() !== ""),
  );

  /**
   * คู่ .one/.other ต้องมาเป็นคู่เสมอ — ถ้ามีแค่ข้างเดียว tCount() จะไปหยิบคีย์
   * ที่ไม่มีอยู่จริงแล้วได้ undefined ซึ่ง tsc จับไม่ได้เพราะมันถูก cast
   */
  const lonelyPlurals = viKeys.filter((key) => {
    if (key.endsWith(".one")) return !viKeys.includes(`${key.slice(0, -4)}.other`);
    if (key.endsWith(".other")) return !viKeys.includes(`${key.slice(0, -6)}.one`);
    return false;
  });

  check("ทุกคีย์ .one มี .other คู่กันเสมอ", lonelyPlurals.length === 0, lonelyPlurals.join(", "));

  console.log("\n── 2. isLocale / ค่าตั้งต้น ──────────────────────────────────\n");

  check("ค่าตั้งต้นคือเวียดนาม", DEFAULT_LOCALE === "vi", DEFAULT_LOCALE);
  check("รู้จักสองภาษา", LOCALES.length === 2, LOCALES.join(","));
  check("isLocale ผ่านเฉพาะค่าที่รู้จัก", isLocale("vi") && isLocale("en"));
  check(
    "cookie ที่ผู้ใช้แก้มั่ว ๆ ไม่ผ่าน (ต้องตกกลับเป็นค่าตั้งต้น ไม่ใช่ 500)",
    !isLocale("th") && !isLocale("") && !isLocale(undefined) && !isLocale("VI") && !isLocale(1),
  );

  console.log("\n── 3. การแทนค่า {token} ──────────────────────────────────────\n");

  check(
    "แทนค่า token ได้",
    translate(vi, "salePoint.tableNamed", { name: "A1" }) === "Bàn A1",
    translate(vi, "salePoint.tableNamed", { name: "A1" }),
  );
  check(
    "อังกฤษได้คำของตัวเอง",
    translate(en, "salePoint.tableNamed", { name: "A1" }) === "Table A1",
    translate(en, "salePoint.tableNamed", { name: "A1" }),
  );
  check(
    "token ที่ไม่มีใน params ถูกปล่อยไว้ ไม่ throw",
    translate(vi, "salePoint.tableNamed", {}) === "Bàn {name}",
  );
  check("ไม่ส่ง params เลยก็ไม่พัง", translate(vi, "orderStatus.PAID") === "Đã thanh toán");
  check(
    "แทนได้หลาย token ในสตริงเดียว",
    translate(en, "salePoint.queued", { channel: "Takeaway", queue: 12 }) === "Takeaway #12",
    translate(en, "salePoint.queued", { channel: "Takeaway", queue: 12 }),
  );
  check(
    "ค่าที่เป็นตัวเลขถูกแปลงเป็นสตริงให้เอง",
    translate(vi, "salePoint.queued", { channel: "Mang đi", queue: 7 }) === "Mang đi #7",
  );

  console.log("\n── 4. เอกพจน์/พหูพจน์ ────────────────────────────────────────\n");

  check(
    "อังกฤษ 1 = เอกพจน์",
    tCount(en, "error.locked_out", 1) === "Too many failed attempts — try again in 1 minute",
    tCount(en, "error.locked_out", 1),
  );
  check(
    "อังกฤษ 5 = พหูพจน์",
    tCount(en, "error.locked_out", 5) === "Too many failed attempts — try again in 5 minutes",
    tCount(en, "error.locked_out", 5),
  );

  /**
   * เวียดนามไม่ผันรูปตามจำนวน — ประโยคต้องเหมือนกันทุกตัวอักษร "ยกเว้นตัวเลข"
   * เขียนแบบแทนตัวเลขด้วย N ก่อนเทียบ เพื่อไม่ให้เป็นการเทียบค่ากับตัวเอง
   */
  const vi1 = tCount(vi, "error.locked_out", 1);
  const vi5 = tCount(vi, "error.locked_out", 5);

  check(
    "เวียดนามใช้รูปเดียวกันทั้งสองจำนวน (ต่างกันแค่ตัวเลข)",
    vi1.replace("1", "N") === vi5.replace("5", "N"),
    `${vi1} / ${vi5}`,
  );
  check(
    "เวียดนามยังแทนจำนวนจริงลงไป ไม่ใช่ทิ้ง {count} ไว้",
    vi1.includes("1 phút") && vi5.includes("5 phút"),
    vi5,
  );
  check("0 ใช้รูปพหูพจน์ ไม่ใช่เอกพจน์", tCount(en, "error.locked_out", 0).endsWith("minutes"));

  console.log("\n── 5. ตารางภาษา + เงิน VND ───────────────────────────────────\n");

  check(
    "DICTIONARIES ครบทุกภาษาใน LOCALES",
    LOCALES.every((locale) => DICTIONARIES[locale] !== undefined),
  );
  check(
    "VND ไม่มีทศนิยม คั่นหลักพันด้วยจุด สัญลักษณ์อยู่ท้าย",
    formatMoney(45_000, "VND") === "45.000 ₫",
    formatMoney(45_000, "VND"),
  );
  check(
    "VND ต้องไม่ถูกฟอร์แมตแบบมีทศนิยม (45.000 ไม่ใช่ 45,000.00)",
    !formatMoney(45_000, "VND").includes(","),
    formatMoney(45_000, "VND"),
  );
  check(
    "เลขก้อนเดียวกันคนละสกุล = คนละมูลค่า (กันคนไปหาร 100 ที่อื่น)",
    formatMoney(45_000, "THB") === "฿450.00" && formatMoney(45_000, "VND") === "45.000 ₫",
    `${formatMoney(45_000, "THB")} vs ${formatMoney(45_000, "VND")}`,
  );

  console.log(`\nรวม ${passed + failed} เคส — PASS ${passed} · FAIL ${failed}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
