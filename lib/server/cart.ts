import "server-only";

import { branchDayKey } from "@/lib/branch-day";
import { lineTotalOf } from "@/lib/money";
import { Prisma } from "@/lib/generated/prisma/client";
import type { OrderChannel } from "@/lib/generated/prisma/enums";
import { REALTIME_EVENT_VERSION, type RealtimeEventType } from "@/lib/realtime-events";
import { ORDER_TYPE_FOR_SALE_POINT } from "@/lib/sale-point";
import { prisma } from "@/lib/server/db";
import { syncOrderStatusFromItems } from "@/lib/server/order-progress";
import { publishRealtimeEvent } from "@/lib/server/realtime";

/**
 * ตะกร้าและการส่งออร์เดอร์ (บทที่ 7)
 *
 * ตะกร้าอยู่ "ฝั่ง server" ไม่ใช่ localStorage — คือ Order ที่ status = DRAFT
 * ผูกกับ TableSession เหตุผลตามเล่ม:
 *   - refresh หน้าจอ / แบตหมดแล้วเปิดใหม่ ตะกร้าต้องยังอยู่
 *   - โต๊ะเดียวกันสแกนกันสามเครื่อง ต้องเห็นตะกร้าใบเดียวกัน (บิลใบเดียว)
 *   - ราคาที่ใช้คิดเงินต้องมาจาก DB เท่านั้น ห้ามเชื่อราคาที่ client ส่งมา
 *
 * ทุกฟังก์ชันที่แตะหลายตารางในไฟล์นี้ห่อ $transaction จริง ไม่ใช่เรียกทีละคำสั่ง
 * (CLAUDE.md หัวข้อ 2 + 4)
 */

export type CartResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export type Cart = NonNullable<Awaited<ReturnType<typeof getCart>>>;
export type CartLine = Cart["items"][number];
export type PlacedOrder = Awaited<ReturnType<typeof getPlacedOrders>>[number];

const CART_INCLUDE = {
  items: {
    orderBy: { createdAt: "asc" },
    include: {
      modifiers: { orderBy: { nameSnapshot: "asc" } },
    },
  },
} satisfies Prisma.OrderInclude;

/** ตะกร้าปัจจุบันของรอบโต๊ะนี้ — null = ยังไม่เคยหยิบอะไรใส่ */
export async function getCart(tableSessionId: string) {
  return prisma.order.findFirst({
    where: { tableSessionId, status: "DRAFT" },
    include: CART_INCLUDE,
  });
}

/** ออร์เดอร์ที่ส่งเข้าครัวไปแล้วของรอบโต๊ะนี้ — ใช้ในหน้า "ติดตามออร์เดอร์" */
export async function getPlacedOrders(tableSessionId: string) {
  return prisma.order.findMany({
    where: { tableSessionId, status: { not: "DRAFT" } },
    orderBy: { placedAt: "desc" },
    include: CART_INCLUDE,
  });
}

/**
 * เลขที่ออร์เดอร์ที่คนอ่านได้ เดินต่อเนื่องภายในสาขาต่อวัน เช่น "20260821-0007"
 *
 * ใช้วันตาม timezone ของสาขา ไม่ใช่ของเครื่อง server เพราะร้านที่ปิดตีสอง
 * ต้องได้เลขชุดเดียวกันทั้งกะ และ server อาจรันอยู่คนละ region กับร้าน
 *
 * pad 4 หลักเพื่อให้เรียงแบบ string ได้ลำดับเดียวกับเรียงแบบตัวเลข
 * (ไม่งั้น "10" จะมาก่อน "9") — การชนกันของเลขเดียวกันสองบิลพร้อมกันกันไว้
 * ด้วย @@unique([branchId, orderNumber]) ในschema แล้ว retry ที่ผู้เรียก
 */
async function nextOrderNumber(
  tx: Prisma.TransactionClient,
  branchId: string,
  timezone: string,
): Promise<string> {
  // ต้องเป็น "วันของสาขา" ชุดเดียวกับที่เลขคิวใช้ จึงเรียกฟังก์ชันร่วมกัน
  // (ถ้าสองที่คำนวณวันคนละแบบ จะเกิดออร์เดอร์ที่เลขวันกับเลขคิวคนละวัน)
  const prefix = `${branchDayKey(timezone)}-`;

  const last = await tx.order.findFirst({
    where: { branchId, orderNumber: { startsWith: prefix } },
    orderBy: { orderNumber: "desc" },
    select: { orderNumber: true },
  });

  const lastSeq = last ? Number.parseInt(last.orderNumber.slice(prefix.length), 10) : 0;

  return `${prefix}${String(lastSeq + 1).padStart(4, "0")}`;
}

