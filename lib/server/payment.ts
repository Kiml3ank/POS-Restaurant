import "server-only";

import { calculateBill, distributeByWeight, type Bill } from "@/lib/bill";
import type { PaymentMethod } from "@/lib/generated/prisma/enums";
import { canTakePayment } from "@/lib/rbac";
import { billRatesForSalePoint } from "@/lib/sale-point";
import { REALTIME_EVENT_VERSION } from "@/lib/realtime-events";
import { BILLABLE_ORDER_STATUSES } from "@/lib/server/billing";
import { prisma } from "@/lib/server/db";
import { publishRealtimeEvent } from "@/lib/server/realtime";
import { issueReceipt } from "@/lib/server/receipt-issue";
import { staffMealDiscountAmount } from "@/lib/server/staff-meal";
import type { CurrentStaff } from "@/lib/server/staff-session";

/**
 * รับเงินและปิดบิล (บทที่ 11)
 *
 * ── ⚠ ก้อนนี้เป็น "โหมดสาธิต" ───────────────────────────────────────────
 * ไม่มีการต่อกับ payment gateway จริง ไม่มี webhook ยืนยันยอดจากธนาคาร
 * แคชเชียร์เป็นคนกดยืนยันเองว่าได้รับเงินแล้ว — ซึ่ง **ตรงกับความจริงของเงินสด**
 * แต่ **ไม่ตรงสำหรับ QR** ที่ของจริงต้องรอ callback จากธนาคารก่อนจึงจะปิดบิลได้
 * วันที่ต่อของจริง จุดที่ต้องแก้คือฟังก์ชันนี้ (แยกเป็น "ตั้งรายการรอชำระ" →
 * "ยืนยันเมื่อธนาคารตอบกลับ") ไม่ใช่ไปแก้ที่หน้าจอ
 *
 * ── สิ่งที่ทำเต็มรูปแม้จะเป็น demo ────────────────────────────────────────
 * เพราะบทที่ 12 (ใบกำกับภาษี) 13 (audit) และ 15 (ปิดกะ/ปิดวัน) ต่อยอดจากตรงนี้:
 *   - ปิดบิลทั้งหมดใน `$transaction` เดียว (บิล + รอบโต๊ะ + โต๊ะ + audit)
 *   - snapshot อัตราและสกุลเงินลงทั้ง Payment และ Order ทุกใบ
 *   - จำนวนเต็มล้วนทุกขั้นตอน ไม่มี float
 *   - RBAC ตรวจฝั่ง server เป็นบรรทัดแรก
 *   - **คิดยอดใหม่ฝั่ง server เสมอ ห้ามเชื่อยอดที่ client ส่งมา**
 */

export type TakePaymentInput = {
  method: PaymentMethod;
  /** เงินสดที่รับมาจริง — ใช้เฉพาะ method = CASH */
  receivedAmount?: number | null;
  /**
   * ยอดที่แคชเชียร์เห็นบนจอตอนกดยืนยัน (optimistic concurrency)
   *
   * **ไม่ได้ใช้เป็นยอดที่บันทึก** — ยอดจริงคิดใหม่ฝั่ง server เสมอ — แต่ใช้ตรวจว่า
   * บิลเปลี่ยนไประหว่างที่แคชเชียร์กำลังอ่านยอดให้ลูกค้าฟังหรือเปล่า (ลูกค้าที่โต๊ะ
   * กดสั่งเพิ่มจากมือถือได้ตลอดเวลา — บทที่ 8 ทำให้จอ refresh เอง แต่ระหว่างที่
   * นิ้วกำลังกดปุ่มยืนยันอยู่ก็ยังชนกันได้) ปิดบิลด้วยยอดที่ลูกค้าไม่เคยเห็นคือ
   * สิ่งที่ห้ามเกิดที่สุดในหน้านี้ จึงเลือกให้ "ไม่ยอมปิด แล้วให้อ่านยอดใหม่" แทน
   */
  expectedTotal?: number | null;
  /**
   * รอบขายที่จะรับเงิน — จำเป็นเฉพาะจุดขายที่มีบิลเปิดพร้อมกันได้หลายใบ
   * (เคาน์เตอร์ซื้อกลับ) โต๊ะนั่งไม่ต้องส่ง เพราะมีรอบเปิดได้ทีละรอบอยู่แล้ว
   *
   * ไม่ใช่ค่าที่เชื่อได้ทันที — ตรวจว่าเป็นรอบที่เปิดอยู่ของโต๊ะนี้จริงก่อนใช้เสมอ
   */
  sessionId?: string | null;
};

