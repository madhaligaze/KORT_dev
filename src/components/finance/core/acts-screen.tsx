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

import { type ActOut, type ActsView, coreApi, formatMonth } from "@/components/finance/api";
import { bareNumber, contractMoney, formatDay, formatTime, plural } from "@/components/finance/format";
import { useSessionState } from "@/components/session-state";

type View = "lines" | "unsigned" | "no_esf" | "missing";

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
}: {
  onOpen: (id: string | null) => void;
  closed: number;
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
      <div className="shadow-bar">
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
        <div className="fin-kpi">
          <span className="fin-kpi-label">1С и таблица совпадают</span>
          <span className="fin-kpi-value">{data ? `${counts.same ?? 0} из ${counts.months ?? 0}` : "-"}</span>
          <span className="fin-kpi-label">месяцев договоров</span>
        </div>
        {(
          [
            ["lines", "Расходится", data?.lines.length, "месяцев"],
            ["unsigned", "Не подписаны", data?.unsigned.length, "АВР"],
            ["no_esf", "Без ЭСФ", data?.no_esf.length, `дольше ${data?.esf_days ?? 15} дней`],
            ["missing", "Нет АВР", data?.missing.length, "начислено, АВР нет"],
          ] as [View, string, number | undefined, string][]
        ).map(([key, title, value, unit]) => (
          <button key={key} type="button" className="fin-kpi fin-kpi-pick" data-on={view === key ? "" : undefined} onClick={() => setView(key)}>
            <span className="fin-kpi-label">{title}</span>
            <span className="fin-kpi-value">{value ?? "-"}</span>
            <span className="fin-kpi-label">{unit}</span>
          </button>
        ))}
      </div>
      {error ? <p className="party-error">{error}</p> : null}
      {!data ? (
        <p className="creg-empty">{loading ? "Сверяем акты…" : ""}</p>
      ) : view === "lines" ? (
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
      ) : view === "missing" ? (
        data.missing.length ? (
          <div className="acts-list" role="list">
            {data.missing.map((item) => (
              <div key={`${item.contract_id}-${item.month}`} className="acts-item" role="listitem">
                {cell(item.contract_id)}
                <span className="fin-bills-date">{formatMonth(item.month)}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="creg-empty">У каждого начисленного месяца есть АВР</p>
        )
      ) : (
        <ActList
          items={view === "unsigned" ? data.unsigned : data.no_esf}
          empty={view === "unsigned" ? "Все АВР подписаны" : "ЭСФ выписаны в срок"}
          days={(days) =>
            view === "unsigned" ? `${days} ${plural(days, "день", "дня", "дней")} без подписи` : `срок ЭСФ прошёл ${days} ${plural(days, "день", "дня", "дней")} назад`
          }
          cell={cell}
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
}: {
  items: { contract_id: string; act: ActOut; days: number }[];
  empty: string;
  days: (count: number) => string;
  cell: (id: string) => React.ReactNode;
}) {
  if (!items.length) return <p className="creg-empty">{empty}</p>;
  return (
    <div className="acts-list" role="list">
      {items.map((item) => (
        <div key={`${item.contract_id}-${item.act.month}`} className="acts-item" role="listitem">
          {cell(item.contract_id)}
          <span className="acts-text">
            {actText(item.act)}
            <span className="fin-bills-note">
              {formatMonth(item.act.month)} · {SOURCE[item.act.source]} · {days(item.days)}
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}
