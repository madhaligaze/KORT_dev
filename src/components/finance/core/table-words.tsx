"use client";

/**
 * Слова таблицы (ядро, фаза 9, R12-R13): слова компании → смыслы KORT.
 *
 * Колонку «Счет» сводной таблицы заполняет формула своими словами («Просрочка
 * более 5 дней», «Еще рано» у BBC), «Вид Услуги» - человек («Абон.П.»,
 * «Аренда»). Слова BBC KORT понимает сам; у другой компании слово своё, и
 * без смысла её счета уходят в «Без срока», а бот не знает, в какой пост их
 * класть. Здесь видно каждое значение из таблицы, сколько строк его носят и
 * как KORT его понимает; незнакомому слову смысл дают выбором - список,
 * число у пункта, бот и сверка понимают его сразу.
 */
import { useEffect, useMemo, useState } from "react";

import { ChoiceSelect } from "@/components/choice-select";
import { type TableWordPart, type TableWordSeen, type TableWordsView, coreApi } from "@/components/finance/api";
import { useSessionState } from "@/components/session-state";

const PARTS: [TableWordPart, string][] = [
  ["bill", "Колонка «Счет»"],
  ["kind", "Колонка «Вид Услуги» - посты бота"],
];

const HOW: Record<TableWordSeen["how"], string> = {
  kort: "KORT понимает сам",
  company: "слово компании",
  unknown: "KORT не знает этого слова",
};

function messageOf(exc: unknown, fallback: string): string {
  return exc instanceof Error && exc.message ? exc.message : fallback;
}

export function TableWords() {
  const [data, setData] = useState<TableWordsView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [show, setShow] = useSessionState<"unknown" | "all">("setup.table-words.show", "unknown");
  useEffect(() => {
    let alive = true;
    coreApi
      .tableWords()
      .then((next) => alive && setData(next))
      .catch((exc) => alive && setError(messageOf(exc, "Слова таблицы не прочитались")));
    return () => {
      alive = false;
    };
  }, []);
  const save = async (part: TableWordPart, word: string, meaning: string) => {
    setBusy(`${part}:${word}`);
    setError("");
    try {
      setData(await coreApi.setTableWord(part, word, meaning));
    } catch (exc) {
      setError(messageOf(exc, "Не записалось"));
    } finally {
      setBusy("");
    }
  };
  const unknown = useMemo(
    () => (data ? PARTS.reduce((sum, [part]) => sum + data.seen[part].filter((item) => item.how === "unknown").length, 0) : 0),
    [data],
  );
  if (!data && !error) return <p className="setup-summary-meta">Читаем слова таблицы…</p>;
  return (
    <section className="table-words" aria-label="Слова таблицы">
      <div className="book-columns-head">
        <h3 className="setup-summary-title">Слова таблицы</h3>
        <p className="setup-summary-meta">{data && !data.error ? (unknown ? `незнакомых слов: ${unknown}` : "все слова понятны") : ""}</p>
        <span className="fin-mine" role="group" aria-label="Какие слова">
          {(
            [
              ["unknown", "Незнакомые и свои"],
              ["all", "Все"],
            ] as ["unknown" | "all", string][]
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
      {data && !data.error
        ? PARTS.map(([part, title]) => {
            const items = data.seen[part].filter((item) => show === "all" || item.how !== "kort");
            return (
              <div key={part} className="table-words-part">
                <p className="table-words-title">{title}</p>
                {items.length ? (
                  <div className="book-columns-list" role="list">
                    {items.map((item) => (
                      <WordRow key={item.text} part={part} item={item} data={data} busy={busy === `${part}:${item.text}`} onSave={save} />
                    ))}
                  </div>
                ) : (
                  <p className="setup-summary-meta">Все слова колонки KORT понимает сам</p>
                )}
              </div>
            );
          })
        : null}
    </section>
  );
}

function WordRow({
  part,
  item,
  data,
  busy,
  onSave,
}: {
  part: TableWordPart;
  item: TableWordSeen;
  data: TableWordsView;
  busy: boolean;
  onSave: (part: TableWordPart, word: string, meaning: string) => Promise<void>;
}) {
  return (
    <div className="book-column" role="listitem" data-problem={item.how === "unknown" ? "" : undefined}>
      <span className="book-column-title">«{item.text}»</span>
      <span className="book-column-found">
        <span className={item.how === "unknown" ? "book-column-problem" : "fin-soft"}>{HOW[item.how]}</span>
        <span className="fin-soft"> · строк: {item.rows}</span>
      </span>
      <span className="book-column-pick">
        <ChoiceSelect
          className="input-field"
          value={item.how === "company" ? item.meaning : ""}
          placeholder={item.how === "kort" && item.meaning ? `${data.titles[item.meaning] ?? item.meaning} - как понимает KORT` : "это значит…"}
          aria-label={`Смысл слова «${item.text}»`}
          disabled={busy}
          clearable={item.how === "company"}
          onChange={(meaning) => void onSave(part, item.text, meaning)}
        >
          {data.meanings[part].map((meaning) => (
            <option key={meaning} value={meaning}>
              {data.titles[meaning] ?? meaning}
            </option>
          ))}
        </ChoiceSelect>
      </span>
    </div>
  );
}
