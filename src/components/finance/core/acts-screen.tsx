"use client";

/**
 * «Сверка → Акты» - АВР и ЭСФ по договорам и месяцам (ядро, фаза 5).
 *
 * Один АВР на договор и месяц - по приоритету источника: KORT, 1С, книга.
 * Где база 1С юрлица подключена, её АВР сверяются с книгой: есть в одном и
 * нет в другом, сумма, подписание, ЭСФ. Ниже - то, что надо сделать: АВР не
 * подписан клиентом, ЭСФ не выписан после срока, месяц начислен, а АВР нет.
 */
import { useEffect, useState } from "react";

import { type ActOut, type ActsView, type MonthDocKind, coreApi, formatMonth } from "@/components/finance/api";
import { bareNumber, contractMoney, formatDay, formatTime, plural } from "@/components/finance/format";
import { DocForm } from "@/components/finance/core/accruals";
import { useSessionState } from "@/components/session-state";

type View = "lines" | "unsigned" | "no_esf" | "missing";

function isoDay(): string {
  const day = new Date();
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
}

const SOURCE: Record<ActOut["source"], string> = { kort: "KORT", "1c": "1С", book: "таблица" };

function messageOf(exc: unknown, fallback: string): string {
  return exc instanceof Error && exc.message ? exc.message : fallback;
}

/** «АВР 457 от 02.07.2026 · подписан 09.07 · ЭСФ 03.07» - одной строкой. */
export function actText(act: ActOut): string {
  return [
    `АВР ${act.number || "без номера"}${act.date ? ` от ${formatDay(act.date)}` : ""}`,
    act.amount ? contractMoney(act.amount) : "",
    act.signed ? `подписан ${formatDay(act.signed)}` : act.accepted ? "принят" : "не подписан",
    act.esf ? `ЭСФ ${formatDay(act.esf)}` : act.esf_sent ? "ЭСФ отправлен" : "без ЭСФ",
  ]
    .filter(Boolean)
    .join(" · ");
}

