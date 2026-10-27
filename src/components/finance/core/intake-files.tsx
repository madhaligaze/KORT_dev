"use client";

/**
 * Приёмник на экране: файлы компании - 1С, Excel отделов, выписки - и что
 * KORT в них видит, до того как что-то заведёт.
 *
 * Сервер (`POST /core/intake`) называет смысл строки каждого листа: участник,
 * договор, договор за месяц, платёж, документ, остаток на дату. Здесь это
 * показывается словами, с колонками, которые KORT узнал, вопросами, которые он
 * задаст, и отказами. Реестр и выписка уходят в свой разбор тем же файлом.
 * Отчёты 1С - журналы реализаций и счетов, контрагенты, ОСВ - заводятся вместе
 * одной выгрузкой (`POST /core/onec-files`): база на каждую организацию, и
 * дальше «Из 1С» шагами. Остальное KORT пока только узнаёт - так и сказано.
 */
import { useRef, useState } from "react";

import { type IntakeFile, type IntakeSheet, type OnecFilesResult, coreApi } from "@/components/finance/api";
import { handOff } from "@/components/finance/core/hand-off";
import { openSection } from "@/components/finance/core/open";
import { plural } from "@/components/finance/format";

type Item = { id: number; file: File; result: IntakeFile | null; error: string };

const ACCEPT = ".xlsx,.xlsm,.xls,.csv,.txt,.tsv,.htm,.html,.xml,.pdf";
/** Формы строк, которыми говорят отчёты 1С: они заводятся вместе, одной выгрузкой. */
const ONEC_FORMS = new Set(["document", "participant", "balance"]);

function isOnec(item: Item): boolean {
  const sheets = item.result?.sheets ?? [];
  return Boolean(sheets.length) && sheets.every((sheet) => sheet.form && ONEC_FORMS.has(sheet.form));
}

/** `onChanged` - выгрузка 1С завела базы: «Из 1С» перечитывает их. */
export function IntakeFiles({ onChanged }: { onChanged?: () => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(0);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<OnecFilesResult | null>(null);
  const [failed, setFailed] = useState("");
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const counter = useRef(0);

  const read = (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      const id = (counter.current += 1);
      setItems((was) => [{ id, file, result: null, error: "" }, ...was]);
      setBusy((value) => value + 1);
      coreApi
        .intake(file)
        .then((result) => setItems((was) => was.map((item) => (item.id === id ? { ...item, result } : item))))
        .catch((exc: unknown) =>
          setItems((was) =>
            was.map((item) => (item.id === id ? { ...item, error: exc instanceof Error ? exc.message : "Файл не прочитался" } : item)),
          ),
        )
        .finally(() => setBusy((value) => value - 1));
    }
  };

  const onec = items.filter(isOnec);
  // Список контрагентов один - ещё не выгрузка 1С: без журнала документов заводить нечего.
  const journals = onec.some((item) => item.result?.sheets.some((sheet) => sheet.form === "document"));
  const sendOnec = async () => {
    setSending(true);
    setFailed("");
    try {
      setSent(await coreApi.onecFiles(onec.map((item) => item.file)));
      onChanged?.();
    } catch (exc) {
      setFailed(exc instanceof Error && exc.message ? exc.message : "Выгрузка 1С не завелась");
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="intake" aria-label="Файлы компании">
      <p className="start-title">Файлы компании</p>
      <p className="start-text">Реестр договоров, выписки банка, отчёты и списки из 1С, таблицы отделов</p>
      <div
        className="fin-drop intake-drop"
        data-over={over}
        role="button"
        tabIndex={0}
        onClick={() => input.current?.click()}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            input.current?.click();
          }
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setOver(false);
          if (event.dataTransfer.files?.length) read(event.dataTransfer.files);
        }}
      >
        <span className="intake-drop-title">{busy ? "Читаем…" : "Перетащите файлы или выберите"}</span>
        <span className="start-note">XLSX · XLS · CSV · PDF · выгрузка 1С</span>
        <input
          ref={input}
          type="file"
          multiple
          accept={ACCEPT}
          className="intake-input"
          onChange={(event) => {
            const picked = event.target.files;
            if (picked?.length) read(Array.from(picked));
            event.target.value = "";
          }}
        />
      </div>
      {items.length ? (
        <ul className="intake-files">
          {items.map((item) => (
            <FileLine key={item.id} item={item} onec={isOnec(item)} />
          ))}
        </ul>
      ) : null}
      {journals ? (
        <div className="intake-onec">
          <p className="start-text">
            Отчёты 1С: {onec.length} {plural(onec.length, "файл", "файла", "файлов")} - журналы документов, контрагенты и ОСВ
            заводятся вместе, база на каждую организацию
          </p>
          <button type="button" className="btn-primary start-go" disabled={sending || Boolean(busy)} onClick={() => void sendOnec()}>
            {sending ? "Заводим…" : "Завести из 1С"}
          </button>
          {failed ? <p className="fin-fail intake-line">{failed}</p> : null}
          {sent ? <OnecSent result={sent} /> : null}
        </div>
      ) : null}
    </section>
  );
}

