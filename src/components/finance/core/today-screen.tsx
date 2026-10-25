"use client";

/**
 * «Сегодня» - главная (ядро, фаза 8): что сделать, числами.
 *
 * Каждая карточка - дело из итогов ядра (долги, оплаты без договора, АВР и
 * ЭСФ, НДС, сверка с таблицей, участники) или счета к выставлению; число -
 * то же, что в разделе, куда карточка ведёт. Карточка грузится сама: медленная
 * не держит остальные. Щелчок по карточке или строке - раздел с уже выбранным
 * списком (состояние экрана пишется до перехода). Без права - карточки нет
 * вовсе; делать нечего - карточка говорит это словами и уходит в конец.
 */
import { useEffect, useMemo, useState } from "react";

import { can, isAdmin } from "@/components/finance/access";
import { type Me, type TodayCard, type TodayCardKey, coreApi, formatMonth } from "@/components/finance/api";
import { contractMoney, plural } from "@/components/finance/format";
import { ArrowRightIcon } from "@/components/icons";
import { useSessionScope, writeSession } from "@/components/session-state";

type Slot = { key: TodayCardKey | "bills"; card: TodayCard | null; error: string; hidden: boolean };

/** Порядок - от денег к порядку в данных; права - те же, что у разделов, куда карточки ведут. */
const CARDS: { key: TodayCardKey; allowed: (me: Me) => boolean }[] = [
  { key: "debts", allowed: (me) => can(me, "reports.debts") && can(me, "contracts") },
  { key: "payments", allowed: (me) => isAdmin(me) },
  { key: "acts", allowed: (me) => isAdmin(me) },
  { key: "vat", allowed: (me) => isAdmin(me) && can(me, "reports.summary") },
  { key: "shadow", allowed: (me) => isAdmin(me) },
  { key: "participants", allowed: (me) => can(me, "contracts") },
];

const WEEKDAY = new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

function messageOf(exc: unknown, fallback: string): string {
  return exc instanceof Error && exc.message ? exc.message : fallback;
}

function statusOf(exc: unknown): number {
  return typeof exc === "object" && exc !== null && "status" in exc ? Number((exc as { status: unknown }).status) : 0;
}

function money(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "" || !Math.round(Number(value))) return "-";
  return contractMoney(Math.round(Number(value)));
}

const MONTHS_IN = [
  "январе", "феврале", "марте", "апреле", "мае", "июне",
  "июле", "августе", "сентябре", "октябре", "ноябре", "декабре",
];

/** Карточка счетов - из `me.bills` (сводная таблица), без своего запроса. */
function billsCard(me: Me): TodayCard | null {
  const bills = me.bills;
  if (!bills || !can(me, "invoices")) return null;
  const count = bills.overdue + bills.soon;
  return {
    key: "debts",
    title: "Счета к выставлению",
    amount: null,
    count,
    unit: "счетов",
    empty: count ? "" : "Все счета выставлены",
    note: "",
    lines: [
      { label: "срок прошёл", count: bills.overdue },
      { label: "срок через 3 дня и раньше", count: bills.soon },
    ].filter((line) => line.count),
    go: { section: "invoices", session: {} },
  };
}

