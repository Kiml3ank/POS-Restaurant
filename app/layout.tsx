import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "POS ร้านอาหาร",
  description: "ระบบ POS ร้านอาหาร — ลูกค้า / พนักงาน / ครัว / หลังร้าน",
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
    <html lang="th">
      <body className="min-h-dvh bg-neutral-50 text-neutral-900 antialiased">
        {children}
      </body>
    </html>
  );
}
