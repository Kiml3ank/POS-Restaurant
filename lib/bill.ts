/**
 * คิดเงิน (บทที่ 10) — เซอร์วิสชาร์จ → VAT ด้วยจำนวนเต็มสตางค์ล้วน
 *
 * ไฟล์นี้เป็นฟังก์ชันบริสุทธิ์ล้วน ไม่แตะ Prisma / process.env / เวลา
 * และ **ไม่มี `import "server-only"`** เพราะทั้งหน้าจอ POS, ใบเสร็จในบทที่ 12
 * และสคริปต์ทดสอบต้องคิดด้วยสูตรชุดเดียวกันเป๊ะ ๆ
 * ถ้าวันหนึ่งมีคนเขียนสูตรคิดเงินที่สองขึ้นมาที่อื่น ถือว่าผิดทันที
 *
 * ── ⚠ ข้อความที่ต้องอ่านก่อนเอาไป deploy จริง ──────────────────────────
 * **นี่ไม่ใช่คำแนะนำทางภาษี** ลำดับการคิด อัตรา และวิธีปัดเศษที่เลือกไว้ที่นี่
 * เป็นแบบที่ร้านอาหารไทยใช้กันทั่วไป แต่ต้องให้ผู้สอบบัญชี/สรรพากรตรวจก่อนใช้จริง
 * โดยเฉพาะ "วิธีปัดเศษ" ที่กฎหมายไม่ได้บังคับตายตัว ร้านต่างเจ้าอาจปัดต่างกัน
 * (CLAUDE.md หัวข้อ 4 + บทที่ 12)
 *
 * ── ทำไมลำดับต้องเป็น เซอร์วิสชาร์จ → VAT ────────────────────────────────
 * เพราะเซอร์วิสชาร์จคือ "ค่าบริการ" ที่ร้านเรียกเก็บ = รายได้ของร้าน จึงเป็น
 * ฐานภาษีด้วย ไม่ใช่ค่าใช้จ่ายที่มาทีหลังภาษี ถ้าสลับลำดับเป็น VAT → เซอร์วิสชาร์จ
 * ยอดที่ได้จะน้อยกว่าความจริงเสมอ และร้านจะนำส่ง VAT ขาดทุกบิล
 *
 *   ตัวอย่าง: ค่าอาหาร 1,000 · เซอร์วิส 10% · VAT 7% (ราคายังไม่รวม VAT)
 *     ถูก:  1000 → +100 (เซอร์วิส) = 1100 → +77 (VAT ของ 1100) = 1177
 *     ผิด:  1000 → +70 (VAT) = 1070 → +107 (เซอร์วิส) = 1177  ← บังเอิญเท่ากัน
 *   เลขบังเอิญเท่ากันในตัวอย่างนี้เพราะเป็นการคูณต่อกัน แต่จะต่างทันทีที่มี
 *   ส่วนลด/ปัดเศษเข้ามา และที่สำคัญกว่าคือ **ยอด VAT ที่ต้องนำส่งไม่เท่ากัน**
 *   (77 กับ 70) ซึ่งเป็นตัวเลขที่ต้องปรากฏบนใบกำกับภาษีในบทที่ 12
 */

/** อัตราที่ใช้คิดบิลหนึ่งใบ — หน่วยเป็น basis point (1000 = 10.00%) */
export type BillRates = {
  /** เซอร์วิสชาร์จ เช่น 1000 = 10% · 0 = ร้านไม่เก็บ */
  serviceChargeBp: number;
  /** อัตรา VAT เช่น 700 = 7% */
  vatRateBp: number;
  /**
   * true  = ราคาบนเมนู "รวม VAT แล้ว" → ต้องถอด VAT ออกมาแสดงบนใบกำกับภาษี
   * false = ราคาบนเมนู "ยังไม่รวม VAT" → ต้องบวก VAT เพิ่มตอนคิดเงิน
   *
   * ค่านี้เปลี่ยนทั้งวิธีคิดและตัวเลขสุดท้าย ไม่ใช่แค่ข้อความบนใบเสร็จ
   */
  pricesIncludeVat: boolean;
};

export type BillInput = {
  /** ผลรวม lineTotal ของทุกบรรทัดที่ยังไม่ถูกยกเลิก หน่วยสตางค์ */
  subtotal: number;
  /** ส่วนลดระดับบิล หน่วยสตางค์ (ยังไม่มี UI ให้กด — ดูหมายเหตุท้ายไฟล์) */
  discountAmount?: number;
  rates: BillRates;
};

