"use client";

import { useActionState, useId, useState } from "react";

import { SubmitButton } from "@/components/submit-button";
import { IDLE_FORM_STATE, type FormState } from "@/lib/form-state";
import type { Currency } from "@/lib/generated/prisma/enums";
import { formatAmount, formatMoney } from "@/lib/money";
import type { MenuEntity } from "@/lib/server/menu-admin";

import {
  deleteEntityAction,
  moveSortOrderAction,
  saveCategoryAction,
  saveMenuItemAction,
  saveMenuItemGroupsAction,
  saveModifierGroupAction,
  toggleAvailabilityAction,
} from "../actions";

/**
 * ฟอร์มและปุ่มทั้งหมดของหลังร้าน (โมดูล 04)
 *
 * รวมไว้ไฟล์เดียวด้วยเหตุผลเดียวกับ `(pos)/pos/_components/table-actions.tsx`:
 * ทุกตัวเป็น `<form>` เล็ก ๆ ที่ยิง Server Action คนละตัวแต่หน้าตาเหมือนกันหมด
 * แยกเป็นไฟล์ละ 20 บรรทัดแล้วจะต้องไล่เปิดอ่านเจ็ดไฟล์เพื่อเข้าใจหน้าเดียว
 *
 * ทุกอันเป็น `<form>` จริง ไม่ใช่ onClick + fetch เพื่อให้ยังกดได้ก่อน JS โหลดเสร็จ
 * และปุ่ม submit ปิดตัวเองระหว่างรอผ่าน `useFormStatus` (กันกดรัว)
 *
 * **ราคาทุกช่องกรอกเป็น "หน่วยใหญ่" ที่คนอ่านออก** (120 / 120.50) แล้วให้ server
 * แปลงเป็นจำนวนเต็มหน่วยย่อยด้วย `parseMoneyInput()` ที่เดียว — ห้ามแปลงที่นี่
 * (กฎเดียวกับตอนรับเงินในบทที่ 11: ห้ามเชื่อตัวเลขที่ client แปลงมาให้)
 */

/** ข้อความ error ใต้ฟอร์ม — คืน null เมื่อไม่มี เพื่อไม่ให้กินที่ว่างเปล่า ๆ */
function FormError({ state }: { state: FormState }) {
  if (state.status !== "error") {
    return null;
  }

  return (
    <p role="alert" className="alert">
      {state.message}
    </p>
  );
}

/**
 * ปุ่ม "ของหมด / มีของ"
 *
 * ปุ่มเดียวสลับสองสถานะ ไม่ใช่ checkbox เพราะต้องกดได้ด้วยนิ้วโป้งบนแท็บเล็ต
 * ระหว่างที่อีกมือถือของอยู่ และต้องอ่านออกจากระยะแขนว่าตอนนี้เมนูนี้ขายอยู่ไหม
 *
 * ป้ายบนปุ่มคือ **สถานะปัจจุบัน** ไม่ใช่สิ่งที่จะเกิดขึ้นเมื่อกด — คนอ่านลิสต์
 * ยาว ๆ ต้องกวาดตาแล้วรู้ทันทีว่าอะไรหมดบ้าง ไม่ใช่ต้องแปลงในหัวทีละบรรทัด
 */