export type TakePaymentResult =
  | { ok: true; paymentId: string; alreadyPaid: boolean }
  | { ok: false; error: string };

/** วิธีจ่ายที่เปิดใช้จริงในก้อนนี้ — CARD มีใน enum แต่ยังไม่มีเครื่อง EDC/gateway */
const ENABLED_METHODS: readonly PaymentMethod[] = ["CASH", "QR"];

/**
 * ช่วงเวลาที่ถือว่าการกดปุ่มยืนยันครั้งใหม่ "เป็นการกดซ้ำของครั้งเดิม"
 *
 * 60 วินาทีมาจากพฤติกรรมจริงที่กันอยู่: คนกดปุ่มค้าง/กดสองครั้ง หรือกด back
 * แล้วกดใหม่ ซึ่งเกิดภายในไม่กี่วินาที — ไม่ใช่การเปิดหน้าเก่าค้างไว้ครึ่งวัน
 */
const RECENT_PAYMENT_WINDOW_MS = 60_000;

export async function takePayment(
  staff: CurrentStaff,
  tableId: string,
  input: TakePaymentInput,
): Promise<TakePaymentResult> {
  // การซ่อนปุ่มบนหน้าจอไม่ใช่การกันสิทธิ์ — action ถูกยิงตรงด้วย POST ได้
  if (!canTakePayment(staff.role)) {
    return { ok: false, error: "Your role can't take payments — please call a cashier or manager" };
  }

  if (!ENABLED_METHODS.includes(input.method)) {
    return { ok: false, error: "This payment method isn't supported yet (card needs a real EDC terminal)" };
  }

  const table = await prisma.restaurantTable.findFirst({
    where: { id: tableId, branchId: staff.branchId, isActive: true },
    /**
     * ดึง tenant มาด้วยเพราะใบเสร็จ (บทที่ 12) ต้อง snapshot ชื่อร้านกับเลขประจำตัว
     * ผู้เสียภาษี **ณ วินาทีที่ออกใบ** ลงในแถวของตัวเอง — อ่านตรงนี้ครั้งเดียว
     * แล้วส่งต่อเข้า transaction ไม่ใช่ให้ issueReceipt() ไป join เอง
     */
    include: { branch: { include: { tenant: { select: { name: true, taxId: true } } } } },
  });

  if (!table) {
    return { ok: false, error: "Table not found in your branch" };
  }

  /**
   * รอบขายที่จะรับเงิน
   *
   * ── ทำไมต้องระบุ sessionId ได้ และทำไมบางกรณีต้องบังคับ ──────────────────
   * โต๊ะนั่งมีรอบเปิดได้ทีละรอบ "รับเงินของโต๊ะ A3" จึงไม่กำกวมและหน้าจอเดิม
   * (บทที่ 11) ส่งมาแค่ tableId ได้ตามเดิม
   *
   * แต่เคาน์เตอร์ซื้อกลับมีบิลเปิดพร้อมกันได้หลายใบ ถ้าปล่อยให้หยิบ "รอบล่าสุด"
   * มาปิด แคชเชียร์ที่กดรับเงินจากคิว 12 จะไปปิดบิลของคิว 14 แทน — **ลูกค้า
   * คนหนึ่งจ่ายเงินแล้วบิลของอีกคนถูกปิด** ซึ่งเป็นความเสียหายที่ย้อนคืนยากมาก
   * เพราะรอบที่ปิดไปแล้วออกใบเสร็จและเดินเลขเอกสารไปเรียบร้อย
   *
   * จึงเลือกให้ **ไม่เดา**: มีรอบเปิดมากกว่าหนึ่งแล้วไม่ระบุมา = ปฏิเสธ
   */
  const openSessions = await prisma.tableSession.findMany({
    where: { tableId: table.id, status: "OPEN" },
    orderBy: { openedAt: "desc" },
    // queueNumber ติดมาด้วยเพื่อเขียนลง AuditLog ให้อ่านออกโดยไม่ต้อง query ซ้ำ
    select: { id: true, queueNumber: true },
  });

  if (!input.sessionId && openSessions.length > 1) {
    return {
      ok: false,
      error: "This sale point has multiple open bills — please specify which one to pay",
    };
  }

  const session = input.sessionId
    ? (openSessions.find((candidate) => candidate.id === input.sessionId) ?? null)
    : (openSessions[0] ?? null);

  if (!session) {
    /**
     * ไม่มีรอบที่เปิดอยู่ = ปิดบิลไปแล้ว หรือโต๊ะนี้ไม่เคยถูกเปิด
     *
     * ถ้าเพิ่งมีการรับเงินของโต๊ะนี้ไปหมาด ๆ ให้ถือว่าเป็น "การกดซ้ำ" ของครั้งเดิม
     * แล้วพากลับไปที่ใบเดิม ไม่ใช่ขึ้น error — เหตุผลเดียวกับ placeOrder():
     * คนที่กดปุ่มแล้วเจอ error ทั้งที่รับเงินสำเร็จไปแล้ว จะกดใหม่หรือเก็บเงินซ้ำ
     *
     * จำกัดด้วยกรอบเวลาสั้น ๆ โดยตั้งใจ — ถ้าปล่อยให้ย้อนได้ไม่จำกัด แคชเชียร์ที่
     * เปิด URL เก่าค้างไว้ตอนบ่ายแล้วกดตอนเย็น จะได้ "สำเร็จ" ทั้งที่โต๊ะนั้น
     * ผ่านลูกค้าไปอีกสามรอบแล้ว
     */
    const recent = await prisma.payment.findFirst({
      where: {
        branchId: staff.branchId,
        tableSession: { tableId: table.id },
        paidAt: { gt: new Date(Date.now() - RECENT_PAYMENT_WINDOW_MS) },
      },
      orderBy: { paidAt: "desc" },
      select: { id: true },
    });

    if (recent) {
      return { ok: true, paymentId: recent.id, alreadyPaid: true };
    }

    return { ok: false, error: "This table has no open session — it may already be paid" };
  }

  const branch = table.branch;
  /**
   * อัตราของบิลใบนี้ตามช่องทางที่ขาย — **ต้องเป็นฟังก์ชันเดียวกับที่ getTableBill()
   * เรียก** ไม่ใช่หยิบ `branch.serviceChargeBp` มาเองซ้ำ
   *
   * ยอดที่ snapshot ลง `Payment.serviceChargeBp` / `Order.serviceChargeBp` มาจาก
   * `bill` ที่คิดด้วยอัตราชุดนี้ ใบเสร็จซื้อกลับจึงพิมพ์ค่าบริการเป็น 0 ตลอดไป
   * แม้ร้านจะขึ้นเซอร์วิสชาร์จของสาขาทีหลัง (บทที่ 11-12)
   */
  const rates = billRatesForSalePoint(table.kind, {
    serviceChargeBp: branch.serviceChargeBp,
    vatRateBp: branch.vatRateBp,
    pricesIncludeVat: branch.pricesIncludeVat,
  });

  const sessionQueueNumber = session.queueNumber;

  const paidAt = new Date();

  const outcome = await prisma.$transaction(async (tx) => {
    /**
     * ชั้นกันจ่ายซ้ำที่เชื่อถือได้จริง: ปิดรอบโต๊ะแบบมีเงื่อนไข
     *
     * หนึ่งรอบโต๊ะ = หนึ่งบิล การปิดรอบจึงเป็น "ตั๋วใบเดียว" ของการรับเงินครั้งนี้
     * สองเครื่องที่กดยืนยันพร้อมกัน เครื่องที่สองจะรอ row lock แล้วอ่านเงื่อนไขใหม่
     * (Postgres READ COMMITTED ประเมิน WHERE ซ้ำหลังปลดล็อก) ได้ count = 0
     * → คืน "สำเร็จ" พร้อม Payment ใบเดิม ไม่ใช่ error และไม่ใช่ Payment ใบที่สอง
     *
     * ท่าเดียวกับ conditional update ใน placeOrder() — ต้องเป็นคำสั่งเดียวที่
     * ทั้งตรวจและเขียน ไม่ใช่ "อ่านก่อนแล้วค่อยเขียน" ซึ่งมีช่องว่างระหว่างสองคำสั่ง
     */
    /**
     * อ่านธง "พนักงานกิน" **ใน transaction** ก่อนปิดรอบโต๊ะ (บทที่ 13)
     *
     * เหตุผลเดียวกับที่คิดยอดใหม่ทุกครั้งแทนที่จะเชื่อยอดจากหน้าจอ: ธงถูกติด/ปลด
     * จากอีกเครื่องได้ตลอดเวลาจนถึงวินาทีสุดท้าย ถ้าอ่านไว้ก่อนเข้า transaction
     * จะมีช่องที่ปิดบิลด้วยส่วนลดที่เพิ่งถูกปลดไป (หรือไม่ลดทั้งที่เพิ่งติด)
     */
    const flagged = await tx.tableSession.findUnique({
      where: { id: session.id },
      select: { staffCustomerId: true },
    });

    const claimed = await tx.tableSession.updateMany({
      where: { id: session.id, status: "OPEN" },
      data: { status: "CLOSED", closedAt: paidAt },
    });

    if (claimed.count === 0) {
      const existing = await tx.payment.findFirst({
        where: { tableSessionId: session.id },
        orderBy: { paidAt: "desc" },
        select: { id: true },
      });

      return existing
        ? ({ kind: "already" as const, paymentId: existing.id })
        : ({ kind: "error" as const, error: "This table session was closed without a payment" });
    }

    const orders = await tx.order.findMany({
      where: { tableSessionId: session.id, status: { in: [...BILLABLE_ORDER_STATUSES] } },
      orderBy: { placedAt: "asc" },
      select: {
        id: true,
        items: {
          where: { status: { not: "CANCELLED" } },
          select: { lineTotal: true },
        },
      },
    });

    /**
     * ตะกร้าที่ยังไม่ได้ส่งเข้าครัว (DRAFT) — ไม่ได้อยู่ในยอดบิล จึงห้ามปิดทับ
     *
     * เคสจริง: พนักงานกดเลือกเมนูให้ลูกค้าไว้แล้วลืมกด "ส่งเข้าครัว" แล้วเดินมา
     * คิดเงิน ถ้าปล่อยให้ปิดบิลได้ ของในตะกร้าจะหายไปพร้อมรอบโต๊ะโดยไม่มีใครรู้ว่า
     * ลูกค้าสั่งไว้ — ต่างจาก "ของที่ยังไม่ได้เสิร์ฟ" ซึ่งครัวเห็นแล้วและอยู่ในบิลแล้ว
     * (อันนั้นแค่เตือน ไม่ห้าม เพราะลูกค้าขอจ่ายก่อนรับของได้)
     */
    const draft = await tx.order.findMany({
      where: { tableSessionId: session.id, status: "DRAFT" },
      select: { id: true, _count: { select: { items: true } } },
    });

    if (draft.some((order) => order._count.items > 0)) {
      throw new PaymentAbort("This table still has items in the cart that haven't been sent to the kitchen — send or remove them before taking payment");
    }

    if (orders.length === 0) {
      throw new PaymentAbort("This bill has no items to charge");
    }

    // ── คิดยอดใหม่จากของจริงใน DB ตรงนี้ ห้ามใช้ยอดที่อ่านไว้ก่อนเข้า transaction ──
    const orderSubtotals = orders.map((order) =>
      order.items.reduce((sum, item) => sum + item.lineTotal, 0),
    );
    const subtotal = orderSubtotals.reduce((sum, amount) => sum + amount, 0);

    if (subtotal === 0 && orders.every((order) => order.items.length === 0)) {
      throw new PaymentAbort("This bill has no items to charge (everything was cancelled)");
    }

    /**
     * ส่วนลดพนักงาน — อัตรามาจาก Branch (ค่าปัจจุบัน) แล้วถูก snapshot ลง Payment
     * ด้านล่างพร้อมจำนวนเงิน · ที่นี่คิดใหม่จาก subtotal จริงใน DB เสมอ
     */
    const discountBp = flagged?.staffCustomerId ? branch.staffMealDiscountBp : 0;
    const bill = calculateBill({
      subtotal,
      discountAmount: staffMealDiscountAmount(subtotal, discountBp),
      rates,
    });

    if (
      typeof input.expectedTotal === "number" &&
      Number.isFinite(input.expectedTotal) &&
      input.expectedTotal !== bill.grandTotal
    ) {
      throw new PaymentAbort(
        "The bill total just changed (an item was added or cancelled) — please re-read the total to the customer before confirming",
      );
    }

    const isCash = input.method === "CASH";
    const received = isCash ? Math.trunc(input.receivedAmount ?? 0) : null;

    if (isCash && received !== null && received < bill.grandTotal) {
      throw new PaymentAbort("Amount received is less than the total due");
    }

    // เงินทอนเป็นการลบจำนวนเต็มล้วน ไม่มีการหาร/ปัดเศษที่ไหนเลย
    const change = received === null ? null : received - bill.grandTotal;

    const payment = await tx.payment.create({
      data: {
        branchId: staff.branchId,
        tableSessionId: session.id,
        method: input.method,
        currency: branch.currency,
        subtotal: bill.subtotal,
        discountAmount: bill.discountAmount,
        serviceChargeAmount: bill.serviceChargeAmount,
        vatAmount: bill.vatAmount,
        netAmount: bill.netAmount,
        grandTotal: bill.grandTotal,
        receivedAmount: received,
        changeAmount: change,
        serviceChargeBp: bill.serviceChargeBp,
        vatRateBp: bill.vatRateBp,
        pricesIncludeVat: bill.pricesIncludeVat,
        // snapshot ส่วนลดพนักงาน: ต้องเก็บ **ทั้งอัตราและคนกิน** ไม่ใช่แค่จำนวนเงิน
        // — อัตราไว้พิมพ์ "10%" บนใบเสร็จย้อนหลัง · คนกินไว้ทำรายงานบทที่ 15
        //   และเป็นหลักฐานถาวรหลังรอบโต๊ะถูกปิดไปแล้ว
        discountBp,
        staffCustomerId: flagged?.staffCustomerId ?? null,
        paidByStaffId: staff.id,
        paidAt,
      },
      select: { id: true },
    });

    /**
     * ออกเอกสารให้ลูกค้าใน transaction เดียวกับการรับเงิน (บทที่ 12)
     *
     * อยู่ตรงนี้ ไม่ใช่ตอนกดปุ่มพิมพ์ เพราะสองเหตุผล:
     *   1. ถ้า "กดพิมพ์ = ออกเลข" แคชเชียร์เลี่ยงการออกใบได้ และเลขที่จะขาดเป็นรู
     *      ซึ่งเป็นสิ่งเดียวที่ตรวจสอบย้อนหลังไม่ผ่านแน่ ๆ
     *   2. อยู่ใน transaction เดียวกันแปลว่า ไม่มีทางเกิดบิลที่จ่ายเงินแล้วแต่ไม่มีเอกสาร
     *      และการรับเงินที่ถูก rollback จะคืนเลขที่กลับไปด้วย
     */
    await issueReceipt(tx, {
      branchId: staff.branchId,
      paymentId: payment.id,
      currency: branch.currency,
      seller: {
        branchCode: branch.code,
        branchName: branch.name,
        tenantName: branch.tenant.name,
        taxId: branch.tenant.taxId,
        addressLine: branch.addressLine,
        phone: branch.phone,
        receiptFooter: branch.receiptFooter,
      },
      issuedAt: paidAt,
    });

    const shares = splitBillAcrossOrders(bill, orderSubtotals);

    for (const [index, order] of orders.entries()) {
      const share = shares[index];

      await tx.order.update({
        where: { id: order.id },
        data: {
          status: "PAID",
          paidAt,
          paymentId: payment.id,
          subtotal: orderSubtotals[index],
          discountAmount: share.discountAmount,
          serviceChargeAmount: share.serviceChargeAmount,
          vatAmount: share.vatAmount,
          grandTotal: share.grandTotal,
          // snapshot อัตราลงทุกใบ — ใบเสร็จย้อนหลังในบทที่ 12 อ่านจากตรงนี้เท่านั้น
          serviceChargeBp: bill.serviceChargeBp,
          vatRateBp: bill.vatRateBp,
          pricesIncludeVat: bill.pricesIncludeVat,
        },
      });
    }

    // ตะกร้าเปล่าที่ค้างอยู่ลบทิ้งได้ ไม่มีของจริงผูกอยู่ (ที่มีของถูกกันไปแล้วด้านบน)
    await tx.order.deleteMany({ where: { tableSessionId: session.id, status: "DRAFT" } });

    await tx.restaurantTable.update({
      where: { id: table.id },
      data: { status: "AVAILABLE" },
    });

    /**
     * AuditLog อยู่ใน transaction เดียวกับการรับเงิน — รับเงินสำเร็จแต่ log หายไม่ได้
     * เคสที่เล่มยกไว้ในบทที่ 13 คือ "บิลถูกยกเลิกหลังจ่ายเงินไม่กี่นาที"
     * ซึ่งตอบได้ก็ต่อเมื่อมีแถวนี้เป็นจุดตั้งต้นของเส้นเวลา
     */
    await tx.auditLog.create({
      data: {
        branchId: staff.branchId,
        staffId: staff.id,
        action: "payment.take",
        entityType: "payment",
        entityId: payment.id,
        metadata: {
          method: input.method,
          currency: branch.currency,
          subtotal: bill.subtotal,
          serviceChargeAmount: bill.serviceChargeAmount,
          vatAmount: bill.vatAmount,
          grandTotal: bill.grandTotal,
          discountAmount: bill.discountAmount,
          discountBp,
          staffCustomerId: flagged?.staffCustomerId ?? null,
          receivedAmount: received,
          changeAmount: change,
          orderCount: orders.length,
          tableId: table.id,
          tableSessionId: session.id,
          /**
           * ชื่อจุดขาย ณ เวลาที่รับเงิน — เก็บคู่กับ id เสมอ
           *
           * id อย่างเดียวอ่านไม่ออก (`seed-counter-1` ไม่บอกอะไรกับคนที่กำลัง
           * สืบสวนบิลย้อนหลัง) และการ join ชื่อสดตอนแสดงผลก็ใช้ไม่ได้ เพราะ
           * ร้านเปลี่ยนชื่อโต๊ะได้ แล้ว log จะเล่าเรื่องผิดไปจากที่เกิดจริง
           * — เหตุผลเดียวกับ snapshot ทุกตัวในระบบนี้
           */
          tableName: table.name,
          queueNumber: sessionQueueNumber,
          /** โหมดสาธิต: ไม่มีการยืนยันยอดจากธนาคาร — ต้องอ่านออกจาก log ย้อนหลังได้ */
          demoMode: true,
        },
      },
    });

    return { kind: "paid" as const, paymentId: payment.id };
  }).catch((error: unknown) => {
    if (error instanceof PaymentAbort) {
      return { kind: "error" as const, error: error.message };
    }

    throw error;
  });

  if (outcome.kind === "error") {
    return { ok: false, error: outcome.error };
  }

  /**
   * ยิง event หลัง commit เท่านั้น (กฎประจำโปรเจกต์)
   * และยิงเฉพาะครั้งที่ปิดบิลได้จริง — การกดซ้ำที่มาช้ากว่าไม่ต้องยิงซ้ำ
   * ไม่งั้นผังโต๊ะจะกะพริบสองรอบต่อการรับเงินหนึ่งครั้ง
   */
  if (outcome.kind === "paid") {
    await publishRealtimeEvent({
      v: REALTIME_EVENT_VERSION,
      type: "payment.completed",
      branchId: staff.branchId,
      tableId: table.id,
      at: Date.now(),
    });
  }

  return { ok: true, paymentId: outcome.paymentId, alreadyPaid: outcome.kind === "already" };
}