export type Bill = {
  subtotal: number;
  discountAmount: number;
  /** subtotal − discount = ฐานที่ใช้คิดเซอร์วิสชาร์จ */
  discountedSubtotal: number;
  serviceChargeAmount: number;
  /** ยอดก่อน VAT (ตัวเลขที่ต้องขึ้นใบกำกับภาษีว่า "มูลค่าสินค้า") */
  netAmount: number;
  vatAmount: number;
  /** ยอดที่ลูกค้าต้องจ่ายจริง */
  grandTotal: number;

  // snapshot ของอัตราที่ใช้คิดครั้งนี้ — ติดไปกับผลลัพธ์เสมอเพื่อให้ผู้เรียก
  // เอาไปเก็บลง Order ตอนปิดบิลได้โดยไม่ต้องไปอ่าน Branch ซ้ำ (แล้วอาจได้คนละค่า)
  serviceChargeBp: number;
  vatRateBp: number;
  pricesIncludeVat: boolean;
};

/** ตัวหารของ basis point — 10000 bp = 100% */
const BP_DENOMINATOR = 10_000;

/**
 * คูณอัตราแล้วปัดเศษครึ่งขึ้น **ด้วยเลขจำนวนเต็มล้วน**
 *
 * ตั้งใจไม่ใช้ `Math.round(amount * bp / 10000)` เพราะนั่นคือการหารแบบ float
 * แล้วปัด ซึ่งเป็นจุดที่เงินเพี้ยนทีละสตางค์แบบหาสาเหตุไม่เจอ
 * ที่นี่ใช้ `%` หาเศษก่อน แล้วหารส่วนที่ลงตัวเป๊ะ ๆ — ไม่มีขั้นตอนไหนเป็น float เลย
 *
 * ปัด "ครึ่งขึ้น" (0.5 สตางค์ → 1 สตางค์) ตามที่ร้านอาหารไทยใช้กันทั่วไป
 * **แต่กฎหมายไม่ได้บังคับ** ถ้าผู้สอบบัญชีของร้านให้ปัดลงหรือปัดแบบธนาคาร
 * ต้องมาแก้ที่ฟังก์ชันนี้ที่เดียว แล้วทั้งระบบเปลี่ยนตาม
 */
function applyRate(amount: number, bp: number): number {
  const product = amount * bp;
  const remainder = product % BP_DENOMINATOR;
  // product − remainder หารด้วย 10000 ลงตัวเสมอ การหารตรงนี้จึงแม่นยำเป๊ะ
  const quotient = (product - remainder) / BP_DENOMINATOR;

  return remainder * 2 >= BP_DENOMINATOR ? quotient + 1 : quotient;
}

/**
 * ถอด VAT ออกจากยอดที่ "รวม VAT แล้ว"
 *
 * สูตร: vat = ยอดรวม × อัตรา ÷ (100% + อัตรา)
 * เช่น ยอดรวม 107 บาท VAT 7% → 107 × 700 ÷ 10700 = 7 บาท (เหลือมูลค่าสินค้า 100)
 *
 * ห้ามใช้ `ยอดรวม × 7%` ตรง ๆ เพราะนั่นคือการคิด VAT ของยอดที่มี VAT อยู่แล้ว
 * จะได้ 7.49 บาท ซึ่งเกินความจริงและทำให้ยอดนำส่งภาษีผิดทุกบิล
 */
function extractVat(grossAmount: number, vatRateBp: number): number {
  const denominator = BP_DENOMINATOR + vatRateBp;
  const product = grossAmount * vatRateBp;
  const remainder = product % denominator;
  const quotient = (product - remainder) / denominator;

  return remainder * 2 >= denominator ? quotient + 1 : quotient;
}

/**
 * คิดบิลหนึ่งใบ
 *
 * **ที่เดียวในระบบที่คิดยอดสุดท้าย** — หน้าจอ POS, ใบเสร็จ, รายงานปิดกะ
 * ต้องเรียกตัวนี้เท่านั้น ห้ามบวกเองที่หน้าจอแม้จะดูง่ายแค่ไหน
 *
 * รับประกันสองข้อเสมอไม่ว่าจะโหมดไหน:
 *   1. `netAmount + vatAmount === grandTotal` (ไม่มีสตางค์หายระหว่างทาง)
 *   2. ทุกค่าที่คืนออกไปเป็นจำนวนเต็มสตางค์
 */