/** true เมื่อเป็น error "ค่าซ้ำกับ unique constraint" ของ Prisma */
function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

type AddToCartInput = {
  tableSessionId: string;
  branchId: string;
  tableId: string;
  timezone: string;
  menuItemId: string;
  quantity: number;
  modifierIds: string[];
  note: string | null;
  /** ที่มาของบิล — ค่าเริ่มต้นคือลูกค้าสั่งเองผ่าน QR (บทที่ 7) พนักงานสั่งแทนส่ง "POS" (บทที่ 9) */
  channel?: OrderChannel;
};

/**
 * ใส่เมนูลงตะกร้า
 *
 * ตรวจซ้ำทุกอย่างฝั่ง server แม้หน้าจอจะบังคับไปแล้ว เพราะ Server Action
 * ถูกยิงตรงด้วย POST ได้โดยไม่ผ่าน UI ของเรา (docs: mutating-data)
 * ที่ต้องตรวจ: เมนูมีจริงและอยู่สาขานี้, ยังเปิดขาย, ตัวเลือกที่ส่งมาเป็นของ
 * เมนูนี้จริง และครบกฎ required / minSelect / maxSelect ของแต่ละกลุ่ม
 *
 * ราคาทุกตัวอ่านจาก DB แล้ว snapshot ลง OrderItem ตรงนั้นเลย
 * ไม่มีจุดไหนที่รับตัวเลขราคามาจาก client
 */
export async function addToCart(input: AddToCartInput): Promise<CartResult<undefined>> {
  const quantity = Math.trunc(input.quantity);

  if (!Number.isFinite(quantity) || quantity < 1 || quantity > 99) {
    return { ok: false, error: "Quantity must be between 1 and 99" };
  }

  const menuItem = await prisma.menuItem.findFirst({
    where: {
      id: input.menuItemId,
      branchId: input.branchId,
      isAvailable: true,
      category: { isAvailable: true },
    },
    include: {
      modifierGroups: {
        where: { modifierGroup: { isActive: true } },
        include: {
          modifierGroup: {
            include: { modifiers: { where: { isAvailable: true } } },
          },
        },
      },
    },
  });

  if (!menuItem) {
    return { ok: false, error: "This item is no longer available — please choose something else" };
  }

  const remaining = new Set(input.modifierIds);
  const chosen: { id: string; name: string; priceDelta: number }[] = [];

  for (const link of menuItem.modifierGroups) {
    const group = link.modifierGroup;
    const picked = group.modifiers.filter((modifier) => remaining.has(modifier.id));

    if (group.required && picked.length < Math.max(group.minSelect, 1)) {
      return { ok: false, error: `Please choose "${group.name}" first` };
    }

    if (picked.length < group.minSelect) {
      return { ok: false, error: `"${group.name}" needs at least ${group.minSelect} option(s)` };
    }

    if (picked.length > group.maxSelect) {
      return { ok: false, error: `"${group.name}" allows at most ${group.maxSelect} option(s)` };
    }

    for (const modifier of picked) {
      chosen.push({ id: modifier.id, name: modifier.name, priceDelta: modifier.priceDelta });
      remaining.delete(modifier.id);
    }
  }

  // ยังเหลือค้างใน set = ส่ง id ที่ไม่ใช่ตัวเลือกของเมนูนี้ (หรือของหมดไปแล้ว) เข้ามา
  if (remaining.size > 0) {
    return { ok: false, error: "The selected options don't match this item — please try again" };
  }

  const note = normalizeNote(input.note);
  const modifierTotal = chosen.reduce((sum, modifier) => sum + modifier.priceDelta, 0);
  const modifierKey = chosen
    .map((modifier) => modifier.id)
    .sort()
    .join(",");

  await withUniqueRetry(() =>
    prisma.$transaction(async (tx) => {
      const order = await getOrCreateDraftOrder(tx, input);

      /**
       * บรรทัดเดิมที่เหมือนกันทุกอย่าง (เมนูเดียวกัน ตัวเลือกชุดเดียวกัน หมายเหตุเดียวกัน)
       * ให้บวกจำนวนเข้าไปในบรรทัดเดิม ไม่งั้นลูกค้ากดสั่งสามครั้งจะได้สามบรรทัด
       * แล้วครัวเห็นเป็นสามใบสั่งแยกกัน
       */
      const existing = order.items.find(
        (item) =>
          item.menuItemId === menuItem.id &&
          item.note === note &&
          item.modifiers
            .map((modifier) => modifier.modifierId)
            .sort()
            .join(",") === modifierKey,
      );

      if (existing) {
        const newQuantity = Math.min(existing.quantity + quantity, 99);

        await tx.orderItem.update({
          where: { id: existing.id },
          data: {
            quantity: newQuantity,
            lineTotal: lineTotalOf(existing.unitPriceSnapshot, existing.modifierTotal, newQuantity),
          },
        });
      } else {
        await tx.orderItem.create({
          data: {
            branchId: input.branchId,
            orderId: order.id,
            menuItemId: menuItem.id,
            stationId: menuItem.stationId,
            nameSnapshot: menuItem.name,
            unitPriceSnapshot: menuItem.basePrice,
            modifierTotal,
            quantity,
            lineTotal: lineTotalOf(menuItem.basePrice, modifierTotal, quantity),
            status: "DRAFT",
            note,
            modifiers: {
              create: chosen.map((modifier) => ({
                modifierId: modifier.id,
                nameSnapshot: modifier.name,
                priceDeltaSnapshot: modifier.priceDelta,
              })),
            },
          },
        });
      }

      await recalculateOrderSubtotal(tx, order.id);
    }),
  );

  // หลัง commit เท่านั้น — เครื่อง POS ของพนักงานจะเห็นตะกร้าที่ลูกค้ากดจากมือถือ
  // โตขึ้นเองโดยไม่ต้องกดโหลดใหม่ (บทที่ 8)
  await announce("cart.changed", input.branchId, input.tableId);

  return { ok: true, data: undefined };
}