export function ActsShadow({
  onOpen,
  closed,
  entity = "",
  noTable = false,
}: {
  onOpen: (id: string | null) => void;
  closed: number;
  /** Сводной таблицы нет: сверять 1С не с чем, остаётся работа по АВР и ЭСФ. */
  noTable?: boolean;
  /** Одно наше юрлицо: сверка 1С - его месяцы, списки - его договоры. */
  entity?: string;
}) {
  const [view, setView] = useSessionState<View>("core.shadow.acts.view", "lines");
  const [data, setData] = useState<ActsView | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const asked = `${revision}|${closed}|${entity}`;
  const [loaded, setLoaded] = useState("");
  const loading = loaded !== asked;
  useEffect(() => {
    let alive = true;
    coreApi
      .acts(entity)
      .then((next) => {
        if (!alive) return;
        setData(next);
        setError(next.error);
      })
      .catch((exc) => alive && setError(messageOf(exc, "Акты не сверились")))
      .finally(() => alive && setLoaded(asked));
    return () => {
      alive = false;
    };
  }, [asked, entity]);
  const counts = data?.counts ?? {};
  const shownView: View = noTable && view === "lines" ? "missing" : view;
  // Строка, для которой открыта запись документа: действие здесь, а не «откройте договор».
  const [writing, setWriting] = useState<{ contract: string; month: string; kind: MonthDocKind; act?: ActOut } | null>(null);
  const written = () => {
    setWriting(null);
    setRevision((value) => value + 1);
  };
  const form = (id: string, month: string) =>
    writing?.contract === id && writing.month === month ? (
      <DocForm
        key={writing.kind}
        contractId={id}
        month={month}
        kind={writing.kind}
        doc={writing.act ? { number: writing.act.number, day: writing.act.date, signed: writing.act.signed ?? isoDay() } : undefined}
        onDone={written}
        onCancel={() => setWriting(null)}
      />
    ) : null;
  const contract = (id: string) => data?.contracts[id];
  const cell = (id: string) => (
    <span className="shadow-contract">
      <button type="button" className="fin-link-btn creg-num" onClick={() => onOpen(id)}>
        {bareNumber(contract(id)?.number) || "без номера"}
      </button>
      <span className="shadow-client">{contract(id)?.customer || "-"}</span>
      {contract(id)?.executor ? <span className="annot">{contract(id)?.executor}</span> : null}
    </span>
  );
  return (
    <>
      <div className="shadow-bar" hidden={noTable}>
        <p className="shadow-source">
          {data?.book
            ? `${data.book.title || "Сводная таблица"} · прочитана в ${formatTime(data.book.read_at)}${
                data.window.length ? ` · ${formatMonth(data.window[0])} - ${formatMonth(data.window[data.window.length - 1])}` : ""
              }`
            : loading
              ? "Читаем сводную таблицу…"
              : ""}
          {data ? ` · 1С: ${data.onec.length ? data.onec.map((item) => item.code || item.name).join(", ") : "не подключена"}` : ""}
        </p>
        <button type="button" className="btn-ghost btn-sm" disabled={loading} onClick={() => setRevision((value) => value + 1)}>
          {loading ? "Сверяем…" : "Сверить заново"}
        </button>
      </div>
      <div className="fin-kpis">
        {noTable ? null : (
          <div className="fin-kpi">
            <span className="fin-kpi-label">1С и таблица совпадают</span>
            <span className="fin-kpi-value">{data ? `${counts.same ?? 0} из ${counts.months ?? 0}` : "-"}</span>
            <span className="fin-kpi-label">месяцев договоров</span>
          </div>
        )}
        {(
          [
            ["missing", "Нет АВР", data?.missing.length, "начислено, АВР нет"],
            ["unsigned", "Не подписаны", data?.unsigned.length, "АВР"],
            ["no_esf", "Без ЭСФ", data?.no_esf.length, `дольше ${data?.esf_days ?? 15} дней`],
            ...(noTable ? [] : ([["lines", "Расходится", data?.lines.length, "месяцев"]] as const)),
          ] as [View, string, number | undefined, string][]
        ).map(([key, title, value, unit]) => (
          <button key={key} type="button" className="fin-kpi fin-kpi-pick" data-on={shownView === key ? "" : undefined} onClick={() => setView(key)}>
            <span className="fin-kpi-label">{title}</span>
            <span className="fin-kpi-value">{value ?? "-"}</span>
            <span className="fin-kpi-label">{unit}</span>
          </button>
        ))}
      </div>
      {error ? <p className="party-error">{error}</p> : null}
      {!data ? (
        <p className="creg-empty">{loading ? "Сверяем акты…" : ""}</p>
      ) : shownView === "lines" ? (
        data.lines.length ? (
          <div className="fin-card overflow-x-auto">
            <table className="fin-table shadow-table acts-table">
              <thead>
                <tr>
                  <th>Договор</th>
                  <th>Месяц</th>
                  <th>Чем</th>
                  <th>1С</th>
                  <th>Таблица</th>
                </tr>
              </thead>
              <tbody>
                {data.lines.map((line) => (
                  <tr key={`${line.contract_id}-${line.month}`}>
                    <td>{cell(line.contract_id)}</td>
                    <td className="fin-bills-date">{formatMonth(line.month)}</td>
                    <td className="fin-out">{line.codes.map((code) => data.codes[code]).join(", ")}</td>
                    <td>{line.onec ? actText(line.onec) : "-"}</td>
                    <td>{line.book ? actText(line.book) : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="creg-empty">{data.onec.length ? "АВР 1С и таблицы совпадают" : "1С не подключена - сверять таблицу не с чем"}</p>
        )
      ) : shownView === "missing" ? (
        data.missing.length ? (
          <div className="acts-list" role="list">
            {data.missing.map((item) => (
              <div key={`${item.contract_id}-${item.month}`} role="listitem">
                <div className="acts-item">
                  {cell(item.contract_id)}
                  <span className="fin-bills-date">{formatMonth(item.month)}</span>
                  <button type="button" className="btn-ghost btn-sm" onClick={() => setWriting({ contract: item.contract_id, month: item.month, kind: "act" })}>
                    Записать АВР
                  </button>
                </div>
                {form(item.contract_id, item.month)}
              </div>
            ))}
          </div>
        ) : (
          <p className="creg-empty">У каждого начисленного месяца есть АВР</p>
        )
      ) : (
        <ActList
          items={shownView === "unsigned" ? data.unsigned : data.no_esf}
          empty={shownView === "unsigned" ? "Все АВР подписаны" : "ЭСФ выписаны в срок"}
          days={(days) =>
            shownView === "unsigned" ? `${days} ${plural(days, "день", "дня", "дней")} без подписи` : `срок ЭСФ прошёл ${days} ${plural(days, "день", "дня", "дней")} назад`
          }
          cell={cell}
          action={(item) =>
            item.act.source === "kort" ? (
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={() =>
                  setWriting(
                    shownView === "unsigned"
                      ? { contract: item.contract_id, month: item.act.month, kind: "act", act: item.act }
                      : { contract: item.contract_id, month: item.act.month, kind: "esf" },
                  )
                }
              >
                {shownView === "unsigned" ? "Подписан" : "Записать ЭСФ"}
              </button>
            ) : null
          }
          form={form}
        />
      )}
    </>
  );
}

function ActList({
  items,
  empty,
  days,
  cell,
  action,
  form,
}: {
  items: { contract_id: string; act: ActOut; days: number }[];
  empty: string;
  days: (count: number) => string;
  cell: (id: string) => React.ReactNode;
  action: (item: { contract_id: string; act: ActOut; days: number }) => React.ReactNode;
  form: (id: string, month: string) => React.ReactNode;
}) {
  if (!items.length) return <p className="creg-empty">{empty}</p>;
  return (
    <div className="acts-list" role="list">
      {items.map((item) => (
        <div key={`${item.contract_id}-${item.act.month}`} role="listitem">
          <div className="acts-item">
            {cell(item.contract_id)}
            <span className="acts-text">
              {actText(item.act)}
              <span className="fin-bills-note">
                {formatMonth(item.act.month)} · {SOURCE[item.act.source]} · {days(item.days)}
              </span>
            </span>
            {action(item)}
          </div>
          {form(item.contract_id, item.act.month)}
        </div>
      ))}
    </div>
  );
}