export function calculateBill(input: BillInput): Bill {
  const { serviceChargeBp, vatRateBp, pricesIncludeVat } = input.rates;

  const subtotal = Math.max(0, Math.trunc(input.subtotal));
  // ส่วนลดเกินค่าอาหารไม่ได้ — บิลติดลบแปลว่าร้านจ่ายเงินให้ลูกค้า
  // ซึ่งไม่ใช่ "ส่วนลด" แต่เป็นการคืนเงิน คนละเรื่องและคนละเอกสารทางภาษี
  const discountAmount = Math.min(subtotal, Math.max(0, Math.trunc(input.discountAmount ?? 0)));
  const discountedSubtotal = subtotal - discountAmount;

  /**
   * เซอร์วิสชาร์จคิดจากยอด "หลังหักส่วนลด" เสมอ
   * ถ้าคิดจากยอดก่อนหักส่วนลด ลูกค้าจะจ่ายค่าบริการของอาหารที่ตัวเองไม่ได้จ่ายค่ามัน
   */
  const serviceChargeAmount = applyRate(discountedSubtotal, serviceChargeBp);

  if (pricesIncludeVat) {
    /**
     * ราคาบนเมนูรวม VAT แล้ว → ยอดที่ลูกค้าจ่ายคือ (ค่าอาหาร + เซอร์วิสชาร์จ) ตรง ๆ
     * แล้ว "ถอด" VAT ออกมาเพื่อแสดงบนใบกำกับภาษีเท่านั้น ไม่ได้บวกเพิ่ม
     *
     * เซอร์วิสชาร์จที่คิดจากฐานที่รวม VAT อยู่แล้ว ก็เป็นยอดที่รวม VAT ด้วย
     * จึงถอด VAT จากยอดรวมทั้งก้อนทีเดียว ไม่ต้องแยกถอดทีละส่วน
     */
    const grandTotal = discountedSubtotal + serviceChargeAmount;
    const vatAmount = extractVat(grandTotal, vatRateBp);

    return {
      subtotal,
      discountAmount,
      discountedSubtotal,
      serviceChargeAmount,
      // ลบออกจากยอดรวม ไม่ใช่คิดใหม่ — เพื่อให้ net + vat = grand เป๊ะเสมอ
      netAmount: grandTotal - vatAmount,
      vatAmount,
      grandTotal,
      serviceChargeBp,
      vatRateBp,
      pricesIncludeVat,
    };
  }

  /**
   * ราคาบนเมนูยังไม่รวม VAT → บวก VAT เพิ่มท้ายสุด
   * ฐานของ VAT คือ ค่าอาหารหลังส่วนลด + เซอร์วิสชาร์จ (ดูเหตุผลหัวไฟล์)
   */
  const netAmount = discountedSubtotal + serviceChargeAmount;
  const vatAmount = applyRate(netAmount, vatRateBp);

  return {
    subtotal,
    discountAmount,
    discountedSubtotal,
    serviceChargeAmount,
    netAmount,
    vatAmount,
    grandTotal: netAmount + vatAmount,
    serviceChargeBp,
    vatRateBp,
    pricesIncludeVat,
  };
}

/**
 * แบ่งยอดก้อนเดียวออกเป็นหลายส่วนตามน้ำหนัก โดย **ผลรวมต้องเท่ากับยอดตั้งต้นเป๊ะ**
 *
 * ── ทำไมต้องมีฟังก์ชันนี้ (บทที่ 11) ────────────────────────────────────
 * บิลคิดที่ระดับ "รอบโต๊ะ" (รวม subtotal ทุกใบก่อนแล้วคิดครั้งเดียว) แต่คอลัมน์
 * ยอดเงินอยู่ที่ระดับ Order ซึ่งมีหลายใบต่อรอบ ตอนปิดบิลจึงต้องเอายอดที่คิดไว้
 * ก้อนเดียว **กระจาย** ลงแต่ละใบ — ไม่ใช่คิดเซอร์วิสชาร์จ/VAT ใหม่ทีละใบ
 * (คิดใหม่ทีละใบ = ปัดเศษหลายรอบ แล้วผลรวมไม่ตรงกับยอดที่ลูกค้าจ่ายจริง
 *  มีเคสพิสูจน์ไว้ใน smoke:bill แล้วว่าต่างกันจริง)
 *
 * ── วิธี: largest remainder ─────────────────────────────────────────────
 * หารตามสัดส่วนแล้วปัดลงก่อน (ผลรวมจึงขาดไปไม่เกินจำนวนช่อง) แล้วแจกเศษที่เหลือ
 * ทีละ 1 ให้ช่องที่มี "เศษ" มากที่สุดเรียงลงมา — วิธีเดียวกับที่ใช้แบ่งที่นั่ง ส.ส.
 * ตามสัดส่วนคะแนน เพราะเป็นวิธีที่ผลรวมเท่าเดิมเสมอและอคติน้อยที่สุด
 *
 * ทุกขั้นตอนเป็นจำนวนเต็มล้วน (คูณก่อนหารเสมอ ไม่มีการหารทศนิยมกลางทาง)
 *
 * รับประกัน: `sum(ผลลัพธ์) === total` ทุกกรณี — รวมถึงกรณีน้ำหนักเป็น 0 หมด
 * (แจกเท่า ๆ กันจากซ้ายไปขวา) และกรณี total = 0
 */