/**
 * ยกเลิก transaction พร้อมข้อความที่พนักงานอ่านรู้เรื่อง
 *
 * ต้อง throw ไม่ใช่ return เพราะเงื่อนไขพวกนี้เจอหลังจากที่เราปิดรอบโต๊ะไปแล้ว
 * (คำสั่งแรกใน transaction) — ถ้า return เฉย ๆ รอบโต๊ะจะถูกปิดทิ้งโดยไม่ได้รับเงิน
 * การ throw คือสิ่งที่ทำให้ Prisma rollback ทุกอย่างกลับไปเหมือนไม่มีอะไรเกิดขึ้น
 */
class PaymentAbort extends Error {}

/** ยอดของแต่ละบิลที่แบ่งมาจากยอดรวมของรอบโต๊ะ */
type OrderShare = {
  discountAmount: number;
  serviceChargeAmount: number;
  vatAmount: number;
  grandTotal: number;
};

/**
 * กระจายยอดที่คิดไว้ก้อนเดียวลงแต่ละบิลในรอบโต๊ะ
 *
 * ── ทำไมไม่คิดเซอร์วิสชาร์จ/VAT ใหม่ทีละใบ ──────────────────────────────
 * เพราะจะปัดเศษหลายรอบแล้วผลรวมไม่ตรงกับยอดที่ลูกค้าจ่ายจริง (ดู billing.ts)
 * ยอดที่ลูกค้าจ่ายคือ `Payment.grandTotal` ส่วนยอดใน Order เป็น "ส่วนแบ่ง"
 * ที่มีไว้ทำรายงานแยกช่องทาง/แยกพนักงานในบทที่ 15 เท่านั้น
 *
 * ── grandTotal ของแต่ละใบ "ประกอบ" จากชิ้นส่วนของตัวเอง ไม่ได้แบ่งมาต่างหาก ──
 * ถ้าแบ่ง grandTotal ด้วย largest remainder อีกชุดหนึ่ง ผลรวมจะตรงก็จริง
 * แต่ในบางแถวจะได้ `subtotal − discount + service + vat ≠ grandTotal`
 * (เพี้ยนได้หนึ่งหน่วยจากการปัดคนละรอบ) แล้วใครที่มาอ่านแถวนั้นทีหลังจะสรุปว่า
 * ข้อมูลเสีย — การประกอบจากชิ้นส่วนทำให้ได้ทั้งผลรวมที่ตรงและแถวที่อ่านแล้วบวกได้
 */
