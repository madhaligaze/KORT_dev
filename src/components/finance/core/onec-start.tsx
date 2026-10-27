"use client";

/**
 * Вход из 1С в «Первых шагах»: компания с базой 1С в интернете или с
 * выгрузками 1С файлами, и ОСВ по 1210 - до «Нам должны», без таблиц.
 *
 * Сервер (`core/onec_start.py`) считает каждый шаг до записи: наше юрлицо по
 * БИН организации, участники по БИН с написаниями 1С, договоры с условиями по
 * актам, сальдо из ОСВ, источник оплат. Здесь шаги показаны числами, а
 * единственный вопрос - «договор закончился?», когда акты кончились раньше
 * прошлого месяца: без ответа такой договор не заводится. Договор, который
 * KORT уже ведёт у другого нашего ТОО, - перевод клиента на юрлицо базы с
 * первого её документа. У базы из файлов поступлений нет: оплаты юрлица -
 * выписки банка. Следующий шаг - единственная плита на экране.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import {
  type OnecBase,
  type OnecStartAnswer,
  type OnecStartPlan,
  type OnecStartStep,
  contractsApi,
  coreApi,
  financeApi,
} from "@/components/finance/api";
import { openSection } from "@/components/finance/core/open";
import { contractMoney, formatDay, plural } from "@/components/finance/format";
import { ChoiceLine } from "@/components/finance/contracts/import/choice-line";

function messageOf(exc: unknown, fallback: string): string {
  return exc instanceof Error && exc.message ? exc.message : fallback;
}

function money(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "-";
  return contractMoney(Math.round(Number(value)));
}

function contractsLabel(made: number, moved: number): string {
  const word = (value: number) => plural(value, "договор", "договора", "договоров");
  if (made && moved) return `Завести ${made} ${word(made)} и перевести ${moved}`;
  if (moved) return `Перевести ${moved} ${word(moved)}`;
  return `Завести ${made} ${word(made)}`;
}

/**
 * `revision` - перечитать базы (после выгрузки 1С файлами). `partial` - компания
 * со сводной таблицей: из 1С - участники и недостающие договоры, а сальдо и
 * оплаты у неё из таблицы и выписок, их шаги не показываются.
 */
export function OnecStart({ revision = 0, partial = false }: { revision?: number; partial?: boolean }) {
  const [bases, setBases] = useState<OnecBase[] | null>(null);
  useEffect(() => {
    let alive = true;
    financeApi
      .onec()
      .then((state) => alive && setBases(state.bases))
      .catch(() => alive && setBases([]));
    return () => {
      alive = false;
    };
  }, [revision]);
  // Шаг одной базы меняет план другой: «Тумар Офис» завёл договоры - у «Тумар
  // Плюс» те же договоры становятся переводом. Каждый шаг перечитывает все базы.
  const [shared, setShared] = useState(0);
  const changed = useCallback(() => setShared((value) => value + 1), []);
  // Пока пишется шаг одной базы, шаги других ждут: два шага разом спорят за
  // одни счётчики компании (стенд 27.10 - взаимоблокировка Postgres).
  const [writing, setWriting] = useState<string | null>(null);
  const busyBase = useCallback((id: string, on: boolean) => setWriting((was) => (on ? id : was === id ? null : was)), []);
  if (!bases || !bases.length) return null;
  return (
    <>
      {bases.map((base) => (
        <BaseSteps
          key={base.id}
          base={base}
          shared={shared}
          onChanged={changed}
          locked={writing !== null && writing !== base.id}
          onBusy={busyBase}
          partial={partial}
        />
      ))}
    </>
  );
}

