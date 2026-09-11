import type { Metadata, Viewport } from "next";
import { Archivo } from "next/font/google";

import "./globals.css";

import { I18nProvider } from "@/components/i18n-provider";
import { getLocale, getT } from "@/lib/server/locale";

/**
 * ฟอนต์ของ design system "Modernist" (บทที่ 9 — งานทา UI หน้าพนักงาน)
 *
 * ⚠ `subsets` ต้องมี "vietnamese" — สระและวรรณยุกต์เวียดนาม (ế ộ ữ ằ) อยู่ใน
 * subset นั้น **ไม่ได้อยู่ใน latin** ถ้าไม่ขอมา ตัวอักษรพวกนี้จะตกไปใช้ฟอนต์
 * ระบบกลางคำ แล้วคำเดียวกันจะมีสองฟอนต์ปนกันโดยที่ tsc/build ไม่ฟ้องอะไรเลย
 *
 * เดิมที่นี่มี Noto Sans Thai คู่กันเพื่อรองรับตัวไทย — ตัดออกแล้วเพราะ UI
 * เหลือสองภาษา (เวียดนาม/อังกฤษ) ซึ่ง Archivo ครอบได้เองทั้งหมด
 *
 * **กับดักที่ยังอยู่และห้ามลืม:** ปกติ Next แทรกฟอนต์ระบบที่ปรับ metric แล้ว
 * (`Archivo Fallback` = `local(Arial)`) ต่อท้ายให้เองเพื่อลด layout shift
 * ตัวนั้นกินกลีฟก่อนตัวถัดไปในสแตกเสมอ — `adjustFontFallback: false`
 * **ไม่ได้ผล** เพราะ Turbopack ไม่ทำตาม option นี้ (ยืนยันจาก @font-face จริง
 * ทั้ง dev และ build) ทางแก้จริงอยู่ที่ app/globals.css ซึ่งเขียน "Archivo"
 * ตรง ๆ แทน var(--font-archivo) คงบรรทัดนี้ไว้เพราะเป็นค่าที่ถูกตามเจตนา
 * เผื่อวันหนึ่ง Turbopack ทำตาม
 *
 * บทเรียนที่ใช้ได้กับทั้งสองย่อหน้าข้างบน: **ตรวจ @font-face ที่ emit ออกมาจริง
 * เสมอ ห้ามเชื่อ option**
 *
 * โหลดผ่าน next/font = self-host ไม่ยิงไปที่ fonts.googleapis.com ตอนรัน
 * (สำคัญกับเครื่อง POS ที่เน็ตร้านอาจไม่เสถียร)
 */
const archivo = Archivo({
  subsets: ["latin", "vietnamese"],
  variable: "--font-archivo",
  display: "swap",
  adjustFontFallback: false,
});

/** ชื่อบนแท็บเบราว์เซอร์ก็เป็น "กรอบ" ที่ต้องเปลี่ยนตามปุ่มภาษา ไม่ใช่ค่าคงที่ */
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();

  return { title: t("app.title"), description: t("app.description") };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // จอ POS และ KDS เป็นหน้าจอสัมผัสที่ไม่ควร zoom ตามนิ้วโดยไม่ตั้งใจ
  maximumScale: 1,
};

/**
 * เป็น async เพราะต้องอ่าน cookie ภาษา — `lang` ของ <html> ต้องตรงกับภาษาที่
 * แสดงจริง ไม่งั้น screen reader อ่านผิดภาษาและเบราว์เซอร์เสนอแปลหน้าผิด ๆ
 *
 * I18nProvider ครอบที่นี่ที่เดียว จึงครบทั้งสี่จอโดยไม่ต้องไปแปะทีละ route group
 */
export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();

  return (
    <html lang={locale} className={archivo.variable}>
      <body className="min-h-dvh bg-neutral-50 text-neutral-900 antialiased">
        <I18nProvider locale={locale}>{children}</I18nProvider>
      </body>
    </html>
  );
}