export function AvailabilityToggle({
  entity,
  id,
  available,
  disabled = false,
}: {
  entity: MenuEntity;
  id: string;
  available: boolean;
  disabled?: boolean;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(
    toggleAvailabilityAction,
    IDLE_FORM_STATE,
  );

  return (
    <form action={formAction} className="flex flex-col items-end gap-1">
      <input type="hidden" name="entity" value={entity} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="next" value={available ? "false" : "true"} />

      <SubmitButton
        pendingLabel="…"
        disabled={disabled}
        className={`btn h-9 px-3 text-[13px] whitespace-nowrap ${
          available ? "btn-secondary" : "is-active"
        }`}
      >
        {available ? "In stock" : "Out of stock"}
      </SubmitButton>

      {state.status === "error" ? (
        <span role="alert" className="text-xs text-[var(--color-accent-700)]">
          {state.message}
        </span>
      ) : null}
    </form>
  );
}

/** เลื่อนลำดับขึ้น/ลง — สองฟอร์มแยกกันเพราะแต่ละอันส่งค่าคนละค่า */
export function MoveButtons({ entity, id }: { entity: MenuEntity; id: string }) {
  return (
    <div className="flex gap-1">
      <MoveButton entity={entity} id={id} direction="up" />
      <MoveButton entity={entity} id={id} direction="down" />
    </div>
  );
}

function MoveButton({
  entity,
  id,
  direction,
}: {
  entity: MenuEntity;
  id: string;
  direction: "up" | "down";
}) {
  const [, formAction] = useActionState<FormState, FormData>(
    moveSortOrderAction,
    IDLE_FORM_STATE,
  );

  return (
    <form action={formAction}>
      <input type="hidden" name="entity" value={entity} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="direction" value={direction} />
      {/*
        `relative` ไม่ใช่ของประดับ — `sr-only` ของ Tailwind คือ `position: absolute`
        ถ้าปุ่มไม่ได้ถูก position ไว้ ข้อความที่มองไม่เห็นนั้นจะไปยึดกับ viewport
        แล้วทะลุ `overflow: hidden` ของเชลล์ออกไปดันความสูงของทั้งหน้า
        (มี `position: relative` ที่ `.pos-skin` กันไว้อีกชั้นแล้ว แต่ตั้งไว้ตรงนี้ด้วย
         เพราะเป็นที่ที่ถูกต้องตามความหมาย: ป้ายนี้เป็นของปุ่มนี้)
      */}
      <SubmitButton
        pendingLabel="…"
        className="btn btn-secondary relative size-9 p-0 text-[13px]"
      >
        <span aria-hidden>{direction === "up" ? "↑" : "↓"}</span>
        <span className="sr-only">{direction === "up" ? "Move up" : "Move down"}</span>
      </SubmitButton>
    </form>
  );
}

/**
 * ปุ่มลบ — ถามยืนยันก่อนเสมอ
 *
 * ตัว server ปฏิเสธการลบของที่เคยถูกสั่งอยู่แล้ว (ดู menu-admin.ts) ปุ่มนี้จึงกัน
 * แค่ "กดพลาด" ไม่ใช่กันข้อมูลเสีย — ถ้า JS ไม่ทำงาน confirm จะถูกข้ามไป
 * ซึ่งยอมรับได้ เพราะด่านจริงอยู่ฝั่ง server
 */
export function DeleteButton({
  entity,
  id,
  name,
}: {
  entity: MenuEntity;
  id: string;
  name: string;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(
    deleteEntityAction,
    IDLE_FORM_STATE,
  );

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (!window.confirm(`Permanently delete "${name}"?`)) {
          event.preventDefault();
        }
      }}
      className="flex flex-col gap-2"
    >
      <input type="hidden" name="entity" value={entity} />
      <input type="hidden" name="id" value={id} />

      <SubmitButton pendingLabel="Deleting…" className="btn btn-secondary h-11">
        Delete permanently
      </SubmitButton>

      <FormError state={state} />
    </form>
  );
}

export function CategoryForm({ category }: { category: { id: string; name: string } | null }) {
  const [state, formAction] = useActionState<FormState, FormData>(
    saveCategoryAction,
    IDLE_FORM_STATE,
  );
  const nameId = useId();

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {category ? <input type="hidden" name="id" value={category.id} /> : null}

      <div className="flex flex-col gap-2">
        <label htmlFor={nameId} className="kicker">
          Category name
        </label>
        <input
          id={nameId}
          name="name"
          defaultValue={category?.name ?? ""}
          required
          autoComplete="off"
          placeholder="e.g. Stir-fry · Soup · Drinks"
          className="input display h-12 text-[16px]"
        />
      </div>

      <FormError state={state} />

      <SubmitButton pendingLabel="Saving…" className="btn btn-primary display h-12">
        {category ? "Save changes" : "Add category"}
      </SubmitButton>
    </form>
  );
}