export function TodayScreen({ me, onGo }: { me: Me; onGo: (section: string) => void }) {
  const scope = useSessionScope();
  const allowed = useMemo(() => CARDS.filter((item) => item.allowed(me)).map((item) => item.key), [me]);
  const [slots, setSlots] = useState<Record<string, Slot>>({});
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    for (const key of allowed) {
      coreApi
        .today(key, { signal: controller.signal })
        .then((card) => setSlots((was) => ({ ...was, [key]: { key, card, error: "", hidden: false } })))
        .catch((exc) => {
          if (controller.signal.aborted) return;
          // Нет права - карточки нет; остальное - словами в карточке.
          const hidden = statusOf(exc) === 403;
          setSlots((was) => ({ ...was, [key]: { key, card: null, error: hidden ? "" : messageOf(exc, "Не посчиталось"), hidden } }));
        });
    }
    return () => controller.abort();
  }, [allowed, revision]);

  const go = (target: { section: string; session: Record<string, string> }, extra?: Record<string, string>) => {
    for (const [key, value] of Object.entries({ ...target.session, ...(extra ?? {}) })) writeSession(scope, key, value);
    onGo(target.section);
  };

  const bills = billsCard(me);
  const ordered: Slot[] = [
    ...(allowed.includes("debts") ? [slots.debts ?? { key: "debts" as const, card: null, error: "", hidden: false }] : []),
    ...(bills ? [{ key: "bills" as const, card: bills, error: "", hidden: false }] : []),
    ...allowed.filter((key) => key !== "debts").map((key) => slots[key] ?? { key, card: null, error: "", hidden: false }),
  ].filter((slot) => !slot.hidden);
  // Делать нечего - в конец: сверху то, что ждёт человека.
  const busy = ordered.filter((slot) => !slot.card?.empty);
  const calm = ordered.filter((slot) => slot.card?.empty);

  return (
    <div className="today-screen">
      <div className="today-head">
        <p className="today-date">{WEEKDAY.format(new Date())}</p>
        <button type="button" className="btn-ghost btn-sm" onClick={() => setRevision((value) => value + 1)}>
          Пересчитать
        </button>
      </div>
      {!ordered.length ? <p className="creg-empty">Дел, которые KORT считает сам, для вас пока нет</p> : null}
      <div className="today-grid">
        {busy.map((slot) => (
          <Card key={slot.key} slot={slot} onGo={go} />
        ))}
      </div>
      {calm.length ? (
        <div className="today-calm" aria-label="Делать нечего">
          {calm.map((slot) => (
            <button key={slot.key} type="button" className="today-calm-item" onClick={() => slot.card && go(slot.card.go)}>
              <span className="today-calm-title">{slot.card?.title}</span>
              <span className="fin-soft">{slot.card?.empty}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Card({ slot, onGo }: { slot: Slot; onGo: (target: TodayCard["go"], extra?: Record<string, string>) => void }) {
  const card = slot.card;
  if (!card) {
    return (
      <section className="today-card" aria-busy={!slot.error}>
        <p className="today-loading">{slot.error || "Считаем…"}</p>
      </section>
    );
  }
  const value = card.amount !== null ? money(card.amount) : card.count !== null ? String(card.count) : "-";
  return (
    <section className="today-card">
      <button type="button" className="today-card-head" onClick={() => onGo(card.go)}>
        <span className="today-title">{card.title}</span>
        <ArrowRightIcon size={14} />
      </button>
      <p className="today-value">
        <span className="fin-kpi-value">{value}</span>
        {card.amount !== null && card.count ? (
          <span className="today-unit">
            {card.count} {card.unit === "договоров" ? plural(card.count, "договор", "договора", "договоров") : card.unit}
          </span>
        ) : card.amount === null && card.unit ? (
          <span className="today-unit">{card.unit === "дел" ? plural(card.count ?? 0, "дело", "дела", "дел") : card.unit}</span>
        ) : null}
      </p>
      {card.lines.length ? (
        <ul className="today-lines">
          {card.lines.map((line) => (
            <li key={line.label}>
              <button type="button" className="today-line" onClick={() => onGo(card.go, line.go)}>
                <span className="today-line-label">
                  {line.label}
                  {line.month ? ` ${MONTHS_IN[Number(line.month.slice(5, 7)) - 1] ? `в ${MONTHS_IN[Number(line.month.slice(5, 7)) - 1]}` : formatMonth(line.month)}` : ""}
                  {line.names?.length ? <span className="fin-soft"> · {line.names.join(", ")}</span> : null}
                </span>
                <span className="fin-num">
                  {line.amount !== undefined && line.amount !== null ? money(line.amount) : line.count !== undefined ? line.count : ""}
                  {line.of ? <span className="fin-soft"> из {line.of}</span> : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {card.note ? <p className="today-note">{card.note.replace(/(\d+\.\d{2})/, (match) => money(match))}</p> : null}
    </section>
  );
}
