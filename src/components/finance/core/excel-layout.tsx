"use client";

/**
 * Таблица отдела любой формы: разметка листа человеком и что она положит в модель.
 *
 * Лист, которого KORT не понял (таблица слушателей), или понял формой,
 * которую кладёт этот путь (договор за месяц, остаток на дату), человек
 * размечает здесь один раз: что значит строка, что значит каждая колонка,
 * чьи это договоры. Сервер (`core/excel.py`) отвечает предложением до записи:
 * сколько договоров заведём, сколько уже есть в KORT, какое сальдо ляжет, где
 * таблица расходится с KORT, - и вопросами только там, где таблица не отвечает
 * сама (порядок даты, сумма текстом, спор с 1С). «Завести» - одна пачка с
 * точкой восстановления; разметка запоминается словарём компании, и такой же
 * лист в следующий раз узнаётся без вопросов.
 */
import { useEffect, useMemo, useRef, useState } from "react";

import {
  type IntakeAnswers,
  type IntakeApplied,
  type IntakeAsk,
  type IntakeFile,
  type IntakeLayout,
  type IntakePlan,
  type IntakeProposal,
  coreApi,
} from "@/components/finance/api";
import { ChoiceLine } from "@/components/finance/contracts/import/choice-line";
import { contractMoney, formatDay, plural } from "@/components/finance/format";

const FORMS = ["contract", "contract_month", "balance"] as const;
const SKIP = "-";

function money(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "-";
  return contractMoney(Math.round(Number(value)));
}

function messageOf(exc: unknown, fallback: string): string {
  return exc instanceof Error && exc.message ? exc.message : fallback;
}

/** Разметка по тому, что KORT уже узнал: форма листа и колонки каталога. */
function initial(described: IntakeFile): IntakeAnswers {
  const sheets: Record<string, IntakeLayout> = {};
  for (const sheet of described.sheets) {
    if (sheet.layout) {
      sheets[sheet.sheet] = { ...sheet.layout };
      continue;
    }
    if (!sheet.form || !(FORMS as readonly string[]).includes(sheet.form)) continue;
    const columns: Record<string, string> = {};
    for (const column of sheet.columns) if (column.key) columns[column.header] = column.key;
    sheets[sheet.sheet] = { form: sheet.form, columns };
  }
  return { sheets, questions: {} };
}

