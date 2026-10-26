"use client";

/**
 * «Начисления» в карточке договора - лента месяцев (ядро, фаза 2).
 *
 * Месяц - начисление KORT из условий договора и, пока правда в книге-сводке,
 * её строка рядом: счёт, оплата, АВР. Чем месяц расходится с книгой - словами
 * у месяца (цвет отказа: это то, что надо поправить); что дописать в условия,
 * чтобы сошлось, - предложением с «Записать». Поправка месяца - другая сумма
 * или «не начислять» - решение человека и потому с причиной.
 *
 * День периода и «начислять с» - обычные поля реестра, правятся здесь, рядом
 * с месяцами, которые от них зависят.
 *
 * Оплаты (фаза 4) - тем, кому открыты оплаты по выписке: сколько в месяце
 * оплачено по разнесению KORT (`core/payments.py`), долг на сегодня, входящее
 * сальдо на начало учёта и сами платежи - куда каждый лёг.
 */
import { useContext, useEffect, useState } from "react";

import {
  type AccrualOut,
  type ActCode,
  type BookMonthOut,
  type ContractMoney,
  type ContractMonths,
  type MoneyBucket,
  type MonthAct,
  type ShadowCode,
  FinanceApiError,
  coreApi,
  formatMonth,
} from "@/components/finance/api";
import { actText } from "@/components/finance/core/acts-screen";
import { CardScopeContext, InlineField } from "@/components/finance/contracts/field-editor";
import { fieldOf } from "@/components/finance/contracts/schema";
import { Section } from "@/components/finance/contracts/section";
import { useRegistry } from "@/components/finance/contracts/store";
import { ProposalActions } from "@/components/finance/core/proposal";
import { contractMoney, formatDay } from "@/components/finance/format";

function messageOf(exc: unknown, fallback: string): string {
  return exc instanceof Error && exc.message ? exc.message : fallback;
}

/** «25.10 - 24.11»: период без года, год - в месяце строки. */
function span(from: string | null, to: string | null): string {
  const short = (iso: string) => formatDay(iso).slice(0, 5);
  if (!from) return "";
  return to ? `${short(from)} - ${short(to)}` : short(from);
}

/** Чем месяц расходится с книгой - словами. */
function codeText(code: ShadowCode, book: BookMonthOut | null): string {
  switch (code) {
    case "amount":
      return `в таблице ${book?.amount ? contractMoney(book.amount) : "пусто"}`;
    case "period":
      return `в таблице с ${book?.period_from ? formatDay(book.period_from).slice(0, 5) : "-"}`;
    case "executor":
      return `в таблице ${book?.code || "другое юрлицо"}`;
    case "no_kort":
      return "в таблице есть, по договору нет";
    case "no_book":
      return "в таблице нет";
  }
}

/** Чем АВР 1С и книги расходятся - словами у месяца. */
const ACT_CODES: Record<ActCode, string> = {
  act_no_book: "в таблице АВР нет",
  act_no_1c: "в 1С АВР нет",
  act_amount: "сумма АВР в 1С и таблице разная",
  act_signed: "подписание в 1С и таблице разное",
  esf: "ЭСФ в 1С и таблице разный",
};

const ACT_SOURCE = { kort: "KORT", "1c": "1С", book: "таблица" } as const;
const ACT_IN = { kort: "в KORT", "1c": "в 1С", book: "в таблице" } as const;

function amountText(accrual: AccrualOut): string {
  if (accrual.skipped) return "не начислять";
  return accrual.amount ? contractMoney(accrual.amount) : "-";
}

/** НДС месяца для счёта и АВР: «в т.ч. НДС 16% 16 000» или «+ НДС 16% 16 000 = 116 000». */
function vatText(vat: NonNullable<ContractMonths["months"][number]["vat"]>): string {
  const part = `НДС ${vat.rate}% ${contractMoney(vat.vat)}`;
  return vat.mode === "on_top" ? `+ ${part} = ${contractMoney(vat.gross)}` : `в т.ч. ${part}`;
}

