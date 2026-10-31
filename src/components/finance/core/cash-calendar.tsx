"use client";

/**
 * «Деньги вперёд» - платёжный календарь ядра (`core/cash_calendar.py`) на экране.
 *
 * До этапа 3 у календаря был только вызов «спросить» (`source: calendar`), а в
 * колонке стоял календарь журнала денег - другой расчёт. Здесь - ответ ядра
 * как он есть: разрывы с подсказками, что сделать, и день за днём - пришло,
 * ушло, остаток. Юрлицо выбирается над списком; вся группа - сумма юрлиц.
 */
import { useEffect, useMemo, useState } from "react";

import { formatDate, modelApi } from "@/components/finance/api";
import { contractMoney } from "@/components/finance/format";

type Board = {
  opening: (string | null)[];
  closing: (string | null)[];
  fact_in: (string | null)[];
  fact_out: (string | null)[];
  lines: { key: string; values: (string | null)[]; no_date: string | null; later: string | null }[];
};

type CalendarAnswer = {
  from: string;
  to: string;
  today: string;
  scenario_title: string;
  days: string[];
  days_off: string[];
  lines: { key: string; title: string; direction: "in" | "out"; included: boolean }[];
  entities: ({ id: string; title: string } & Board)[];
  total: Board;
  gaps: {
    entity: string;
    entity_title: string;
    day: string;
    deficit: string;
    low: string;
    low_day: string;
    back: string | null;
    hints: { kind: string; text: string }[];
  }[];
  promises: { kept: number; broken: number; broken_amount: string | null; promised_amount: string | null };
  notes: string[];
  book_error?: string;
};

function money(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  const number = Math.round(Number(value));
  return number ? contractMoney(number) : "";
}

const WEEKDAY = new Intl.DateTimeFormat("ru-RU", { weekday: "short" });

export function CashCalendarScreen() {
  const [answer, setAnswer] = useState<CalendarAnswer | null>(null);
  const [error, setError] = useState("");
  const [entity, setEntity] = useState("");
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    modelApi
      .ask<CalendarAnswer>({ source: "calendar" }, { signal: controller.signal })
      .then((value) => {
        setAnswer(value);
        setError("");
      })
      .catch((exc) => !controller.signal.aborted && setError(exc instanceof Error ? exc.message : "Календарь не посчитался"));
    return () => controller.abort();
  }, [revision]);

  const board: Board | null = useMemo(() => {
    if (!answer) return null;
    return entity ? (answer.entities.find((item) => item.id === entity) ?? answer.total) : answer.total;
  }, [answer, entity]);

  if (error) return <p className="home-refusal">{error}</p>;
  if (!answer || !board) return <p className="today-loading">Считаем деньги вперёд…</p>;

  const titles = new Map(answer.lines.map((line) => [line.key, line]));
  const off = new Set(answer.days_off);
  const sumOf = (index: number, direction: "in" | "out") =>
    board.lines.reduce((total, line) => {
      const meta = titles.get(line.key);
      if (!meta || meta.direction !== direction || !meta.included) return total;
      return total + Number(line.values[index] ?? 0);
    }, 0);
  const gaps = entity ? answer.gaps.filter((gap) => gap.entity === entity) : answer.gaps;
  const undated = board.lines.filter((line) => line.no_date && Number(line.no_date));

  return (
    <div className="cal-screen">
      <div className="today-head">
        <p className="today-date">
          {formatDate(answer.from)} - {formatDate(answer.to)} · {answer.scenario_title}
        </p>
        <div className="cal-tools">
          <select className="input-field cal-entity" value={entity} onChange={(event) => setEntity(event.target.value)} aria-label="Юрлицо">
            <option value="">Вся группа</option>
            {answer.entities.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
          <button type="button" className="btn-ghost btn-sm" onClick={() => setRevision((value) => value + 1)}>
            Пересчитать
          </button>
        </div>
      </div>
      {answer.book_error ? <p className="today-note">{answer.book_error}</p> : null}

      <section className="cal-gaps" aria-labelledby="cal-gaps-head">
        <h2 id="cal-gaps-head" className="home-head">
          Разрывы
        </h2>
        {!gaps.length ? <p className="home-calm">В окне календаря денег хватает</p> : null}
        {gaps.map((gap) => (
          <article key={`${gap.entity}-${gap.day}`} className="home-q">
            <header className="home-q-head">
              <span className="home-q-title">
                {gap.entity_title}: с {formatDate(gap.day)} не хватит {money(gap.deficit)}
              </span>
              <span className="fin-soft">{gap.back ? `до ${formatDate(gap.back)}` : "до конца окна"}</span>
            </header>
            {gap.hints.length ? (
              <ul className="cal-hints">
                {gap.hints.map((hint) => (
                  <li key={hint.text}>{hint.text}</li>
                ))}
              </ul>
            ) : null}
          </article>
        ))}
      </section>

      <section aria-labelledby="cal-days-head">
        <h2 id="cal-days-head" className="home-head">
          День за днём
        </h2>
        <div className="cal-scroll">
          <table className="cal-table">
            <thead>
              <tr>
                <th>день</th>
                <th className="num">пришло</th>
                <th className="num">ушло</th>
                <th className="num">остаток вечером</th>
              </tr>
            </thead>
            <tbody>
              {answer.days.map((day, index) => {
                const income = sumOf(index, "in") + Number(board.fact_in[index] ?? 0);
                const outgo = sumOf(index, "out") + Number(board.fact_out[index] ?? 0);
                const closing = Number(board.closing[index] ?? 0);
                const isToday = day === answer.today;
                return (
                  <tr key={day} data-off={off.has(day) ? "true" : undefined} data-today={isToday ? "true" : undefined}>
                    <td>
                      {formatDate(day)} <span className="fin-soft">{WEEKDAY.format(new Date(`${day}T00:00:00`))}</span>
                      {isToday ? <span className="cal-today"> сегодня</span> : null}
                    </td>
                    <td className="num">{income ? <span className="fin-in">{money(String(income))}</span> : ""}</td>
                    <td className="num">{outgo ? money(String(outgo)) : ""}</td>
                    <td className="num" data-low={closing < 0 ? "true" : undefined}>
                      {money(String(closing)) || "0"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {undated.length ? (
        <section aria-labelledby="cal-undated-head">
          <h2 id="cal-undated-head" className="home-head">
            Без даты
          </h2>
          <ul className="today-lines">
            {undated.map((line) => (
              <li key={line.key} className="today-line">
                <span className="today-line-label">{titles.get(line.key)?.title ?? line.key}</span>
                <span className="fin-num">{money(line.no_date)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {answer.notes.length ? (
        <ul className="cal-hints">
          {answer.notes.map((note) => (
            <li key={note} className="fin-soft">
              {note}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
