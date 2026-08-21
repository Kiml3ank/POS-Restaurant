import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    /**
     * รูปเมนู (MenuItem.imageUrl) — ตอน dev ยังไม่มีที่เก็บรูปเป็นเรื่องเป็นราว
     * จึงเปิดกว้างไว้ให้ทดลองวาง URL รูปจากที่ไหนก็ได้ก่อน
     *
     * ก่อน deploy จริง (บทที่ 16) ต้องแคบ hostname ให้เหลือเฉพาะ bucket/CDN
     * ของร้านเท่านั้น ไม่งั้นเท่ากับเปิดให้คนอื่นใช้ image optimizer ของเราฟรี
     */
    remotePatterns: [{ protocol: "https", hostname: "**" }],
  },
};

export default nextConfig;