export function Accruals({ contractId, seq }: { contractId: string; seq: number }) {
  const schema = useRegistry((s) => s.schema);
  const contract = useRegistry((s) => s.byId.get(contractId));
  const locked = useContext(CardScopeContext).readonly;
  const canEdit = Boolean(schema?.access.edit) && !locked;
  const [data, setData] = useState<{ id: string; value: ContractMonths } | null>(null);
  const [failed, setFailed] = useState("");
  const [revision, setRevision] = useState(0);
  const [note, setNote] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    coreApi
      .months(contractId)
      .then((value) => {
        if (!alive) return;
        setData({ id: contractId, value });
        setFailed("");
      })
      .catch((exc) => {
        // Без связи (десктоп) лента молчит: карточка и так говорит «Нет связи».
        if (alive && !(exc instanceof FinanceApiError && exc.status === 0)) setFailed(messageOf(exc, "Начисления не прочитались"));
      });
    return () => {
      alive = false;
    };
  }, [contractId, seq, revision]);
  const value = data?.id === contractId ? data.value : null;
  if (!value) return failed ? <Section title="Начисления"><p className="ifield-error">{failed}</p></Section> : null;

  const billing = String(contract?.values.billing ?? "");
  const periodField = billing === "month" ? fieldOf(schema, "period_day") : undefined;
  const fromField = billing === "month" || billing === "total" ? fieldOf(schema, "billing_from") : undefined;
  // НДС договора - когда исполнитель плательщик НДС (`core/vat.py`); пусто - «в сумме».
  const vatField = billing === "month" || billing === "total" ? fieldOf(schema, "vat_mode") : undefined;
  const { schedule } = value;
  const summary =
    schedule.kind === "month"
      ? `в месяц${schedule.period_day ? ` · период с ${schedule.period_day}-го` : ""}${schedule.start ? ` · с ${formatDay(schedule.start)}` : ""}`
      : schedule.kind === "total"
        ? `разово${schedule.start ? ` · ${formatDay(schedule.start)}` : ""}`
        : "";
  const changed = (text: string) => {
    setNote(text);
    setEditing(null);
    setRevision((current) => current + 1);
  };
  const money = value.money?.since ? value.money : null;
  const buckets = new Map((money?.months ?? []).map((bucket) => [bucket.month, bucket]));
  const current = (money?.today ?? "").slice(0, 7);
  // Месяц «сегодня» для АВР: прошлые месяцы без АВР - «АВР нет», текущий и будущие - рано.
  const currentMonth = value.today?.slice(0, 7) ?? current;
  return (
    <Section title="Начисления" end={summary ? <span className="fin-muted">{summary}</span> : null}>
      {schedule.why ? <p className="acc-why">{schedule.why}</p> : null}
      {money ? <MoneyLine money={money} /> : null}
      {periodField || fromField || vatField ? (
        <div className="card-grid acc-terms">
          {periodField ? <InlineField contractId={contractId} field={periodField} /> : null}
          {fromField ? <InlineField contractId={contractId} field={fromField} /> : null}
          {vatField ? <InlineField contractId={contractId} field={vatField} /> : null}
        </div>
      ) : null}
      {value.proposals.length && canEdit ? (
        <div className="acc-proposals" role="list">
          {value.proposals.map((proposal) => (
            <div key={proposal.key} className="acc-proposal" role="listitem">
              <span>{proposal.text}</span>
              <ProposalActions proposal={proposal} onApplied={changed} />
            </div>
          ))}
        </div>
      ) : null}
      {note ? (
        <p className="acc-note" role="status">
          {note}
        </p>
      ) : null}
      {value.months.length ? (
        <div className="acc-list" role="list" data-money={money ? "true" : undefined}>
          {value.months.map((row) => {
            const bucket = buckets.get(row.month);
            const paidCode = money ? paidText(bucket, row.book, value.window.includes(row.month) && row.month <= current) : "";
            const act = value.acts?.[row.month];
            // «Верно у KORT» (сверка): расхождение начисления решено - месяц не отмечается.
            const settled = Boolean(row.verified);
            const codes = [
              ...(settled ? [] : row.codes.map((code) => codeText(code, row.book))),
              ...(paidCode ? [paidCode] : []),
              ...(act?.codes ?? []).map((code) => ACT_CODES[code]),
            ];
            const aside = settled
              ? `верно у KORT: ${row.codes.map((code) => codeText(code, row.book)).join(", ")}`
              : row.codes.length
                ? (row.hint ?? "")
                : "";
            return (
            <div key={row.month} role="listitem">
              <div className="acc-row" data-off={codes.length ? "true" : undefined}>
                <span className="acc-month">
                  {formatMonth(row.month)}
                  <small>{row.kort ? span(row.kort.period_from, row.kort.period_to) : row.book ? span(row.book.period_from, row.book.period_to) : ""}</small>
                </span>
                <span className="acc-amount">
                  {row.kort ? amountText(row.kort) : <span className="fin-muted">-</span>}
                  {row.vat ? <small>{vatText(row.vat)}</small> : null}
                  {row.kort?.adjustment ? <small>поправка: {row.kort.adjustment.reason}</small> : null}
                  {row.paused ? <small>приостановлен</small> : null}
                </span>
                {money ? <PaidCell bucket={bucket} month={row.month} since={money.since} current={current} /> : null}
                {value.book ? <BookCell book={row.book} withAct={!value.acts} /> : null}
                <span className="acc-codes">
                  {codes.join(" · ")}
                  {aside ? <small>{aside}</small> : null}
                </span>
                {value.acts ? <ActLine act={act} accrued={Boolean(row.kort && !row.kort.skipped && Number(row.kort.amount))} past={row.month < currentMonth} /> : null}
                <span className="acc-acts">
                  {canEdit && row.kort?.adjustment ? (
                    <RemoveAdjustment contractId={contractId} documentId={row.kort.adjustment.id} onDone={changed} />
                  ) : canEdit ? (
                    <button
                      type="button"
                      className="fin-link-btn"
                      aria-expanded={editing === row.month}
                      onClick={() => setEditing(editing === row.month ? null : row.month)}
                    >
                      Поправка
                    </button>
                  ) : null}
                </span>
              </div>
              {editing === row.month ? (
                <AdjustmentForm
                  contractId={contractId}
                  month={row.month}
                  initial={row.book?.amount ?? row.kort?.amount ?? ""}
                  onDone={changed}
                  onCancel={() => setEditing(null)}
                />
              ) : null}
            </div>
            );
          })}
        </div>
      ) : (
        <p className="party-none">Начислений в эти месяцы нет</p>
      )}
      {money?.payments.length ? <PaymentsList money={money} /> : null}
    </Section>
  );
}

