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
 */
import { useContext, useEffect, useState } from "react";

import {
  type AccrualOut,
  type BookMonthOut,
  type ContractMonths,
  type ShadowCode,
  FinanceApiError,
  coreApi,
  formatMonth,
} from "@/components/finance/api";
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
      return `в книге ${book?.amount ? contractMoney(book.amount) : "пусто"}`;
    case "period":
      return `в книге с ${book?.period_from ? formatDay(book.period_from).slice(0, 5) : "-"}`;
    case "executor":
      return `в книге ${book?.code || "другое юрлицо"}`;
    case "no_kort":
      return "в книге есть, по договору нет";
    case "no_book":
      return "в книге нет";
  }
}

function amountText(accrual: AccrualOut): string {
  if (accrual.skipped) return "не начислять";
  return accrual.amount ? contractMoney(accrual.amount) : "-";
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
  return (
    <Section title="Начисления" end={summary ? <span className="fin-muted">{summary}</span> : null}>
      {schedule.why ? <p className="acc-why">{schedule.why}</p> : null}
      {periodField || fromField ? (
        <div className="card-grid acc-terms">
          {periodField ? <InlineField contractId={contractId} field={periodField} /> : null}
          {fromField ? <InlineField contractId={contractId} field={fromField} /> : null}
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
        <div className="acc-list" role="list">
          {value.months.map((row) => (
            <div key={row.month} role="listitem">
              <div className="acc-row" data-off={row.codes.length ? "true" : undefined}>
                <span className="acc-month">
                  {formatMonth(row.month)}
                  <small>{row.kort ? span(row.kort.period_from, row.kort.period_to) : row.book ? span(row.book.period_from, row.book.period_to) : ""}</small>
                </span>
                <span className="acc-amount">
                  {row.kort ? amountText(row.kort) : <span className="fin-muted">-</span>}
                  {row.kort?.adjustment ? <small>поправка: {row.kort.adjustment.reason}</small> : null}
                  {row.paused ? <small>приостановлен</small> : null}
                </span>
                {value.book ? <BookCell book={row.book} /> : null}
                <span className="acc-codes">{row.codes.map((code) => codeText(code, row.book)).join(" · ")}</span>
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
          ))}
        </div>
      ) : (
        <p className="party-none">Начислений в эти месяцы нет</p>
      )}
    </Section>
  );
}

/** Книга за месяц: счёт, оплата, АВР - то, что по месяцу уже сделано. */
function BookCell({ book }: { book: BookMonthOut | null }) {
  if (!book) return <span className="acc-book fin-muted">в книге нет</span>;
  const parts = [
    book.bill_no ? `счёт ${book.bill_no}${book.bill_date ? ` от ${formatDay(book.bill_date)}` : ""}` : "",
    book.paid && Number(book.paid) ? `оплачено ${contractMoney(book.paid)}` : "",
    book.act_no ? `АВР ${book.act_no}${book.accepted === "yes" ? ", принят" : ""}` : "",
  ].filter(Boolean);
  return <span className="acc-book">{parts.length ? parts.join(" · ") : <span className="fin-muted">в книге {book.amount ? contractMoney(book.amount) : "-"}</span>}</span>;
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