export function MenuItemForm({
  item,
  categories,
  stations,
  currency,
}: {
  item: {
    id: string;
    name: string;
    description: string | null;
    categoryId: string;
    stationId: string | null;
    imageUrl: string | null;
    basePrice: number;
  } | null;
  categories: { id: string; name: string; isAvailable: boolean }[];
  stations: { id: string; name: string }[];
  currency: Currency;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(
    saveMenuItemAction,
    IDLE_FORM_STATE,
  );
  const fieldId = useId();
  const [imageUrl, setImageUrl] = useState(item?.imageUrl ?? "");

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {item ? <input type="hidden" name="id" value={item.id} /> : null}

      <div className="flex flex-col gap-2">
        <label htmlFor={`${fieldId}-name`} className="kicker">
          Item name
        </label>
        <input
          id={`${fieldId}-name`}
          name="name"
          defaultValue={item?.name ?? ""}
          required
          autoComplete="off"
          className="input display h-12 text-[16px]"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <label htmlFor={`${fieldId}-price`} className="kicker">
            Price ({formatMoney(0, currency).replace(/[\d.,]/g, "") || currency})
          </label>
          {/*
            inputMode="decimal" ไม่ใช่ type="number" — เหตุผลเดียวกับช่องรับเงินสด
            ในบทที่ 11: type="number" กินค่าที่พิมพ์ผิดรูปแบบทิ้งเงียบ ๆ
            ค่าที่ส่งไปเป็น "ข้อความที่คนพิมพ์" server เป็นคนแปลงเอง
          */}
          <input
            id={`${fieldId}-price`}
            name="basePrice"
            inputMode="decimal"
            defaultValue={item ? formatAmount(item.basePrice, currency) : ""}
            required
            autoComplete="off"
            placeholder={formatAmount(0, currency)}
            className="input display h-12 text-right text-[16px] tabular-nums"
          />
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor={`${fieldId}-category`} className="kicker">
            Category
          </label>
          <select
            id={`${fieldId}-category`}
            name="categoryId"
            defaultValue={item?.categoryId ?? categories[0]?.id ?? ""}
            required
            className="input h-12 text-[15px]"
          >
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
                {category.isAvailable ? "" : " (category disabled)"}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor={`${fieldId}-station`} className="kicker">
          Kitchen station
        </label>
        <select
          id={`${fieldId}-station`}
          name="stationId"
          defaultValue={item?.stationId ?? ""}
          className="input h-12 text-[15px]"
        >
          {/*
            "ไม่ต้องผ่านครัว" ไม่ใช่ตัวเลือกสำรอง แต่เป็นสถานะที่มีความหมายชัดเจน:
            ของพวกนี้ (น้ำขวด ขนมซอง) ข้ามไป READY ตั้งแต่ตอนกดส่ง เพราะไม่มีใคร
            ต้องทำมัน — ถ้าเลือกผิดเป็นสถานีครัว มันจะไปค้างรอครัวกดบนจอที่ไม่มีใครดู
          */}
          <option value="">No kitchen station (self-serve)</option>
          {stations.map((station) => (
            <option key={station.id} value={station.id}>
              {station.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor={`${fieldId}-description`} className="kicker">
          Description (optional)
        </label>
        <textarea
          id={`${fieldId}-description`}
          name="description"
          defaultValue={item?.description ?? ""}
          rows={2}
          className="input py-2 text-[15px]"
        />
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor={`${fieldId}-image`} className="kicker">
          Image URL (https:// or a /file in public)
        </label>
        <input
          id={`${fieldId}-image`}
          name="imageUrl"
          value={imageUrl}
          onChange={(event) => setImageUrl(event.target.value)}
          autoComplete="off"
          placeholder="https://…"
          className="input h-12 text-[14px]"
        />
        {/*
          พรีวิวด้วย <img> ธรรมดา ไม่ใช่ next/image โดยตั้งใจ — โดเมนที่พนักงาน
          เพิ่งพิมพ์เข้ามาอาจไม่อยู่ใน images.remotePatterns แล้ว next/image
          จะโยน error ทั้งหน้าแทนที่จะแค่แสดงรูปไม่ขึ้น ที่นี่ต้องการให้ "เห็นว่าลิงก์ใช้ได้ไหม"
          ส่วนหน้าลูกค้ายังใช้ next/image เหมือนเดิม
        */}
        {imageUrl.startsWith("https://") || imageUrl.startsWith("/") ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt=""
            className="h-32 w-full border-2 border-[var(--color-text)] object-cover"
          />
        ) : null}
      </div>

      <FormError state={state} />

      <SubmitButton pendingLabel="Saving…" className="btn btn-primary display h-12">
        {item ? "Save changes" : "Add item"}
      </SubmitButton>
    </form>
  );
}

/**
 * ผูกกลุ่มตัวเลือกเข้ากับเมนู — ติ๊กแล้วกดบันทึกทั้งชุด
 *
 * ตั้งใจให้เป็นฟอร์มแยกจากฟอร์มเมนู (คนละปุ่มบันทึก) เพราะเมนูต้องมีตัวตนใน DB ก่อน
 * ถึงจะผูกกลุ่มได้ — ถ้ารวมเป็นฟอร์มเดียว ตอน "เพิ่มเมนูใหม่" จะต้องมีสถานะกลาง
 * ที่ผูกกลุ่มกับเมนูที่ยังไม่มี id ซึ่งซับซ้อนโดยไม่จำเป็น
 */
export function MenuItemGroupsForm({
  menuItemId,
  groups,
  selectedIds,
}: {
  menuItemId: string;
  groups: { id: string; name: string; isActive: boolean; required: boolean }[];
  selectedIds: string[];
}) {
  const [state, formAction] = useActionState<FormState, FormData>(
    saveMenuItemGroupsAction,
    IDLE_FORM_STATE,
  );

  if (groups.length === 0) {
    return (
      <p className="kicker">No modifier groups in this branch yet — create one on the &ldquo;Modifiers&rdquo; page first</p>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="menuItemId" value={menuItemId} />

      <ul className="flex flex-col gap-2">
        {groups.map((group) => (
          <li key={group.id}>
            <label className="flex items-center gap-3 border-2 border-[var(--color-divider)] px-3 py-2">
              <input
                type="checkbox"
                name="modifierGroupId"
                value={group.id}
                defaultChecked={selectedIds.includes(group.id)}
                className="size-5 flex-none accent-[var(--color-accent)]"
              />
              <span className="display text-[15px]">{group.name}</span>
              {group.required ? <span className="tag tag-accent">Required</span> : null}
              {group.isActive ? null : <span className="tag tag-neutral">Disabled</span>}
            </label>
          </li>
        ))}
      </ul>

      <FormError state={state} />

      {state.status === "success" ? (
        <p role="status" className="kicker kicker-accent">
          {state.message}
        </p>
      ) : null}

      <SubmitButton pendingLabel="Saving…" className="btn btn-secondary h-11">
        Save this item&apos;s modifier groups
      </SubmitButton>
    </form>
  );
}

type ModifierRow = { key: string; id: string | null; name: string; priceText: string };

/**
 * ฟอร์มกลุ่มตัวเลือก + ตัวเลือกย่อยในฟอร์มเดียว
 *
 * ตัวเลือกย่อยส่งเป็น "อาเรย์ขนาน" (`modifierId[]` / `modifierName[]` / `modifierPrice[]`)
 * ซึ่งเป็นวิธีที่ `<form>` ธรรมดาส่งรายการซ้ำได้โดยไม่ต้องพึ่ง JSON —
 * ฝั่ง server จับคู่ด้วย index เดียวกัน (ดู saveModifierGroupAction)
 *
 * ต้องมี client state ที่นี่จริง ๆ เพราะจำนวนแถวเพิ่ม/ลดได้ ซึ่งเป็นจุดเดียว
 * ในทั้งโมดูลที่ RSC + ฟอร์มธรรมดาทำแทนไม่ได้
 */
export function ModifierGroupForm({
  group,
  currency,
}: {
  group: {
    id: string;
    name: string;
    required: boolean;
    minSelect: number;
    maxSelect: number;
    modifiers: { id: string; name: string; priceDelta: number; isAvailable: boolean }[];
  } | null;
  currency: Currency;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(
    saveModifierGroupAction,
    IDLE_FORM_STATE,
  );
  const fieldId = useId();

  const [rows, setRows] = useState<ModifierRow[]>(() =>
    group && group.modifiers.length > 0
      ? group.modifiers.map((modifier) => ({
          key: modifier.id,
          id: modifier.id,
          name: modifier.name,
          priceText: formatAmount(modifier.priceDelta, currency),
        }))
      : [{ key: "new-0", id: null, name: "", priceText: formatAmount(0, currency) }],
  );

  const updateRow = (key: string, patch: Partial<ModifierRow>) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {group ? <input type="hidden" name="id" value={group.id} /> : null}

      <div className="flex flex-col gap-2">
        <label htmlFor={`${fieldId}-name`} className="kicker">
          Group name
        </label>
        <input
          id={`${fieldId}-name`}
          name="name"
          defaultValue={group?.name ?? ""}
          required
          autoComplete="off"
          placeholder="e.g. Spice level · Size"
          className="input display h-12 text-[16px]"
        />
      </div>

      <div className="flex flex-col gap-3 border-2 border-[var(--color-divider)] p-3">
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            name="required"
            defaultChecked={group?.required ?? false}
            className="size-5 flex-none accent-[var(--color-accent)]"
          />
          <span className="display text-[15px]">Required before adding to cart</span>
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <label htmlFor={`${fieldId}-min`} className="kicker">
              Minimum selections
            </label>
            <input
              id={`${fieldId}-min`}
              name="minSelect"
              type="number"
              min={0}
              step={1}
              defaultValue={group?.minSelect ?? 0}
              className="input h-11 text-right tabular-nums"
            />
          </div>

          <div className="flex flex-col gap-2">
            <label htmlFor={`${fieldId}-max`} className="kicker">
              Maximum selections
            </label>
            <input
              id={`${fieldId}-max`}
              name="maxSelect"
              type="number"
              min={1}
              step={1}
              defaultValue={group?.maxSelect ?? 1}
              className="input h-11 text-right tabular-nums"
            />
          </div>
        </div>

        <p className="kicker">
          Maximum = 1 means single choice · more than 1 allows multiple selections
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <span className="kicker">Options in this group</span>
          <span className="kicker">Price delta can be negative, e.g. -10</span>
        </div>

        {rows.map((row, index) => (
          <div key={row.key} className="flex items-end gap-2">
            <input type="hidden" name="modifierId" value={row.id ?? ""} />

            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <label htmlFor={`${fieldId}-mod-${index}`} className="sr-only">
                Option {index + 1} name
              </label>
              <input
                id={`${fieldId}-mod-${index}`}
                name="modifierName"
                value={row.name}
                onChange={(event) => updateRow(row.key, { name: event.target.value })}
                autoComplete="off"
                placeholder="e.g. Mild"
                className="input h-11 text-[15px]"
              />
            </div>

            <div className="flex w-[110px] flex-none flex-col gap-1">
              <label htmlFor={`${fieldId}-price-${index}`} className="sr-only">
                Option {index + 1} price delta
              </label>
              <input
                id={`${fieldId}-price-${index}`}
                name="modifierPrice"
                inputMode="decimal"
                value={row.priceText}
                onChange={(event) => updateRow(row.key, { priceText: event.target.value })}
                autoComplete="off"
                className="input h-11 text-right tabular-nums"
              />
            </div>

            <button
              type="button"
              onClick={() => setRows((current) => current.filter((item) => item.key !== row.key))}
              disabled={rows.length === 1}
              aria-label={`Remove option ${index + 1}`}
              className="btn btn-secondary size-11 flex-none p-0"
            >
              ✕
            </button>
          </div>
        ))}

        <button
          type="button"
          onClick={() =>
            setRows((current) => [
              ...current,
              {
                key: `new-${Date.now()}`,
                id: null,
                name: "",
                priceText: formatAmount(0, currency),
              },
            ])
          }
          className="btn btn-secondary h-11"
        >
          + Add option
        </button>

        {group ? (
          <p className="kicker">
            Options removed from this list are <strong>disabled</strong>, not deleted,
            because past bills still reference them.
          </p>
        ) : null}
      </div>

      <FormError state={state} />

      <SubmitButton pendingLabel="Saving…" className="btn btn-primary display h-12">
        {group ? "Save changes" : "Create modifier group"}
      </SubmitButton>
    </form>
  );
}