/**
 * แก้จำนวนของบรรทัดในตะกร้า — quantity = 0 คือลบบรรทัดนั้นทิ้ง
 *
 * where ผูก tableSessionId + status DRAFT ไว้ด้วยเสมอ เพื่อไม่ให้ยิง id ของ
 * บรรทัดในบิลโต๊ะอื่น (หรือบิลที่ส่งเข้าครัวไปแล้ว) เข้ามาแก้ได้
 */
export async function setCartLineQuantity(
  tableSessionId: string,
  orderItemId: string,
  quantity: number,
): Promise<CartResult<undefined>> {
  const next = Math.trunc(quantity);

  if (!Number.isFinite(next) || next < 0 || next > 99) {
    return { ok: false, error: "Quantity must be between 0 and 99" };
  }

  const line = await prisma.orderItem.findFirst({
    where: {
      id: orderItemId,
      status: "DRAFT",
      order: { tableSessionId, status: "DRAFT" },
    },
    include: { order: { select: { tableId: true } } },
  });

  if (!line) {
    return { ok: false, error: "Item not found in the cart — it may already have been sent to the kitchen" };
  }

  await prisma.$transaction(async (tx) => {
    if (next === 0) {
      await tx.orderItem.delete({ where: { id: line.id } });
    } else {
      await tx.orderItem.update({
        where: { id: line.id },
        data: {
          quantity: next,
          lineTotal: lineTotalOf(line.unitPriceSnapshot, line.modifierTotal, next),
        },
      });
    }

    await recalculateOrderSubtotal(tx, line.orderId);
  });

  await announce("cart.changed", line.branchId, line.order.tableId);

  return { ok: true, data: undefined };
}

/**
 * ส่งตะกร้าเข้าครัว: DRAFT → PLACED ทั้งบิลและทุกบรรทัดใน transaction เดียว
 *
 * ชั้นกันกดซ้ำที่ "เชื่อถือได้จริง" อยู่ตรงนี้ ไม่ใช่ที่ปุ่ม disable บนหน้าจอ
 * และมีสองจังหวะที่การกดซ้ำจะมาถึง:
 *
 *   1. มาช้ากว่าอันแรกนิดเดียว — ยังอ่านเจอบิล DRAFT ใบเดิม แล้วไปเจอกันที่
 *      updateMany ซึ่งมีเงื่อนไข status: "DRAFT" ติดอยู่ Postgres จะให้คำสั่งที่สอง
 *      รอ row lock จนอันแรก commit แล้วเช็คเงื่อนไขใหม่ ได้ count = 0
 *   2. มาช้ากว่านั้นอีกหน่อย — อ่านตะกร้าไม่เจอแล้วเพราะบิลกลายเป็น PLACED ไปแล้ว
 *
 * ทั้งสองกรณี "ไม่ใช่ error" เพราะของถูกส่งเข้าครัวเรียบร้อยแล้ว ต้องคืนผลสำเร็จ
 * ไม่ใช่ขึ้นข้อความว่าตะกร้าว่างให้ลูกค้าตกใจแล้วกดสั่งใหม่ซ้ำอีกใบ
 */
