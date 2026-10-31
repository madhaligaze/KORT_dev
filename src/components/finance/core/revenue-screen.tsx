"use client";

/**
 * «Прибыль» и «Деньги» по договорам (ядро, фаза 6) - виды тех же итогов, что
 * «Долги».
 *
 * Отчёты журнала считают доходы по дате начисления операции и по дню платежа.
 * Здесь то же - из того, что KORT знает о договорах: начислено по условиям
 * (будущие месяцы - прогноз), АВР месяца, оплачено за месяц (как его держит
 * сводная таблица) и поступило по дню платежа - по юрлицам, клиентам, отделам
 * и сотрудникам по долям. Договоры между своими - отдельно: в выручку группы
 * они не входят.
 */
import { type ReactNode, useEffect, useState } from "react";

import {
  type Me,
  type RevenueCell,
  type RevenueGroup,
  type RevenueMeasure,
  type RevenueView,
  coreApi,
  formatMonth,
} from "@/components/finance/api";
import { can } from "@/components/finance/access";
import { contractMoney, formatDay, formatTime, plural } from "@/components/finance/format";
import { useSessionState } from "@/components/session-state";

const MEASURES: [RevenueMeasure, string][] = [
  ["accrued", "Начислено"],
  ["acts", "АВР"],
  ["paid", "Оплачено за месяц"],
  ["received", "Поступило"],
];

const GROUPS: [RevenueGroup, string][] = [
  ["entity", "Юрлица"],
  ["client", "Клиенты"],
  ["department", "Отделы"],
  ["person", "Сотрудники"],
];

const MONTHS_FROM = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

/** «с ноября 2026» - начало прогноза фразой. */
function monthFrom(key: string): string {
  const index = Number(key.slice(5, 7)) - 1;
  return MONTHS_FROM[index] ? `с ${MONTHS_FROM[index]} ${key.slice(0, 4)}` : `с ${key}`;
}

function messageOf(exc: unknown, fallback: string): string {
  return exc instanceof Error && exc.message ? exc.message : fallback;
}

/** Выручка - до тенге: копейки оплат в итогах года только мешают читать. */
function money(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "" || !Math.round(Number(value))) return "-";
  return contractMoney(Math.round(Number(value)));
}

/** «По журналу · По договорам» - в «Прибыли» и в «Деньгах»; своя мера по умолчанию у каждого. */
export function RevenueSection({
  me,
  section,
  measure,
  journal,
}: {
  me: Me;
  section: "profit" | "cash";
  measure: RevenueMeasure;
  journal?: ReactNode;
}) {
  const [view, setView] = useSessionState<"journal" | "contracts">(`core.revenue.${section}.view`, "journal");
  if (!can(me, "contracts", "view")) return <>{journal ?? <p className="creg-empty">Договоры вам не открыты</p>}</>;
  // Журнал денег снят 31.10.2026: выручка - по договорам, без чипа «По журналу».
  if (!journal) return <RevenueScreen section={section} measure={measure} />;
  return (
    <div className="revenue-screen">
      <nav className="fin-mine shadow-what" aria-label="Откуда числа">
        {(
          [
            ["journal", "По журналу"],
            ["contracts", "По договорам"],
          ] as ["journal" | "contracts", string][]
        ).map(([key, title]) => (
          <button key={key} type="button" className="fin-chip" data-on={view === key ? "" : undefined} onClick={() => setView(key)}>
            {title}
          </button>
        ))}
      </nav>
      {view === "contracts" ? <RevenueScreen section={section} measure={measure} /> : journal}
    </div>
  );
}