function BaseSteps({
  base,
  shared,
  onChanged,
  locked,
  onBusy,
  partial,
}: {
  base: OnecBase;
  shared: number;
  onChanged: () => void;
  locked: boolean;
  onBusy: (id: string, on: boolean) => void;
  partial: boolean;
}) {
  const [plan, setPlan] = useState<OnecStartPlan | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<OnecStartStep | "osv" | "rest" | "">("");
  const [restDay, setRestDay] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  });
  const [answers, setAnswers] = useState<Record<string, OnecStartAnswer>>({});
  const [points, setPoints] = useState<Partial<Record<OnecStartStep, string>>>({});
  const [revision, setRevision] = useState(0);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    coreApi
      .onecStart(base.id)
      .then((next) => alive && setPlan(next))
      .catch((exc) => alive && setError(messageOf(exc, "План из 1С не прочитался")));
    return () => {
      alive = false;
    };
  }, [base.id, revision, shared]);
  useEffect(() => onBusy(base.id, Boolean(busy)), [base.id, busy, onBusy]);
  const blocked = Boolean(busy) || locked;
  const reload = useCallback(() => {
    setRevision((value) => value + 1);
    onChanged();
  }, [onChanged]);

  const run = async (step: OnecStartStep) => {
    setBusy(step);
    setError("");
    try {
      const result = await coreApi.onecStartStep(base.id, step, step === "contracts" ? answers : {});
      if (result.point) setPoints((was) => ({ ...was, [step]: result.point!.id }));
      reload();
    } catch (exc) {
      setError(messageOf(exc, "Шаг не записался"));
    } finally {
      setBusy("");
    }
  };

  const undo = async (step: OnecStartStep) => {
    const point = points[step];
    if (!point) return;
    setBusy(step);
    try {
      await contractsApi.restorePoints.restore(point);
      setPoints((was) => ({ ...was, [step]: undefined }));
      reload();
    } catch (exc) {
      setError(messageOf(exc, "Не вернулось"));
    } finally {
      setBusy("");
    }
  };

  const sendOsv = async (picked: File) => {
    setBusy("osv");
    setError("");
    try {
      await coreApi.onecStartOsv(base.id, picked);
      reload();
    } catch (exc) {
      setError(messageOf(exc, "ОСВ не прочиталась"));
    } finally {
      setBusy("");
    }
  };

  const takeRest = async () => {
    setBusy("rest");
    setError("");
    try {
      await coreApi.onecStartBalances(base.id, restDay);
      reload();
    } catch (exc) {
      setError(messageOf(exc, "Остатки из 1С не прочитались"));
    } finally {
      setBusy("");
    }
  };

  if (!plan) {
    return (
      <section className="onec-start" aria-label={`Из 1С: ${base.title}`}>
        <p className="start-title">Из 1С · {base.title}</p>
        <p className="start-text">{error || "Читаем базу…"}</p>
      </section>
    );
  }

  const counts = plan.participants.counts;
  const toParty = (counts.create ?? 0) + (counts.bin ?? 0);
  const unanswered = plan.contracts.questions.filter((question) => !answers[question.key]);
  const moves = plan.contracts.moves ?? [];
  const contractsToMake = plan.contracts.new + plan.contracts.questions.length - unanswered.length + moves.length;
  const files = plan.base.files;
  const openings = plan.openings;
  const since = plan.since.current;
  const next: OnecStartStep | "" = !plan.entity.id
    ? "entity"
    : toParty
      ? "participants"
      : contractsToMake && !partial
        ? "contracts"
        : !partial && openings && !since
          ? "since"
          : !partial && !files && plan.payments.source !== "1c"
            ? "payments"
            : "";

  const button = (step: OnecStartStep, label: string) => (
    <button
      type="button"
      // Со сводной плита - её шаг выше: здесь только рамки, плита на экране одна.
      className={next === step && !partial ? "btn-primary start-go" : "btn-ghost start-go"}
      disabled={blocked}
      onClick={() => void run(step)}
    >
      {busy === step ? "Записываем…" : label}
    </button>
  );
  const back = (step: OnecStartStep) =>
    points[step] ? (
      <button type="button" className="fin-link-btn start-aside" disabled={blocked} onClick={() => void undo(step)}>
        Вернуть
      </button>
    ) : null;

  return (
    <section className="onec-start" aria-label={`Из 1С: ${base.title}`}>
      <p className="start-title">Из 1С · {base.title}</p>
      <p className="start-text">
        {plan.base.organization}
        {plan.base.bin ? ` · БИН ${plan.base.bin}` : ""}
        {partial ? " · сальдо и оплаты - из сводной таблицы и выписок" : ""}
      </p>
      {error ? <p className="party-error">{error}</p> : null}
      <ol className="start-steps">
        <li className="start-step" data-done={plan.entity.id ? "" : undefined}>
          <span className="start-n">1</span>
          <div className="start-body">
            <p className="start-title">Наше юрлицо</p>
            {plan.entity.id ? (
              <p className="start-state">организация базы - наше юрлицо</p>
            ) : (
              button("entity", `Завести «${plan.entity.name}»`)
            )}
          </div>
        </li>

        <li className="start-step" data-done={!toParty ? "" : undefined}>
          <span className="start-n">2</span>
          <div className="start-body">
            <p className="start-title">Участники</p>
            <p className="start-text">
              {[
                counts.create ? `новых ${counts.create}` : "",
                counts.bin ? `БИН запишем ${counts.bin}` : "",
                counts.alias ? `написания 1С у ${counts.alias}` : "",
                counts.same ? `уже есть ${counts.same}` : "",
                counts.dispute ? `спорных ${counts.dispute} - решает человек в «Участниках»` : "",
              ]
                .filter(Boolean)
                .join(" · ") || "контрагентов в документах базы нет"}
            </p>
            {toParty ? button("participants", `Завести ${toParty} ${plural(toParty, "участника", "участников", "участников")}`) : null}
          </div>
        </li>

        <li className="start-step" data-done={!contractsToMake && !unanswered.length ? "" : undefined}>
          <span className="start-n">3</span>
          <div className="start-body">
            <p className="start-title">Договоры</p>
            <p className="start-text">
              {[
                `из документов ${plan.contracts.items.length + plan.contracts.known}`,
                plan.contracts.known ? `уже в KORT ${plan.contracts.known}` : "",
                partial
                  ? plan.contracts.new + plan.contracts.questions.length
                    ? `договор в KORT не найден у ${plan.contracts.new + plan.contracts.questions.length}`
                    : ""
                  : plan.contracts.new
                    ? `заведём ${plan.contracts.new}`
                    : "",
                !partial && plan.contracts.no_amount ? `из них без суммы ${plan.contracts.no_amount} - в 1С только оплаты` : "",
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {(partial ? [] : plan.contracts.questions).map((question) => (
              <div key={question.key} className="onec-question">
                <p className="start-text">
                  <span className="fin-strong">{question.label}</span> · {question.customer} · последний акт по{" "}
                  {question.last_day ? formatDay(question.last_day) : "-"}. Договор закончился?
                </p>
                <ChoiceLine
                  label={`Договор ${question.label}`}
                  items={[
                    { value: "end", label: `Закончился ${question.last_day ? formatDay(question.last_day) : ""}` },
                    { value: "active", label: "Идёт" },
                  ]}
                  value={answers[question.key] ? (answers[question.key].end ? "end" : "active") : null}
                  onChange={(value) =>
                    setAnswers((was) => ({
                      ...was,
                      [question.key]: value === "end" ? { end: question.last_day ?? undefined } : { active: true },
                    }))
                  }
                />
              </div>
            ))}
            {moves.map((item) => (
              <p key={item.key} className="start-note">
                <span className="fin-strong">{item.label}</span> · {item.customer} - уже в KORT у другого нашего ТОО; документы 1С
                этого юрлица с {item.since ? formatDay(item.since) : "-"}: переведём клиента сюда с этого дня
              </p>
            ))}
            {partial ? (
              // Со сводной договоры уже в KORT, часто строками без номера («БезДог.08-2» в 1С):
              // завести «недостающие» значило бы задвоить их. Их разбирают документами.
              plan.contracts.new + plan.contracts.questions.length ? (
                <button
                  type="button"
                  className="btn-ghost start-go"
                  onClick={() => openSection({ section: "integrations" })}
                >
                  Разобрать в «Интеграции → 1С»
                </button>
              ) : null
            ) : contractsToMake ? (
              button("contracts", contractsLabel(contractsToMake - moves.length, moves.length))
            ) : null}
            {back("contracts")}
          </div>
        </li>

        {partial ? null : (
          <>
        <li className="start-step" data-done={since && openings ? "" : undefined}>
          <span className="start-n">4</span>
          <div className="start-body">
            <p className="start-title">Сальдо на начало учёта</p>
            {openings ? (
              <>
                <p className="start-text">
                  ОСВ по 1210 на {openings.since ? formatDay(openings.since) : "-"} · {openings.contracts}{" "}
                  {plural(openings.contracts, "договор", "договора", "договоров")} с сальдо, всего {money(openings.debt)}
                </p>
                {openings.missing.map((item) => (
                  <p key={`${item.party}-${item.contract}`} className="start-note">
                    {item.party} · {item.contract} · {money(item.opening)} - {item.why}
                  </p>
                ))}
                {openings.problems.map((problem) => (
                  <p key={problem} className="fin-fail start-note">
                    {problem}
                  </p>
                ))}
              </>
            ) : (
              <p className="start-text">Оборотно-сальдовая ведомость по счёту 1210 за первый месяц учёта, по контрагентам и договорам</p>
            )}
            {since ? <p className="start-state">учёт оплат с {formatDay(since)}</p> : null}
            {openings && !since ? button("since", `Начать учёт с ${openings.since ? formatDay(openings.since) : "-"} и перенести сальдо`) : null}
            {!files && !since ? (
              <div className="onec-rest">
                <label className="start-note" htmlFor={`rest-${base.id}`}>
                  Остатки 1210 из 1С на
                </label>
                <input
                  id={`rest-${base.id}`}
                  type="date"
                  className="input-field onec-rest-day"
                  value={restDay}
                  onChange={(event) => {
                    const value = event.target.value;
                    // Учёт - с первого числа месяца: любой выбранный день становится первым числом его месяца.
                    if (value) setRestDay(`${value.slice(0, 7)}-01`);
                  }}
                />
                <button type="button" className="btn-ghost start-go" disabled={blocked} onClick={() => void takeRest()}>
                  {busy === "rest" ? "Читаем 1С…" : "Взять из 1С"}
                </button>
              </div>
            ) : null}
            <button type="button" className="fin-link-btn start-aside" disabled={blocked} onClick={() => file.current?.click()}>
              {busy === "osv" ? "Читаем ОСВ…" : openings ? "Другая ОСВ" : "Загрузить ОСВ"}
            </button>
            <input
              ref={file}
              type="file"
              accept=".xlsx,.xls,.csv,.htm,.html,.xml"
              className="intake-input"
              onChange={(event) => {
                const picked = event.target.files?.[0];
                event.target.value = "";
                if (picked) void sendOsv(picked);
              }}
            />
          </div>
        </li>

        <li className="start-step" data-done={plan.payments.source === "1c" || files ? "" : undefined}>
          <span className="start-n">5</span>
          <div className="start-body">
            <p className="start-title">Оплаты</p>
            {files ? (
              <p className="start-text">
                В выгрузке 1С поступлений нет - оплаты юрлица из выписок банка: загрузите их в «Файлах компании»
              </p>
            ) : plan.payments.source === "1c" ? (
              <p className="start-state">поступления 1С - оплаты юрлица</p>
            ) : (
              <>
                <p className="start-text">Поступления и возвраты покупателям из 1С</p>
                {button("payments", "Брать оплаты из 1С")}
              </>
            )}
          </div>
        </li>

        <li className="start-step">
          <span className="start-n">6</span>
          <div className="start-body">
            <p className="start-title">Нам должны</p>
            <button
              type="button"
              className={next ? "btn-ghost" : "btn-primary"}
              onClick={() =>
                openSection({
                  section: "debts",
                  session: { "core.debts.view": "contracts", "core.debts.side": "receivable", "core.debts.group": "client" },
                })
              }
            >
              Открыть «Долги»
            </button>
          </div>
        </li>
          </>
        )}
      </ol>
    </section>
  );
}