export async function placeOrder(
  tableSessionId: string,
  options: { placedByStaffId?: string } = {},
): Promise<CartResult<{ orderNumber: string | null }>> {
  const cart = await getCart(tableSessionId);

  // ไม่มีบิล DRAFT เลย = ถูกส่งไปแล้วจากการกดครั้งก่อน (หรือไม่มีอะไรจะส่งตั้งแต่ต้น)
  // ปลายทางเหมือนกันคือพาไปหน้าติดตามออร์เดอร์ ให้ลูกค้าเห็นของจริงที่อยู่ในครัว
  if (!cart) {
    return { ok: true, data: { orderNumber: null } };
  }

  if (cart.items.length === 0) {
    return { ok: false, error: "Cart is empty — please choose an item first" };
  }

  const placedAt = new Date();

  const placed = await prisma.$transaction(async (tx) => {
    const subtotal = await recalculateOrderSubtotal(tx, cart.id);

    const { count } = await tx.order.updateMany({
      where: { id: cart.id, status: "DRAFT" },
      data: {
        status: "PLACED",
        placedAt,
        subtotal,
        // null = ลูกค้ากดส่งเอง / มีค่า = พนักงานคนนี้เป็นคนกดส่งแทน
        placedByStaffId: options.placedByStaffId ?? null,
      },
    });

    if (count === 0) {
      return false;
    }

    await tx.orderItem.updateMany({
      where: { orderId: cart.id, status: "DRAFT", stationId: { not: null } },
      data: { status: "PLACED" },
    });

    /**
     * ของที่ไม่ผูกสถานีครัว (น้ำเปล่าขวด ขนมซอง) ข้ามไป READY ตั้งแต่ตอนส่งเลย
     *
     * เพราะมันไม่ขึ้นจอครัว (ตามกฎในบทที่ 8) จึงไม่มีใครกดเปลี่ยนสถานะให้มันได้
     * ถ้าปล่อยเป็น PLACED ค้างไว้ บิลที่มีน้ำเปล่าปนอยู่จะไม่มีวันขึ้นเป็น READY
     * เพราะสถานะบิลคือสถานะของรายการที่ช้าที่สุด — แล้วโต๊ะนั้นจะคิดเงินไม่ได้เลย
     * ในบทที่ 10 (เงื่อนไขปิดบิลคือ SERVED → PAID)
     *
     * และมันถูกตามความจริงด้วย: ขวดน้ำในตู้เย็น "พร้อมเสิร์ฟ" ตั้งแต่วินาทีที่สั่ง
     * สิ่งที่ยังไม่เกิดคือมีคนไปหยิบมาวางบนโต๊ะ ซึ่งคือขั้น SERVED ที่พนักงานกดเอง
     */
    await tx.orderItem.updateMany({
      where: { orderId: cart.id, status: "DRAFT", stationId: null },
      data: { status: "READY", readyAt: placedAt },
    });

    // บิลที่มีแต่ของหยิบเอง (สั่งน้ำเปล่าอย่างเดียว) ต้องขึ้นเป็น READY ทันที
    // ไม่ใช่ค้างที่ PLACED ที่ updateMany ด้านบนเพิ่งเขียนไป
    await syncOrderStatusFromItems(tx, cart.id);

    return true;
  });

  /**
   * ประกาศเฉพาะตอนที่บิลถูกส่งจริงในการกดครั้งนี้ (count > 0)
   *
   * การกดซ้ำที่มาช้ากว่าอันแรกได้ count = 0 และต้อง "ไม่" ยิง event ซ้ำ —
   * ไม่งั้นจอครัวจะกะพริบสองรอบต่อการสั่งหนึ่งครั้ง แล้วครัวจะเริ่มไม่ไว้ใจว่า
   * ที่เห็นกะพริบคือมีของใหม่เข้ามาจริงหรือแค่จอเสีย
   */
  if (placed) {
    await announce("order.placed", cart.branchId, cart.tableId);
  }

  return { ok: true, data: { orderNumber: cart.orderNumber } };
}