function OnecSent({ result }: { result: OnecFilesResult }) {
  const bases = Object.values(result.bases);
  return (
    <div className="intake-sheet">
      {bases.map((base) => (
        <p key={base.title} className="intake-line">
          <span className="fin-strong">{base.organization}</span> · актов {base.counts.sale ?? 0} · счетов {base.counts.invoice ?? 0}
        </p>
      ))}
      {result.upload.osv ? (
        <p className="start-note">
          ОСВ на {result.upload.osv.start ?? "-"} · {result.upload.osv.contracts}{" "}
          {plural(result.upload.osv.contracts, "договор", "договора", "договоров")}
        </p>
      ) : (
        <p className="start-note">ОСВ по 1210 нет - сальдо на начало учёта загрузите в шагах «Из 1С»</p>
      )}
      {result.without_bin.length ? (
        <p className="start-note">Без БИН в «Контрагентах»: {result.without_bin.join(", ")}</p>
      ) : null}
      {[...result.upload.problems, ...result.upload.journals.flatMap((journal) => journal.problems)].map((problem) => (
        <p key={problem} className="fin-fail intake-line">
          {problem}
        </p>
      ))}
      <p className="start-note">Дальше - шаги «Из 1С» ниже, по каждой организации</p>
    </div>
  );
}

function FileLine({ item, onec }: { item: Item; onec: boolean }) {
  const result = item.result;
  const forms = new Set((result?.sheets ?? []).map((sheet) => sheet.form));
  const target = forms.has("contract") ? "registry" : forms.has("payment") ? "statement" : null;
  return (
    <li className="intake-file">
      <p className="intake-file-name">{item.file.name}</p>
      {item.error || result?.error ? <p className="fin-fail intake-line">{item.error || result?.error}</p> : null}
      {!result && !item.error ? <p className="start-note">читаем…</p> : null}
      {result?.sheets.map((sheet) => <SheetLine key={sheet.sheet} sheet={sheet} single={result.sheets.length === 1} />)}
      {result && !result.error ? (
        target ? (
          <button
            type="button"
            className="btn-ghost start-go"
            onClick={() => {
              handOff(target, item.file);
              openSection({ section: target === "registry" ? "contracts-import" : "import" });
            }}
          >
            {target === "registry" ? "Загрузить как реестр" : "Загрузить как выписку"}
          </button>
        ) : onec ? (
          <p className="start-note">Отчёт 1С - заводится вместе с другими кнопкой «Завести из 1С»</p>
        ) : (
          <p className="start-note">Такие строки KORT пока только узнаёт - заводить их отсюда нельзя</p>
        )
      ) : null}
    </li>
  );
}

function SheetLine({ sheet, single }: { sheet: IntakeSheet; single: boolean }) {
  const known = sheet.columns.filter((column) => column.key && column.title);
  const rows = sheet.rows ?? null;
  const what = sheet.form_title ? `строка = ${sheet.form_title}` : "смысл строки не ясен";
  return (
    <div className="intake-sheet">
      <p className="intake-line">
        {single ? "" : <span className="fin-strong">«{sheet.sheet}» · </span>}
        <span className={sheet.form ? "fin-strong" : undefined}>{what}</span>
        {rows !== null ? ` · ${rows} ${plural(rows, "строка", "строки", "строк")}` : ""}
        {sheet.title ? <span className="start-note"> · {sheet.title}</span> : null}
      </p>
      {sheet.note ? <p className="start-note">{sheet.note}</p> : null}
      {known.length ? (
        <p className="start-note intake-cols">{known.map((column) => column.title).join(" · ")}</p>
      ) : null}
      {sheet.questions.map((question, index) => (
        <p key={index} className="intake-line">
          {question.text}
        </p>
      ))}
      {sheet.refusals.map((refusal, index) => (
        <p key={index} className="fin-fail intake-line">
          {refusal.text}
        </p>
      ))}
    </div>
  );
}