export function ExcelLayout({ file, described }: { file: File; described: IntakeFile }) {
  const [answers, setAnswers] = useState<IntakeAnswers>(() => initial(described));
  const [plan, setPlan] = useState<IntakePlan | null>(null);
  const [applied, setApplied] = useState<IntakeApplied | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState("");
  const asked = useRef(false);
  const forms = described.forms ?? [];
  const sheets = described.pdf ? [] : described.sheets;

  const show = async (next: IntakeAnswers) => {
    setBusy(true);
    setFailed("");
    try {
      setPlan(await coreApi.intakePlan(file, next));
      asked.current = true;
    } catch (exc) {
      setFailed(messageOf(exc, "Предложение не посчиталось"));
    } finally {
      setBusy(false);
    }
  };

  // Ответ изменился после первого предложения - предложение пересчитывается само.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!asked.current || applied) return;
    const timer = window.setTimeout(() => void show(answers), 350);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answers]);

  const setSheet = (name: string, patch: Partial<IntakeLayout>) =>
    setAnswers((was) => {
      const current = was.sheets[name] ?? { form: "" };
      return { ...was, sheets: { ...was.sheets, [name]: { ...current, ...patch, sheet: name } } };
    });
  const setQuestion = (key: string, value: string) =>
    setAnswers((was) => ({ ...was, questions: { ...was.questions, [key]: value } }));

  const apply = async () => {
    setBusy(true);
    setFailed("");
    try {
      setApplied(await coreApi.intakeApply(file, answers));
    } catch (exc) {
      setFailed(messageOf(exc, "Не завелось"));
    } finally {
      setBusy(false);
    }
  };

  // Есть что положить в модель: договоры, дополнения, сальдо, окончания, написания.
  // Строки «договор за месяц» без договора в KORT только сверяются - «Завести» им не нужна.
  const actionable = (plan?.sheets ?? []).some(
    (sheet) =>
      sheet.ready &&
      (sheet.contracts.new > 0 ||
        sheet.contracts.fill > 0 ||
        sheet.openings.count > 0 ||
        sheet.ends.some((item) => item.state === "take") ||
        sheet.contracts.items.some((item) => item.action === "alias")),
  );
  const ready = plan !== null && actionable;
  const open = plan?.sheets.flatMap((sheet) => openQuestions(sheet, answers)) ?? [];

  return (
    <div className="intake-layout">
      {sheets.map((sheet) => {
        const layout = answers.sheets[sheet.sheet];
        const form = layout?.skip ? SKIP : (layout?.form ?? "");
        const info = forms.find((item) => item.key === form);
        const header = sheet.header?.length ? sheet.header : sheet.columns.map((column) => column.header);
        return (
          <div key={sheet.sheet} className="intake-layout-sheet">
            <p className="intake-line">
              <span className="fin-strong">«{sheet.sheet}»</span> · что значит строка
            </p>
            <ChoiceLine
              label={`Лист ${sheet.sheet}`}
              items={[...forms.map((item) => ({ value: item.key as string, label: item.title })), { value: SKIP, label: "лист не нужен" }]}
              value={form || null}
              onChange={(value) =>
                value === SKIP ? setSheet(sheet.sheet, { skip: true }) : setSheet(sheet.sheet, { form: value, skip: false })
              }
            />
            {info && header.length ? (
              <div className="intake-layout-cols">
                {header.map((title) => (
                  <label key={title} className="intake-layout-col">
                    <span className="intake-layout-head">{title}</span>
                    <select
                      className="intake-layout-select"
                      value={layout?.columns?.[title] ?? ""}
                      onChange={(event) =>
                        setSheet(sheet.sheet, { columns: { ...(layout?.columns ?? {}), [title]: event.target.value || SKIP } })
                      }
                    >
                      <option value="">не нужна</option>
                      {info.fields.map((field) => (
                        <option key={field.key} value={field.key}>
                          {field.title}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
      <div className="intake-layout-go">
        <button type="button" className="btn-ghost start-go" disabled={busy} onClick={() => void show(answers)}>
          {busy && !plan ? "Считаем…" : plan ? "Пересчитать" : "Показать, что заведём"}
        </button>
        {ready && !applied ? (
          <button type="button" className="btn-primary start-go" disabled={busy || open.length > 0} onClick={() => void apply()}>
            {busy && plan ? "Заводим…" : "Завести"}
          </button>
        ) : null}
      </div>
      {failed ? <p className="fin-fail intake-line">{failed}</p> : null}
      {plan && !applied
        ? plan.sheets.map((proposal) => (
            <ProposalView
              key={proposal.sheet}
              proposal={proposal}
              answers={answers}
              onSheet={setSheet}
              onQuestion={setQuestion}
            />
          ))
        : null}
      {applied ? <Applied result={applied} /> : null}
    </div>
  );
}

/** Вопросы, без ответа на которые лист не заведётся: разметка и выбор между источниками. */
function openQuestions(proposal: IntakeProposal, answers: IntakeAnswers): IntakeAsk[] {
  return proposal.questions.filter((question) => {
    if (question.kind === "amount") return false;
    if (question.layout) return true;
    return !question.key || !answers.questions[question.key];
  });
}

function ProposalView({
  proposal,
  answers,
  onSheet,
  onQuestion,
}: {
  proposal: IntakeProposal;
  answers: IntakeAnswers;
  onSheet: (name: string, patch: Partial<IntakeLayout>) => void;
  onQuestion: (key: string, value: string) => void;
}) {
  const sheetOf = (ask: IntakeAsk) => ask.sheet ?? proposal.sheet;
  const counts = proposal.contracts;
  const facts = useMemo(() => {
    const out: string[] = [];
    if (counts.new) out.push(`новых договоров ${counts.new}`);
    if (counts.same || counts.fill) out.push(`уже в KORT ${counts.same + counts.fill}${counts.fill ? `, дополнит ${counts.fill}` : ""}`);
    if (counts.waiting) out.push(`ждут ответа ${counts.waiting}`);
    const aliases = counts.items.filter((item) => item.action === "alias").length;
    if (aliases) out.push(`новых написаний участников ${aliases}`);
    return out;
  }, [counts]);
  const differ = proposal.compare.filter((item) => item.kind !== "unknown");
  const unknown = proposal.compare.filter((item) => item.kind === "unknown");
  return (
    <div className="intake-sheet intake-layout-plan">
      <p className="intake-line">
        <span className="fin-strong">«{proposal.sheet}»</span>
        {proposal.form_title ? ` · строка = ${proposal.form_title}` : ""} · {proposal.rows}{" "}
        {plural(proposal.rows, "строка", "строки", "строк")}
      </p>
      {facts.length ? <p className="intake-line">{facts.join(" · ")}</p> : null}
      {proposal.openings.as_of ? (
        <p className="intake-line">
          Сальдо на {formatDay(proposal.openings.as_of)}:{" "}
          {proposal.openings.count
            ? `${proposal.openings.count} ${plural(proposal.openings.count, "договор", "договора", "договоров")}, ${money(proposal.openings.debt)}`
            : "нового нет"}
        </p>
      ) : null}
      {proposal.ends.map((item) => (
        <p key={`end-${item.line}`} className="start-note">
          {item.name} {item.number ?? ""}: окончание {formatDay(item.end)}
          {item.state === "same" ? " - KORT знает то же" : ""}
        </p>
      ))}
      {proposal.missing.map((text) => (
        <p key={text} className="start-note">
          {text}
        </p>
      ))}
      {[...proposal.setup, ...proposal.questions].map((ask, index) => (
        <Ask key={`${ask.kind}-${ask.key ?? index}`} ask={ask} sheet={sheetOf(ask)} answers={answers} onSheet={onSheet} onQuestion={onQuestion} />
      ))}
      {differ.length ? (
        <div className="intake-sheet">
          <p className="intake-line fin-strong">Расходится с KORT: {differ.length}</p>
          {differ.slice(0, 8).map((item, index) => (
            <p key={index} className="start-note">
              {item.name ?? item.number ?? ""} {item.month ? `· ${item.month}` : ""}: в таблице {money(item.file)}, у KORT {money(item.kort)}
              {item.kind === "paid" ? " (оплачено)" : item.kind === "accrual" ? " (начислено)" : item.kind === "amount" ? " (сумма)" : ""}
            </p>
          ))}
        </div>
      ) : null}
      {unknown.length ? (
        <p className="start-note">
          Строк без договора в KORT: {unknown.length} ({unknown.slice(0, 3).map((item) => item.name || item.number).join(", ")})
          {proposal.form === "contract_month" ? " - такие строки сверяются с договорами, а заводит договоры реестр или 1С" : ""}
        </p>
      ) : null}
      {proposal.refusals.map((refusal, index) => (
        <p key={index} className="fin-fail intake-line">
          {refusal.text}
        </p>
      ))}
    </div>
  );
}

function Ask({
  ask,
  sheet,
  answers,
  onSheet,
  onQuestion,
}: {
  ask: IntakeAsk;
  sheet: string;
  answers: IntakeAnswers;
  onSheet: (name: string, patch: Partial<IntakeLayout>) => void;
  onQuestion: (key: string, value: string) => void;
}) {
  const layout = answers.sheets[sheet];
  if (ask.kind === "date_order" || ask.kind === "hidden" || ask.kind === "billing") {
    const field = ask.kind === "date_order" ? "date_order" : ask.kind === "hidden" ? "hidden" : "billing";
    return (
      <div className="intake-sheet">
        <p className="intake-line">{ask.text}</p>
        <ChoiceLine
          label={ask.text}
          items={(ask.options ?? []).map((option) => ({ value: option.value, label: option.label }))}
          value={(layout?.[field] as string | undefined) || null}
          onChange={(value) => onSheet(sheet, { [field]: value })}
        />
      </div>
    );
  }
  if (ask.kind === "executor") {
    return (
      <label className="intake-layout-col">
        <span className="intake-line">{ask.text}</span>
        <select className="intake-layout-select" value={layout?.executor ?? ""} onChange={(event) => onSheet(sheet, { executor: event.target.value })}>
          <option value="">выберите</option>
          {(ask.options ?? []).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    );
  }
  if (ask.kind === "as_of" || ask.kind === "month") {
    const field = ask.kind === "as_of" ? "as_of" : "month";
    return (
      <label className="intake-layout-col">
        <span className="intake-line">{ask.text}</span>
        <input
          type="date"
          className="intake-layout-select"
          value={(layout?.[field] as string | undefined) ?? ""}
          onChange={(event) => onSheet(sheet, { [field]: event.target.value })}
        />
      </label>
    );
  }
  if (ask.kind === "amount" && ask.key) {
    return (
      <label className="intake-layout-col">
        <span className="intake-line">{ask.text}</span>
        <input
          inputMode="decimal"
          className="intake-layout-select"
          value={answers.questions[ask.key] ?? ""}
          placeholder="сумма в тенге"
          onChange={(event) => onQuestion(ask.key as string, event.target.value)}
        />
      </label>
    );
  }
  if (ask.options?.length && ask.key) {
    return (
      <div className="intake-sheet">
        <p className="intake-line">{ask.text}</p>
        <ChoiceLine
          label={ask.text}
          stacked={ask.options.length > 3}
          items={ask.options.map((option) => ({ value: option.value, label: option.label }))}
          value={answers.questions[ask.key] || null}
          onChange={(value) => onQuestion(ask.key as string, value)}
        />
      </div>
    );
  }
  return <p className="intake-line">{ask.text}</p>;
}

function Applied({ result }: { result: IntakeApplied }) {
  const parts: string[] = [];
  if (result.created) parts.push(`заведено договоров ${result.created}`);
  if (result.filled) parts.push(`дополнено ${result.filled}`);
  if (result.openings) parts.push(`сальдо ${result.openings}`);
  if (result.ended) parts.push(`окончаний ${result.ended}`);
  if (result.aliases) parts.push(`написаний ${result.aliases}`);
  return (
    <div className="intake-sheet">
      <p className="intake-line fin-strong">{parts.length ? parts.join(" · ") : "Нового для KORT в таблице нет"}</p>
      {result.blocked.length ? <p className="start-note">Не заведены листы: {result.blocked.join(", ")}</p> : null}
      {result.point ? <p className="start-note">Вернуть можно в «Восстановлении»: {result.point.title}</p> : null}
      <p className="start-note">Разметка запомнена: такой лист KORT дальше узнаёт сам</p>
    </div>
  );
}
