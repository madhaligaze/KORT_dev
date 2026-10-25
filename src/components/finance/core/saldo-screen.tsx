"use client";

/**
 * «Сверка → Сальдо» - сальдо KORT на конец месяца против «Сальдо Конец»
 * сводной таблицы (ядро, фаза 6).
 *
 * По начислениям: входящее сальдо, начислено и оплачено до месяца
 * включительно - против «Сальдо Конец (без АВР)»; по АВР - то же с АВР вместо
 * начислений против «Сальдо Конец (АВР)». Оплата - в месяце, к которому её
 * отнесло разнесение, как её держит таблица. Расходится - договор с первым
 * месяцем расхождения и разницей на последний месяц.
 */
import { useEffect, useState } from "react";

import { type DebtBasis, type SaldoShadow, coreApi, formatMonth } from "@/components/finance/api";
import { bareNumber, contractMoney, formatTime, plural } from "@/components/finance/format";
import { useSessionState } from "@/components/session-state";

function messageOf(exc: unknown, fallback: string): string {
  return exc instanceof Error && exc.message ? exc.message : fallback;
}

function money(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "-";
  return contractMoney(value);
}

export function SaldoShadowView({ onOpen, closed }: { onOpen: (id: string | null) => void; closed: number }) {
  const [basis, setBasis] = useSessionState<DebtBasis>("core.shadow.saldo.basis", "accruals");
  const [data, setData] = useState<SaldoShadow | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const asked = `${basis}|${revision}|${closed}`;
  const [answered, setAnswered] = useState("");
  const loading = answered !== asked;
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    coreApi
      .debtsShadow(basis)
      .then((next) => {
        if (!alive) return;
        setData(next);
        setError(next.error);
      })
      .catch((exc) => alive && setError(messageOf(exc, "Сальдо не сверилось")))
      .finally(() => alive && setAnswered(asked));
    return () => {
      alive = false;
    };
  }, [basis, revision, closed, asked]);
  const counts = data?.counts ?? {};
  return (
    <>
      <div className="shadow-bar">
        <span className="fin-mine" role="group" aria-label="Какое сальдо">
          {(
            [
              ["accruals", "Без АВР"],
              ["acts", "По АВР"],
            ] as [DebtBasis, string][]
          ).map(([key, title]) => (
            <button key={key} type="button" className="fin-chip" data-on={basis === key ? "" : undefined} onClick={() => setBasis(key)}>
              {title}
            </button>
          ))}
        </span>
        <p className="shadow-source">
          {data?.book
            ? `${data.book.title || "Сводная таблица"} · прочитана в ${formatTime(data.book.read_at)}${
                data.window.length ? ` · ${formatMonth(data.window[0])} - ${formatMonth(data.window[data.window.length - 1])}` : ""
              }`
            : loading
              ? "Читаем сводную таблицу…"
              : ""}
        </p>
        <button type="button" className="btn-ghost btn-sm" disabled={loading} onClick={() => setRevision((value) => value + 1)}>
          {loading ? "Сверяем…" : "Сверить заново"}
        </button>
      </div>
      <div className="fin-kpis">
        <div className="fin-kpi">
          <span className="fin-kpi-label">Совпадает</span>
          <span className="fin-kpi-value">{data ? `${counts.same ?? 0} из ${counts.contracts ?? 0}` : "-"}</span>
          <span className="fin-kpi-label">{data ? `месяцев ${counts.months_same ?? 0} из ${counts.months ?? 0}` : "договоров"}</span>
        </div>
        <div className="fin-kpi">
          <span className="fin-kpi-label">Расходится</span>
          <span className="fin-kpi-value">{data ? data.lines.length : "-"}</span>
          <span className="fin-kpi-label">договоров</span>
        </div>
      </div>
      {error ? <p className="party-error">{error}</p> : null}
      {!data ? (
        <p className="creg-empty">{loading ? "Сверяем сальдо с таблицей…" : ""}</p>
      ) : !data.lines.length ? (
        <p className="creg-empty">{data.book ? "Сальдо KORT и таблицы совпадают" : ""}</p>
      ) : (
        <div className="fin-card overflow-x-auto">
          <table className="fin-table shadow-table paid-table">
            <thead>
              <tr>
                <th>Договор</th>
                <th>С какого месяца</th>
                <th style={{ textAlign: "right" }}>Разница</th>
                <th>Месяцы</th>
              </tr>
            </thead>
            <tbody>
              {data.lines.map((line) => {
                const contract = data.contracts[line.contract_id];
                const differ = line.months.filter((month) => !month.same).length;
                const shown = open === line.contract_id;
                return (
                  <tr key={line.contract_id}>
                    <td>
                      <span className="shadow-contract">
                        <button type="button" className="fin-link-btn creg-num" onClick={() => onOpen(line.contract_id)}>
                          {bareNumber(contract?.number) || "без номера"}
                        </button>
                        <span className="shadow-client">{contract?.customer || "-"}</span>
                        {contract?.executor ? <span className="annot">{contract.executor}</span> : null}
                      </span>
                    </td>
                    <td className="fin-bills-date">{formatMonth(line.first)}</td>
                    <td className={`fin-num${Number(line.diff) ? " fin-out" : ""}`}>{Number(line.diff) ? money(line.diff) : "-"}</td>
                    <td>
                      <button type="button" className="fin-link-btn" aria-expanded={shown} onClick={() => setOpen(shown ? null : line.contract_id)}>
                        {`${differ} ${plural(differ, "месяц", "месяца", "месяцев")} врозь`}
                      </button>
                      {shown ? (
                        <div className="paid-months">
                          <div className="paid-month paid-month-head">
                            <span>Месяц</span>
                            <span className="fin-num">KORT</span>
                            <span className="fin-num">Таблица</span>
                            <span />
                          </div>
                          {line.months.map((month) => (
                            <div key={month.month} className="paid-month" data-off={month.same ? undefined : "true"}>
                              <span>{formatMonth(month.month, true)}</span>
                              <span className="fin-num">{money(month.kort)}</span>
                              <span className="fin-num">{money(month.book)}</span>
                              <span className="paid-month-code">{month.same ? "" : "врозь"}</span>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