/** Оплачено и долг договора - одной строкой над месяцами. */
function MoneyLine({ money }: { money: ContractMoney }) {
  const debt = money.debt === null ? null : Number(money.debt);
  const opening = money.opening;
  return (
    <p className="acc-money">
      <span>
        оплачено <b>{contractMoney(money.paid)}</b>
      </span>
      {debt === null ? (
        <span>долг не считается: начислений по договору KORT не считает</span>
      ) : (
        <span>
          {debt < 0 ? "аванс " : "долг на сегодня "}
          <b>{contractMoney(Math.abs(debt))}</b>
        </span>
      )}
      {opening ? (
        <span>
          входящее сальдо на {formatDay(money.since)}: {contractMoney(opening.accrued)}
          {Number(opening.debt) > 0 ? `, осталось ${contractMoney(opening.debt)}` : ", закрыто"}
        </span>
      ) : null}
      {Number(money.over_total) ? <span>сверх начислений {contractMoney(money.over_total)}</span> : null}
      <span className="fin-muted">учёт оплат с {formatDay(money.since)}</span>
    </p>
  );
}

/** Оплата месяца по KORT: сколько и что осталось; до начала учёта - не знаем. */
function PaidCell({ bucket, month, since, current }: { bucket: MoneyBucket | undefined; month: string; since: string | null; current: string }) {
  if (since && month < since.slice(0, 7)) return <span className="acc-paid fin-muted">до учёта оплат</span>;
  if (!bucket) return <span className="acc-paid fin-muted">-</span>;
  const paid = Number(bucket.paid);
  const debt = Number(bucket.debt);
  const accrued = Number(bucket.accrued);
  return (
    <span className="acc-paid">
      {paid ? `оплачено ${contractMoney(bucket.paid)}` : <span className="fin-muted">не оплачено</span>}
      {paid && accrued && debt > 0 && month <= current ? <small>осталось {contractMoney(bucket.debt)}</small> : null}
      {paid && !accrued ? <small>начисления нет</small> : null}
      {paid && accrued && month > current ? <small>заранее</small> : null}
    </span>
  );
}

/** Оплата KORT расходится с «Сумма Факт Поступ.» книги - словами у месяца. */
function paidText(bucket: MoneyBucket | undefined, book: BookMonthOut | null, compare: boolean): string {
  if (!compare || !book || book.paid === undefined) return "";
  const ours = Number(bucket?.paid ?? 0);
  const theirs = Number(book.paid ?? 0);
  if (ours === theirs) return "";
  return theirs ? `в таблице оплачено ${contractMoney(theirs)}` : "в таблице оплаты нет";
}

