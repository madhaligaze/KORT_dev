"use client";

/**
 * Колонки сводной таблицы для ядра (фаза 9, R14): словарь компании.
 *
 * Ядро читает сводную таблицу по названиям колонок, и эти названия - шапка
 * таблицы BBC. У другой компании «Сумма Договора» называется иначе - и лист
 * не читается или колонка пуста. Здесь видно, как нашлась каждая колонка
 * ядра, а для ненайденной выбирается колонка из шапки таблицы: её название
 * становится вторым названием колонки ядра (номер колонки не запоминается -
 * правило проекта «колонки по названиям»).
 */
import { useEffect, useMemo, useState } from "react";

import { type BookColumn, type BookColumnsView, coreApi } from "@/components/finance/api";
import { ChoiceSelect } from "@/components/choice-select";
import { useSessionState } from "@/components/session-state";

const HOW: Record<string, string> = {
  exact: "точно",
  squashed: "без пробелов и знаков",
  loose: "похоже",
};

function messageOf(exc: unknown, fallback: string): string {
  return exc instanceof Error && exc.message ? exc.message : fallback;
}

/** `onChanged` - название записано, таблица перечитана: экран вокруг (например, «Первые шаги») пересчитывает своё. */
export function BookColumns({ onChanged }: { onChanged?: () => void } = {}) {
  const [data, setData] = useState<BookColumnsView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [show, setShow] = useSessionState<"problems" | "all">("setup.book-columns.show", "problems");
  useEffect(() => {
    let alive = true;
    coreApi
      .bookColumns()
      .then((next) => alive && setData(next))
      .catch((exc) => alive && setError(messageOf(exc, "Шапка таблицы не прочиталась")));
    return () => {
      alive = false;
    };
  }, []);
  const save = async (column: BookColumn, name: string, on: boolean) => {
    setBusy(`${column.key}:${name}`);
    setError("");
    try {
      setData(await coreApi.setBookColumn(column.key, name, on));
      onChanged?.();
    } catch (exc) {
      setError(messageOf(exc, "Не записалось"));
    } finally {
      setBusy("");
    }
  };
  // Колонки шапки, которые ещё не заняты другой колонкой ядра, - кандидаты для ненайденной.
  const free = useMemo(() => {
    if (!data) return [];
    const taken = new Set(data.columns.filter((item) => item.index !== null).map((item) => item.index));
    return data.header
      .map((name, index) => ({ name, index }))
      .filter((item) => item.name && !taken.has(item.index));
  }, [data]);
  if (!data && !error) return <p className="setup-summary-meta">Читаем шапку таблицы…</p>;
  if (data && !data.connected) return null;
  const columns = data?.columns ?? [];
  const problems = columns.filter((item) => item.problem || (item.index === null && item.extra.length));
  const missing = columns.filter((item) => item.index === null);
  const shown = show === "problems" ? columns.filter((item) => item.problem || item.index === null || item.extra.length) : columns;
  return (
    <section className="book-columns" aria-label="Колонки сводной таблицы для ядра">
      <div className="book-columns-head">
        <h3 className="setup-summary-title">Колонки для ядра</h3>
        <p className="setup-summary-meta">
          {data
            ? `в таблице ${data.header.filter(Boolean).length} колонок · ядро нашло ${columns.length - missing.length} из ${columns.length}` +
              (problems.length ? ` · требуют внимания: ${problems.length}` : "")
            : ""}
        </p>
        <span className="fin-mine" role="group" aria-label="Какие колонки">
          {(
            [
              ["problems", "Не найдены и свои"],
              ["all", "Все"],
            ] as ["problems" | "all", string][]
          ).map(([key, title]) => (
            <button key={key} type="button" className="fin-chip" data-on={show === key ? "" : undefined} onClick={() => setShow(key)}>
              {title}
            </button>
          ))}
        </span>
      </div>
      {error ? (
        <p className="setup-error" role="alert">
          {error}
        </p>
      ) : null}
      {data?.error ? <p className="setup-error">{data.error}</p> : null}
      {shown.length ? (
        <div className="book-columns-list" role="list">
          {shown.map((column) => (
            <ColumnRow key={column.key} column={column} free={free} busy={busy} onSave={save} />
          ))}
        </div>
      ) : (
        <p className="setup-summary-meta">Все колонки ядра нашлись по своим названиям</p>
      )}
    </section>
  );
}

function ColumnRow({
  column,
  free,
  busy,
  onSave,
}: {
  column: BookColumn;
  free: { name: string; index: number }[];
  busy: string;
  onSave: (column: BookColumn, name: string, on: boolean) => Promise<void>;
}) {
  const [pick, setPick] = useState("");
  const found = column.index !== null;
  return (
    <div className="book-column" role="listitem" data-problem={column.problem ? "" : undefined}>
      <span className="book-column-title">
        {column.title}
        {column.required ? <span className="fin-soft"> · обязательная</span> : null}
      </span>
      <span className="book-column-found">
        {found ? (
          <>
            «{column.header}» <span className="fin-soft">· {HOW[column.how] ?? column.how}</span>
          </>
        ) : column.problem ? (
          <span className="book-column-problem">{column.problem}</span>
        ) : (
          <span className="fin-soft">нет в таблице - колонка не обязательна</span>
        )}
      </span>
      <span className="book-column-extra">
        {column.extra.map((name) => (
          <span key={name} className="book-column-name">
            «{name}»
            <button
              type="button"
              className="fin-link-btn"
              disabled={busy === `${column.key}:${name}`}
              onClick={() => void onSave(column, name, false)}
            >
              убрать
            </button>
          </span>
        ))}
        {!found ? (
          <span className="book-column-pick">
            <ChoiceSelect className="input-field" value={pick} placeholder="это колонка таблицы…" aria-label={`Колонка таблицы для «${column.title}»`} onChange={setPick}>
              {free.map((item) => (
                <option key={item.index} value={item.name}>
                  {item.name}
                </option>
              ))}
            </ChoiceSelect>
            <button
              type="button"
              className="btn-ghost btn-sm"
              disabled={!pick || busy === `${column.key}:${pick}`}
              onClick={() => void onSave(column, pick, true).then(() => setPick(""))}
            >
              {busy === `${column.key}:${pick}` ? "Читаем…" : "Записать"}
            </button>
          </span>
        ) : null}
      </span>
    </div>
  );
}