function splitBillAcrossOrders(bill: Bill, orderSubtotals: number[]): OrderShare[] {
  const discounts = distributeByWeight(bill.discountAmount, orderSubtotals);
  const serviceCharges = distributeByWeight(bill.serviceChargeAmount, orderSubtotals);
  const vats = distributeByWeight(bill.vatAmount, orderSubtotals);

  return orderSubtotals.map((subtotal, index) => {
    const discountAmount = discounts[index];
    const serviceChargeAmount = serviceCharges[index];
    const vatAmount = vats[index];

    /**
     * สูตรเดียวกับ calculateBill() เป๊ะ ๆ:
     *   ราคารวม VAT แล้ว → VAT ถูก "ถอด" ออกมาแสดง ไม่ได้บวกเพิ่มในยอดที่จ่าย
     *   ราคายังไม่รวม VAT → VAT บวกเพิ่มท้ายสุด
     * ผิดข้อนี้เมื่อไหร่ ผลรวมของ Order จะไม่เท่ากับ Payment.grandTotal ทันที
     */
    const grandTotal = bill.pricesIncludeVat
      ? subtotal - discountAmount + serviceChargeAmount
      : subtotal - discountAmount + serviceChargeAmount + vatAmount;

    return { discountAmount, serviceChargeAmount, vatAmount, grandTotal };
  });
}