export function distributeByWeight(total: number, weights: number[]): number[] {
  if (weights.length === 0) {
    return [];
  }

  const amount = Math.trunc(total);
  // น้ำหนักติดลบไม่มีความหมายในบริบทนี้ (subtotal ของบิลติดลบไม่ได้) กันไว้ที่นี่
  // ดีกว่าปล่อยให้ไปโผล่เป็นยอดเงินติดลบในบางใบโดยที่ผลรวมยังดูถูกอยู่
  const safeWeights = weights.map((weight) => Math.max(0, Math.trunc(weight)));
  const totalWeight = safeWeights.reduce((sum, weight) => sum + weight, 0);

  /**
   * ไม่มีน้ำหนักเลย (ทุกใบยอด 0 เช่นของแถมทั้งรอบ) แต่ยังมียอดต้องแบ่ง
   * เช่นค่าบริการขั้นต่ำ — แบ่งเท่า ๆ กันแล้วเศษให้ใบแรก ๆ
   */
  if (totalWeight === 0) {
    const base = Math.trunc(amount / weights.length);
    const remainder = amount - base * weights.length;

    return weights.map((_, index) => base + (index < remainder ? 1 : 0));
  }

  const shares = safeWeights.map((weight) => {
    const product = amount * weight;
    const remainder = product % totalWeight;

    return {
      // ปัดลงก่อนเสมอ แล้วค่อยแจกเศษคืนทีหลัง
      base: (product - remainder) / totalWeight,
      remainder,
    };
  });

  const distributed = shares.reduce((sum, share) => sum + share.base, 0);
  let leftover = amount - distributed;

  // เรียงตามเศษมากไปน้อย · เศษเท่ากันให้ใบที่มาก่อนได้ไปก่อน (ผลลัพธ์คงที่ ทดสอบซ้ำได้)
  const order = shares
    .map((share, index) => ({ index, remainder: share.remainder }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);

  const result = shares.map((share) => share.base);

  for (const entry of order) {
    if (leftover <= 0) {
      break;
    }

    result[entry.index] += 1;
    leftover -= 1;
  }

  return result;
}

/** แปลง basis point เป็นข้อความเปอร์เซ็นต์ เช่น 1000 → "10%" · 725 → "7.25%" */
export function formatBp(bp: number): string {
  const whole = Math.trunc(bp / 100);
  const fraction = Math.abs(bp % 100);

  if (fraction === 0) {
    return `${whole}%`;
  }

  return `${whole}.${String(fraction).padStart(2, "0").replace(/0$/, "")}%`;
}

/**
 * ── หมายเหตุงานที่ยังไม่ได้ทำในบทที่ 10 ────────────────────────────────
 *
 * `discountAmount` รองรับในสูตรแล้วแต่ **ยังไม่มีปุ่มให้กดบนหน้าจอ** โดยตั้งใจ
 * เพราะส่วนลดคือช่องโกงอันดับต้น ๆ ของหน้าร้าน (เล่มยกไว้ในบทที่ 13) การเปิดปุ่ม
 * ต้องมาพร้อมสามอย่างเสมอ: จำกัดตามตำแหน่ง, บังคับกรอกเหตุผล, เขียน AuditLog
 * — ชุดเดียวกับที่ `cancelOrderItemByStaff()` ทำอยู่แล้ว
 *
 * ตัวเลือกส่วนลดแบบเปอร์เซ็นต์ก็ควรแปลงเป็นสตางค์ที่ชั้นบนก่อนส่งเข้ามาที่นี่
 * ฟังก์ชันนี้จะได้ไม่ต้องรู้จักคำว่า "โปรโมชัน" เลย
 */
