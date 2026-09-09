import type { Metadata, Viewport } from "next";
import { Archivo, Noto_Sans_Thai } from "next/font/google";

import "./globals.css";

/**
 * ฟอนต์ของ design system "Modernist" (บทที่ 9 — งานทา UI หน้าพนักงาน)
 *
 * Archivo ไม่มีกลีฟไทยเลย จึงต้องจับคู่กับฟอนต์ไทยเสมอ วิธีที่ใช้คือวาง
 * font stack เป็น `Archivo, Noto Sans Thai` แล้วปล่อยให้เบราว์เซอร์ไล่หา
 * ฟอนต์ทีละกลีฟ — ตัวเลขกับอังกฤษได้ Archivo ตัวไทยตกไป Noto อัตโนมัติ
 *
 * **กับดักที่เสียเวลาที่สุดของงานนี้:** ปกติ Next แทรกฟอนต์ระบบที่ปรับ metric
 * แล้ว (`Archivo Fallback` = `local(Arial)`) ต่อท้าย Archivo ให้เองเพื่อลด
 * layout shift — แต่ Arial **มีกลีฟไทย** ตัวไทยจึงไปหยุดที่ Arial ไม่มีวัน
 * ตกถึง Noto Sans Thai. `adjustFontFallback: false` ที่ตั้งไว้ข้างล่าง
 * **ไม่ได้ผล** เพราะ Turbopack ไม่ทำตาม option นี้ (ยืนยันจาก @font-face
 * ที่ออกมาจริงทั้ง dev และ build) — ทางแก้จริงอยู่ที่ app/globals.css
 * ซึ่งเขียน `"Archivo"` ตรง ๆ แทน `var(--font-archivo)` เพื่อข้ามตัว Fallback
 * คงบรรทัดนี้ไว้เพราะเป็นค่าที่ "ถูกต้องตามเจตนา" ถ้าวันหนึ่ง Turbopack ทำตาม
 *
 * โหลดผ่าน next/font = self-host ไม่ยิงไปที่ fonts.googleapis.com ตอนรัน
 * (สำคัญกับเครื่อง POS ที่เน็ตร้านอาจไม่เสถียร)
 */
const archivo = Archivo({
  subsets: ["latin"],
  variable: "--font-archivo",
  display: "swap",
  adjustFontFallback: false,
});

const notoSansThai = Noto_Sans_Thai({
  subsets: ["thai"],
  variable: "--font-noto-thai",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Restaurant POS",
  description: "Restaurant POS — customer / staff / kitchen / back office",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // จอ POS และ KDS เป็นหน้าจอสัมผัสที่ไม่ควร zoom ตามนิ้วโดยไม่ตั้งใจ
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="th" className={`${archivo.variable} ${notoSansThai.variable}`}>
      <body className="min-h-dvh bg-neutral-50 text-neutral-900 antialiased">{children}</body>
    </html>
  );
}