export type PaymentReceipt = NonNullable<Awaited<ReturnType<typeof getPayment>>>;

/**
 * อ่านการรับเงินหนึ่งครั้งเพื่อแสดงหน้าสรุปหลังปิดบิล
 *
 * ตั้งใจอ่านทุกตัวเลขจาก `Payment`/`Order` ที่ snapshot ไว้ **ไม่แตะ Branch เลย**
 * — นี่คือรูปแบบเดียวกับที่ใบเสร็จย้อนหลังในบทที่ 12 ต้องใช้
 */
export async function getPayment(branchId: string, paymentId: string) {
  const payment = await prisma.payment.findFirst({
    where: { id: paymentId, branchId },
    include: {
      paidByStaff: { select: { name: true } },
      /** ชื่อพนักงานที่เป็นลูกค้าของบิลนี้ — ต้องขึ้นบนใบเสร็จ ไม่ใช่แค่อยู่ในฐาน (บทที่ 13) */
      staffCustomer: { select: { name: true, code: true } },
      /**
       * เอา timezone มาด้วยเพื่อแสดง "เวลาที่รับเงิน" ตามเวลาของสาขา ไม่ใช่ของ server
       * — นี่เป็นข้อมูลการแสดงผล ไม่ใช่ตัวเลขเงิน จึงอ่านจาก Branch ได้
       * (ตัวเลขเงินทุกตัวยังอ่านจาก snapshot ในแถวนี้เท่านั้น)
       */
      branch: { select: { timezone: true } },
      /**
       * เอกสารที่ออกให้การรับเงินครั้งนี้ (บทที่ 12) — เอามาแค่ id กับเลขที่
       * เพื่อให้หน้าสรุปการรับเงินมีปุ่มไปหน้าใบเสร็จได้ **ไม่ใช่เพื่อเอาไปแสดงยอด**
       * ยอดทุกตัวยังอ่านจากคอลัมน์ของ Payment แถวนี้เหมือนเดิม
       */
      receipt: { select: { id: true, number: true } },
      tableSession: {
        select: {
          // id ของรอบขายคือตัวชี้บิลของช่องทางที่เปิดพร้อมกันได้หลายใบ —
          // หน้าใบเสร็จใช้ประกอบลิงก์กลับ (/pos/counter/<sessionId>) ผ่าน salePointBasePath()
          id: true,
          pax: true,
          queueNumber: true,
          // ต้องมี kind เพื่อให้หน้าสรุปเขียนหัวเรื่องได้ถูกช่องทาง
          // ("โต๊ะ A1" กับ "ซื้อกลับ คิว 12" คนละคำ ไม่ใช่แค่คนละชื่อ)
          table: { select: { id: true, name: true, kind: true } },
        },
      },
      orders: {
        orderBy: { placedAt: "asc" },
        include: {
          items: {
            where: { status: { not: "CANCELLED" } },
            orderBy: { createdAt: "asc" },
            include: { modifiers: { orderBy: { nameSnapshot: "asc" } } },
          },
        },
      },
    },
  });

  if (!payment) {
    return null;
  }

  const lines = payment.orders.flatMap((order) =>
    order.items.map((item) => ({
      id: item.id,
      orderNumber: order.orderNumber,
      name: item.nameSnapshot,
      quantity: item.quantity,
      unitPrice: item.unitPriceSnapshot + item.modifierTotal,
      lineTotal: item.lineTotal,
      modifiers: item.modifiers.map((modifier) => modifier.nameSnapshot),
    })),
  );

  return { payment, lines };
}