/**
 * ยิง event realtime หลัง transaction commit
 *
 * แยกเป็นฟังก์ชันสั้น ๆ เพื่อให้จุดที่เรียกอ่านออกในบรรทัดเดียวว่ากำลังประกาศอะไร
 * และเพื่อให้ `v` (เวอร์ชัน payload) กับ `at` ถูกเติมที่เดียว ไม่ต้องจำไปเขียนซ้ำ
 */
async function announce(type: RealtimeEventType, branchId: string, tableId: string | null) {
  await publishRealtimeEvent({
    v: REALTIME_EVENT_VERSION,
    type,
    branchId,
    tableId,
    at: Date.now(),
  });
}

/**
 * หาบิล DRAFT ของรอบโต๊ะนี้ ถ้ายังไม่มีก็เปิดใบใหม่
 * เรียกได้เฉพาะภายใน transaction เพราะการอ่านแล้วสร้างต้องอยู่ก้อนเดียวกัน
 */
async function getOrCreateDraftOrder(
  tx: Prisma.TransactionClient,
  input: Pick<AddToCartInput, "tableSessionId" | "branchId" | "tableId" | "timezone" | "channel">,
) {
  const existing = await tx.order.findFirst({
    where: { tableSessionId: input.tableSessionId, status: "DRAFT" },
    include: CART_INCLUDE,
  });

  if (existing) {
    return existing;
  }

  /**
   * `Order.type` มาจากชนิดของ **จุดขาย** เสมอ ไม่ใช่ค่าที่หน้าจอส่งมา
   *
   * (เดิมฮาร์ดโค้ดเป็น "DINE_IN" ทุกใบ ทำให้ enum ตายอยู่ตั้งแต่บทที่ 7)
   * ค่านี้เป็นตัวชี้ว่าบิลนี้คิดเซอร์วิสชาร์จหรือไม่ ถ้ารับจากหน้าจอได้เมื่อไหร่
   * ใครก็ยิง POST เปลี่ยนบิลโต๊ะให้เป็น TAKEAWAY เพื่อตัดค่าบริการทิ้งได้
   */
  const salePoint = await tx.restaurantTable.findUniqueOrThrow({
    where: { id: input.tableId },
    select: { kind: true },
  });

  return tx.order.create({
    data: {
      branchId: input.branchId,
      tableSessionId: input.tableSessionId,
      tableId: input.tableId,
      orderNumber: await nextOrderNumber(tx, input.branchId, input.timezone),
      status: "DRAFT",
      channel: input.channel ?? "CUSTOMER_QR",
      type: ORDER_TYPE_FOR_SALE_POINT[salePoint.kind],
    },
    include: CART_INCLUDE,
  });
}

/**
 * รวมยอดบิลใหม่จาก lineTotal ของทุกบรรทัด
 *
 * ตอนนี้เติมแค่ subtotal — service charge / VAT / grandTotal เป็นงานของ
 * calculateBill ในบทที่ 10 ซึ่งต้อง snapshot อัตราลงบิลตอนปิดการขายด้วย
 * จึงตั้งใจปล่อยคอลัมน์พวกนั้นเป็น 0 ไว้ก่อน ดีกว่าใส่ค่าครึ่ง ๆ กลาง ๆ
 * ให้หน้าจออื่นอ่านไปใช้ผิด
 */
export async function recalculateOrderSubtotal(
  tx: Prisma.TransactionClient,
  orderId: string,
): Promise<number> {
  const aggregate = await tx.orderItem.aggregate({
    where: { orderId, status: { not: "CANCELLED" } },
    _sum: { lineTotal: true },
  });

  const subtotal = aggregate._sum.lineTotal ?? 0;

  await tx.order.update({ where: { id: orderId }, data: { subtotal } });

  return subtotal;
}

/** หมายเหตุที่ว่างหรือมีแต่ช่องว่างให้เก็บเป็น null เพื่อเทียบบรรทัดซ้ำได้ตรง ๆ */
function normalizeNote(note: string | null): string | null {
  const trimmed = note?.trim() ?? "";
  return trimmed.length === 0 ? null : trimmed.slice(0, 200);
}

/**
 * ลองใหม่เมื่อชน unique constraint ของ orderNumber
 * (สองเครื่องที่โต๊ะเดียวกันกดใส่ตะกร้าครั้งแรกพร้อมกันเป๊ะ ๆ)
 */
async function withUniqueRetry<T>(run: () => Promise<T>, attempts = 3): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      if (attempt >= attempts || !isUniqueViolation(error)) {
        throw error;
      }
    }
  }
}