/** Платежи договора: дата, сумма, кто, куда легли. */
function PaymentsList({ money }: { money: ContractMoney }) {
  const [open, setOpen] = useState(false);
  const where = new Map<string, string[]>();
  const add = (key: string, text: string) => where.set(key, [...(where.get(key) ?? []), text]);
  if (money.opening) for (const part of money.opening.parts) add(part.key, "сальдо");
  for (const bucket of money.months) for (const part of bucket.parts) add(part.key, formatMonth(bucket.month, true));
  for (const part of money.over) add(part.key, "сверх начислений");
  const shown = open ? money.payments : money.payments.slice(0, 3);
  return (
    <div className="acc-payments">
      <p className="fin-label">Оплаты · {money.payments.length}</p>
      {shown.map((payment) => (
        <div key={payment.key} className="acc-payment">
          <span className="fin-mono">{formatDay(payment.paid_at)}</span>
          <span className="acc-payment-sum">{contractMoney(payment.amount)}</span>
          <span className="acc-payment-who">
            {[payment.payer, payment.account].filter(Boolean).join(" · ")}
            {payment.comment ? <small>{payment.comment}</small> : null}
          </span>
          <span className="acc-payment-where">{(where.get(payment.key) ?? []).join(", ")}</span>
        </div>
      ))}
      {money.payments.length > 3 ? (
        <button type="button" className="fin-link-btn" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "Свернуть" : `Все оплаты · ${money.payments.length}`}
        </button>
      ) : null}
    </div>
  );
}

/** АВР месяца из выбранного источника; прошлый начисленный месяц без АВР - «АВР нет». */
function ActLine({ act, accrued, past }: { act: MonthAct | undefined; accrued: boolean; past: boolean }) {
  if (act?.act) {
    const also = act.sources.filter((source) => source !== act.act?.source).map((source) => ACT_IN[source]);
    return (
      <span className="acc-act">
        {actText(act.act)} · {ACT_SOURCE[act.act.source]}
        {also.length ? ` · ещё ${also.join(" и ")}` : ""}
      </span>
    );
  }
  return accrued && past ? <span className="acc-act">АВР нет</span> : null;
}

/** Книга за месяц: счёт, оплата и, без АВР ядра, АВР - то, что по месяцу уже сделано. */
function BookCell({ book, withAct = true }: { book: BookMonthOut | null; withAct?: boolean }) {
  if (!book) return <span className="acc-book fin-muted">в таблице нет</span>;
  const parts = [
    book.bill_no ? `счёт ${book.bill_no}${book.bill_date ? ` от ${formatDay(book.bill_date)}` : ""}` : "",
    book.paid && Number(book.paid) ? `оплачено ${contractMoney(book.paid)}` : "",
    withAct && book.act_no ? `АВР ${book.act_no}${book.accepted === "yes" ? ", принят" : ""}` : "",
  ].filter(Boolean);
  return <span className="acc-book">{parts.length ? parts.join(" · ") : <span className="fin-muted">в таблице {book.amount ? contractMoney(book.amount) : "-"}</span>}</span>;
}

function RemoveAdjustment({ contractId, documentId, onDone }: { contractId: string; documentId: string; onDone: (text: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <>
      <button
        type="button"
        className="fin-link-btn"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            await coreApi.removeAdjustment(contractId, documentId);
            onDone("Поправка убрана - месяц снова по договору");
          } catch (exc) {
            setError(messageOf(exc, "Поправка не убралась"));
          } finally {
            setBusy(false);
          }
        }}
      >
        Убрать поправку
      </button>
      {error ? <span className="shadow-error">{error}</span> : null}
    </>
  );
}

function AdjustmentForm({
  contractId,
  month,
  initial,
  onDone,
  onCancel,
}: {
  contractId: string;
  month: string;
  initial: string;
  onDone: (text: string) => void;
  onCancel: () => void;
}) {
  const [amount, setAmount] = useState(initial ? String(Number(initial)) : "");
  const [skip, setSkip] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await coreApi.setAdjustment(contractId, { month, amount: skip ? null : amount, skip, reason });
      onDone(`Поправка за ${formatMonth(month)} записана`);
    } catch (exc) {
      setError(messageOf(exc, "Поправка не записалась"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="party-form acc-form"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <input
        className="input-field acc-form-amount"
        value={amount}
        disabled={skip}
        inputMode="decimal"
        placeholder="сумма месяца"
        aria-label="Сумма месяца"
        onChange={(event) => setAmount(event.target.value)}
      />
      <label className="party-check">
        <input type="checkbox" checked={skip} onChange={(event) => setSkip(event.target.checked)} />
        не начислять
      </label>
      <input
        className="input-field"
        value={reason}
        autoFocus
        placeholder="причина"
        aria-label="Причина поправки"
        onChange={(event) => setReason(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
      />
      <span className="party-form-acts">
        <button type="submit" className="btn-ghost btn-sm" disabled={busy || !reason.trim() || (!skip && !amount.trim())}>
          {busy ? "Записываем…" : "Записать"}
        </button>
        <button type="button" className="fin-link-btn" onClick={onCancel}>
          Отмена
        </button>
      </span>
      {error ? <p className="ifield-error party-form-error">{error}</p> : null}
    </form>
  );
}
