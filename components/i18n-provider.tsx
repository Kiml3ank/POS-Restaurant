"use client";

import { createContext, useContext, useMemo } from "react";

import { DICTIONARIES } from "@/lib/i18n/dictionaries";
import type { Locale } from "@/lib/i18n/locales";
import {
  tCount,
  translate,
  type CountKey,
  type MessageParams,
} from "@/lib/i18n/translate";
import type { MessageKey } from "@/lib/i18n/vi";

type Translator = {
  locale: Locale;
  t: (key: MessageKey, params?: MessageParams) => string;
  tc: (base: CountKey, n: number, params?: MessageParams) => string;
};

const I18nContext = createContext<Translator | null>(null);

/**
 * ส่งมาแค่ "ภาษา" ไม่ใช่ทั้งพจนานุกรม
 *
 * ถ้ารับพจนานุกรมเป็น prop มันจะถูก serialize ลง RSC payload ใหม่ทุกครั้งที่
 * เปลี่ยนหน้า ซึ่งจอ POS ทำทั้งวัน — วิธีนี้ทั้งสองภาษาอยู่ใน chunk เดียวที่
 * เบราว์เซอร์แคชครั้งเดียวจบ แลกกับการส่งข้อความสองภาษาไปครั้งแรกครั้งเดียว
 *
 * แปะไว้ที่ layout ราก ที่เดียว จึงครอบทั้งสี่จอ (ลูกค้า/POS/ครัว/หลังร้าน)
 */
export function I18nProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: React.ReactNode;
}) {
  const value = useMemo<Translator>(() => {
    const dict = DICTIONARIES[locale];

    return {
      locale,
      t: (key, params) => translate(dict, key, params),
      tc: (base, n, params) => tCount(dict, base, n, params),
    };
  }, [locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/**
 * ตัวแปลสำหรับ client component
 *
 * throw เมื่อไม่มี provider โดยตั้งใจ — เป็นความผิดพลาดตอนประกอบหน้าจอที่ต้อง
 * เจอทันทีตอน dev ไม่ใช่ปล่อยให้ตกไปเป็นคีย์ดิบบนจอลูกค้า (ต่างจากกรณี
 * cookie ภาษาเพี้ยน ซึ่งเป็นข้อมูลจากผู้ใช้และต้องตกกลับเป็นค่าตั้งต้นเงียบ ๆ)
 */
export function useT(): Translator {
  const ctx = useContext(I18nContext);

  if (ctx === null) {
    throw new Error("useT() ถูกเรียกนอก <I18nProvider>");
  }

  return ctx;
}
