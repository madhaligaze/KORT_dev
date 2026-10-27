"use client";

/**
 * Вход из 1С в «Первых шагах»: компания с базой 1С в интернете и ОСВ по 1210
 * - до «Нам должны», без таблиц.
 *
 * Сервер (`core/onec_start.py`) считает каждый шаг до записи: наше юрлицо по
 * БИН организации, участники по БИН с написаниями 1С, договоры с условиями по
 * актам, сальдо из ОСВ, источник оплат. Здесь шаги показаны числами, а
 * единственный вопрос - «договор закончился?», когда акты кончились раньше
 * прошлого месяца: без ответа такой договор не заводится. Следующий шаг -
 * единственная плита на экране.
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

export function OnecStart() {
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
  }, []);
  if (!bases || !bases.length) return null;
  return (
    <>
      {bases.map((base) => (
        <BaseSteps key={base.id} base={base} />
      ))}
    </>
  );
}

function BaseSteps({ base }: { base: OnecBase }) {
  const [plan, setPlan] = useState<OnecStartPlan | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<OnecStartStep | "osv" | "">("");
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
  }, [base.id, revision]);
  const reload = useCallback(() => setRevision((value) => value + 1), []);

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
  const contractsToMake = plan.contracts.new + plan.contracts.questions.length - unanswered.length;
  const openings = plan.openings;
  const since = plan.since.current;
  const next: OnecStartStep | "" = !plan.entity.id
    ? "entity"
    : toParty
      ? "participants"
      : contractsToMake
        ? "contracts"
        : openings && !since
          ? "since"
          : plan.payments.source !== "1c"
            ? "payments"
            : "";

  const button = (step: OnecStartStep, label: string) => (
    <button
      type="button"
      className={next === step ? "btn-primary start-go" : "btn-ghost start-go"}
      disabled={Boolean(busy)}
      onClick={() => void run(step)}
    >
      {busy === step ? "Записываем…" : label}
    </button>
  );
  const back = (step: OnecStartStep) =>
    points[step] ? (
      <button type="button" className="fin-link-btn start-aside" disabled={Boolean(busy)} onClick={() => void undo(step)}>
        Вернуть
      </button>
    ) : null;

  return (
    <section className="onec-start" aria-label={`Из 1С: ${base.title}`}>
      <p className="start-title">Из 1С · {base.title}</p>
      <p className="start-text">
        {plan.base.organization}
        {plan.base.bin ? ` · БИН ${plan.base.bin}` : ""}
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
                plan.contracts.new ? `заведём ${plan.contracts.new}` : "",
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {plan.contracts.questions.map((question) => (
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
            {contractsToMake ? button("contracts", `Завести ${contractsToMake} ${plural(contractsToMake, "договор", "договора", "договоров")}`) : null}
            {back("contracts")}
          </div>
        </li>

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
            <button type="button" className="fin-link-btn start-aside" disabled={Boolean(busy)} onClick={() => file.current?.click()}>
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

        <li className="start-step" data-done={plan.payments.source === "1c" ? "" : undefined}>
          <span className="start-n">5</span>
          <div className="start-body">
            <p className="start-title">Оплаты</p>
            {plan.payments.source === "1c" ? (
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
      </ol>
    </section>
  );
}