function RevenueScreen({ section, measure: initial }: { section: "profit" | "cash"; measure: RevenueMeasure }) {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useSessionState(`core.revenue.${section}.year`, thisYear);
  const [measure, setMeasure] = useSessionState<RevenueMeasure>(`core.revenue.${section}.measure`, initial);
  const [group, setGroup] = useSessionState<RevenueGroup>(`core.revenue.${section}.group`, "entity");
  const [side, setSide] = useSessionState<RevenueView["side"]>(`core.revenue.${section}.side`, "receivable");
  const [data, setData] = useState<RevenueView | null>(null);
  const [error, setError] = useState("");
  const asked = `${year}|${group}|${side}`;
  const [answered, setAnswered] = useState("");
  const loading = answered !== asked;

  useEffect(() => {
    const controller = new AbortController();
    coreApi
      .revenue({ year, group, side }, { signal: controller.signal })
      .then((next) => {
        setData(next);
        setError(next.error);
      })
      .catch((exc) => {
        if (controller.signal.aborted) return;
        setData(null);
        setError(messageOf(exc, "Выручка не посчиталась"));
      })
      .finally(() => {
        if (!controller.signal.aborted) setAnswered(asked);
      });
    return () => controller.abort();
  }, [year, group, side, asked]);

  const total = (cell: RevenueCell | undefined) => cell?.[measure] ?? null;
  const forecast = (month: string) => measure === "accrued" && data?.forecast_from !== null && data?.forecast_from !== undefined && month >= data.forecast_from;
  const totals = data?.totals.total;
  return (
    <div className="revenue-body">
      <div className="debts-bar">
        <span className="fin-mine" role="group" aria-label="Год">
          {[thisYear - 1, thisYear].map((item) => (
            <button key={item} type="button" className="fin-chip" data-on={year === item ? "" : undefined} onClick={() => setYear(item)}>
              {item}
            </button>
          ))}
        </span>
        <span className="fin-mine" role="group" aria-label="Чьи договоры">
          {(
            [
              ["receivable", "Клиентам"],
              ["intra", "Между своими"],
            ] as [RevenueView["side"], string][]
          ).map(([key, title]) => (
            <button key={key} type="button" className="fin-chip" data-on={side === key ? "" : undefined} onClick={() => setSide(key)}>
              {title}
            </button>
          ))}
        </span>
        <span className="fin-mine" role="group" aria-label="По чему">
          {GROUPS.map(([key, title]) => (
            <button key={key} type="button" className="fin-chip" data-on={group === key ? "" : undefined} onClick={() => setGroup(key)}>
              {title}
            </button>
          ))}
        </span>
      </div>

      <div className="fin-kpis revenue-kpis">
        {MEASURES.map(([key, title]) => (
          <button
            key={key}
            type="button"
            className="fin-kpi fin-kpi-pick"
            data-on={measure === key ? "" : undefined}
            onClick={() => setMeasure(key)}
          >
            <span className="fin-kpi-label">{title}</span>
            <span className="fin-kpi-value">{totals ? money(totals[key]) : "-"}</span>
            <span className="fin-kpi-label">
              {key === "accrued" && data?.forecast_from ? `${monthFrom(data.forecast_from)} - прогноз` : `за ${year}`}
            </span>
          </button>
        ))}
      </div>

      <p className="debts-source">
        {data
          ? [
              data.since ? `оплаты в KORT с ${formatDay(data.since)}, раньше - пусто` : "оплат в KORT ещё нет",
              data.book ? `АВР: KORT, 1С и сводная таблица (прочитана в ${formatTime(data.book.read_at)})` : "",
              `${data.rows.reduce((sum, row) => sum + row.contracts, 0)} ${plural(
                data.rows.reduce((sum, row) => sum + row.contracts, 0),
                "договор",
                "договора",
                "договоров",
              )} в строках`,
            ]
              .filter(Boolean)
              .join(" · ")
          : loading
            ? "Считаем выручку…"
            : ""}
        {data && loading ? " · пересчитываем…" : ""}
      </p>
      {error ? <p className="party-error">{error}</p> : null}

      {!data ? (
        <p className="creg-empty">{loading ? "Считаем выручку…" : ""}</p>
      ) : !data.rows.length ? (
        <p className="creg-empty">За {year} год по договорам ничего нет</p>
      ) : (
        <div className="fin-card overflow-x-auto revenue-scroll" aria-busy={loading}>
          <table className="fin-table revenue-table">
            <thead>
              <tr>
                <th>{GROUPS.find(([key]) => key === group)?.[1]}</th>
                {data.months.map((month) => (
                  <th key={month} className="fin-num" data-plan={forecast(month) ? "" : undefined}>
                    {formatMonth(month, true)}
                  </th>
                ))}
                <th className="fin-num">Итого</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.key} data-special={row.special ? "" : undefined}>
                  <th scope="row">
                    <span className="revenue-title">{row.title}</span>
                    <span className="debts-count">
                      {row.contracts} {plural(row.contracts, "договор", "договора", "договоров")}
                    </span>
                  </th>
                  {data.months.map((month) => (
                    <td key={month} className="fin-num" data-plan={forecast(month) ? "" : undefined}>
                      {money(total(row.months[month]))}
                    </td>
                  ))}
                  <td className="fin-num revenue-total">{money(total(row.total))}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Итого</th>
                {data.months.map((month) => (
                  <td key={month} className="fin-num" data-plan={forecast(month) ? "" : undefined}>
                    {money(total(data.totals.months[month]))}
                  </td>
                ))}
                <td className="fin-num revenue-total">{money(total(data.totals.total))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
