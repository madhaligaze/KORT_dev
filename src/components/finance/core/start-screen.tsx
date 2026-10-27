"use client";

/**
 * «Первые шаги» (ядро, фаза 9): компания со сводной таблицей - от пустого
 * реестра до «Долгов» за один заход.
 *
 * Строка таблицы - договор за месяц (у BBC - «Сводка все ЮР лица»). KORT
 * читает её и предлагает модель шагами: наши юрлица по кодам «Наша Фирма»,
 * договоры по строкам без договора, начало учёта с входящим сальдо из
 * таблицы - и сразу «Нам должны». Каждый шаг до записи показывает числа, а
 * пачка договоров и сальдо возвращается одной кнопкой (и в «Восстановлении»
 * кабинета). Спорные строки - номер у другого клиента, несколько кандидатов -
 * KORT не заводит: их решает человек в «Сверке».
 *
 * Состояние шага - словами и весом: сделанный шаг говорит, что сделано,
 * следующий - единственная плита на экране.
 */
import { useCallback, useEffect, useState } from "react";

import {
  type StartDone,
  type StartPlan,
  type StartStep,
  contractsApi,
  coreApi,
} from "@/components/finance/api";
import { BookColumns } from "@/components/finance/core/book-columns";
import { IntakeFiles } from "@/components/finance/core/intake-files";
import { OnecStart } from "@/components/finance/core/onec-start";
import { openSection } from "@/components/finance/core/open";
import { contractMoney, formatDay, plural } from "@/components/finance/format";
import { useSessionState } from "@/components/session-state";

function messageOf(exc: unknown, fallback: string): string {
  return exc instanceof Error && exc.message ? exc.message : fallback;
}

function count(value: number): string {
  return value.toLocaleString("ru-RU");
}

function money(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "-";
  return contractMoney(Math.round(Number(value)));
}

/** Сколько групп строк без договора показать сразу. */
const FIRST = 12;

export function StartScreen() {
  const [plan, setPlan] = useState<StartPlan | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState<StartStep | "connect" | "">("");
  const [done, setDone] = useState<Partial<Record<StartStep, StartDone>>>({});
  const [all, setAll] = useState(false);

  useEffect(() => {
    let alive = true;
    coreApi
      .start()
      .then((next) => {
        if (!alive) return;
        setPlan(next);
        setError(next.error);
      })
      .catch((exc) => alive && setError(messageOf(exc, "Первые шаги не прочитались")));
    return () => {
      alive = false;
    };
  }, [revision]);
  const reload = useCallback(() => setRevision((value) => value + 1), []);

  const run = async (step: StartStep) => {
    setBusy(step);
    setError("");
    try {
      const result = await coreApi.startStep(step);
      setDone((was) => ({ ...was, [step]: result }));
      reload();
    } catch (exc) {
      setError(messageOf(exc, "Шаг не записался"));
    } finally {
      setBusy("");
    }
  };

  const undo = async (step: StartStep) => {
    const point = done[step]?.point;
    if (!point) return;
    setBusy(step);
    try {
      await contractsApi.restorePoints.restore(point.id);
      setDone((was) => ({ ...was, [step]: undefined }));
      reload();
    } catch (exc) {
      setError(messageOf(exc, "Не вернулось"));
    } finally {
      setBusy("");
    }
  };

  if (!plan) {
    return (
      <div className="start-screen">
        <p className="creg-empty">{error || "Читаем сводную таблицу…"}</p>
      </div>
    );
  }
  if (!plan.connected) {
    // Компания без сводной таблицы начинает с файлов: приёмник называет, что в них.
    return (
      <div className="start-screen">
        <IntakeFiles onChanged={reload} />
        <OnecStart revision={revision} />
        <Connect onConnected={reload} />
      </div>
    );
  }
  if (!plan.book || !plan.entities || !plan.contracts || !plan.since || !plan.openings) {
    // Таблица подключена, но не читается: чаще всего колонки названы по-своему - их называют здесь же.
    return (
      <div className="start-screen">
        <p className="party-error">{error || "Сводная таблица ещё читается"}</p>
        <button type="button" className="btn-ghost start-go" onClick={reload}>
          Прочитать снова
        </button>
        <BookColumns onChanged={reload} />
      </div>
    );
  }

  const entities = plan.entities;
  const contracts = plan.contracts;
  const since = plan.since;
  const openings = plan.openings;
  const missingCodes = entities.items.filter((item) => !item.id).map((item) => item.code);
  // Следующий шаг - единственная плита: первый, где есть что делать.
  const next: StartStep | "" = entities.missing
    ? "entities"
    : contracts.missing
      ? "contracts"
      : !since.current || openings.new
        ? "since"
        : "";
  const groups = all ? contracts.groups : contracts.groups.slice(0, FIRST);
  const sinceDay = since.current ?? since.proposed;

  return (
    <div className="start-screen">
      <p className="start-book">
        {plan.book.title || "Сводная таблица"} · лист «{plan.book.worksheet}» · {count(plan.book.rows)}{" "}
        {plural(plan.book.rows, "строка", "строки", "строк")}, с договорами KORT связано {count(plan.book.matched)}
      </p>
      {error ? <p className="party-error">{error}</p> : null}

      <ol className="start-steps">
        <li className="start-step" data-done={!entities.missing ? "" : undefined}>
          <span className="start-n">1</span>
          <div className="start-body">
            <p className="start-title">Наши юрлица</p>
            <p className="start-text">
              {entities.items.map((item) => `${item.code} - ${count(item.rows)}`).join(" · ") || "в «Наша Фирма» пусто"}
            </p>
            {entities.missing ? (
              <>
                <p className="start-text">Нет в KORT: {missingCodes.join(", ")}</p>
                <StepButton step="entities" next={next} busy={busy} onRun={run}>
                  Завести {count(entities.missing)} {plural(entities.missing, "юрлицо", "юрлица", "юрлиц")}
                </StepButton>
              </>
            ) : (
              <p className="start-state">все коды таблицы - наши юрлица</p>
            )}
          </div>
        </li>

        <li className="start-step" data-done={!contracts.missing ? "" : undefined}>
          <span className="start-n">2</span>
          <div className="start-body">
            <p className="start-title">Договоры</p>
            <p className="start-text">
              {[
                `в KORT ${count(contracts.total)} ${plural(contracts.total, "договор", "договора", "договоров")}`,
                contracts.missing ? `по строкам таблицы - ещё ${count(contracts.missing)}` : "",
                contracts.disputed ? `спорных ${count(contracts.disputed)}` : "",
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {contracts.missing ? (
              <>
                <ul className="start-groups">
                  {groups.map((group) => (
                    <li key={group.key} className="start-group">
                      <span className="start-group-what">
                        <span className="fin-strong">{group.customer || "-"}</span>
                        <span className="start-note">
                          {[group.number || "без номера", group.own, `${group.months.length} ${plural(group.months.length, "месяц", "месяца", "месяцев")}`]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </span>
                      <span className="start-group-sum">{money(group.amount)}</span>
                    </li>
                  ))}
                </ul>
                {contracts.groups.length > groups.length ? (
                  <button type="button" className="fin-link-btn" onClick={() => setAll(true)}>
                    Показать {count(contracts.groups.length)}
                    {contracts.missing > contracts.groups.length ? ` из ${count(contracts.missing)}` : ""}
                  </button>
                ) : null}
                <StepButton step="contracts" next={next} busy={busy} onRun={run}>
                  Завести {count(contracts.missing)} {plural(contracts.missing, "договор", "договора", "договоров")}
                </StepButton>
              </>
            ) : done.contracts?.point ? (
              <p className="start-state">
                заведено {count(done.contracts.done ?? 0)} ·{" "}
                <button type="button" className="fin-link-btn" disabled={Boolean(busy)} onClick={() => void undo("contracts")}>
                  вернуть
                </button>
              </p>
            ) : null}
            {contracts.disputed ? (
              <button
                type="button"
                className="fin-link-btn start-aside"
                onClick={() => openSection({ section: "shadow", session: { "core.shadow.what": "accruals", "core.shadow.view": "unknown" } })}
              >
                Спорные строки - в «Сверке»
              </button>
            ) : null}
          </div>
        </li>

        <li className="start-step" data-done={since.current && !openings.new ? "" : undefined}>
          <span className="start-n">3</span>
          <div className="start-body">
            <p className="start-title">Начало учёта и сальдо</p>
            <p className="start-text">
              {[
                since.current
                  ? `оплаты ведутся с ${formatDay(since.current)}`
                  : `начало - ${formatDay(since.proposed)}, последний наступивший месяц таблицы с «Сальдо Начало»`,
                openings.new
                  ? `сальдо у ${count(openings.new)} ${plural(openings.new, "договора", "договоров", "договоров")} на ${money(openings.debt)}`
                  : openings.same
                    ? `сальдо перенесено у ${count(openings.same)}`
                    : contracts.missing
                      ? "сальдо - после договоров"
                      : "сальдо на этот день в таблице нет",
              ].join(" · ")}
            </p>
            {!since.current || openings.new ? (
              <StepButton step="since" next={next} busy={busy} onRun={run}>
                {since.current ? "Перенести сальдо" : `Начать учёт с ${formatDay(since.proposed)}`}
              </StepButton>
            ) : (
              <p className="start-state">
                учёт идёт
                {done.since?.point ? (
                  <>
                    {" · "}
                    <button type="button" className="fin-link-btn" disabled={Boolean(busy)} onClick={() => void undo("since")}>
                      вернуть сальдо
                    </button>
                  </>
                ) : null}
              </p>
            )}
          </div>
        </li>

        <li className="start-step" data-done={plan.debts ? "" : undefined}>
          <span className="start-n">4</span>
          <div className="start-body">
            <p className="start-title">Долги</p>
            {plan.debts ? (
              <>
                <p className="start-owed">
                  Нам должны <span className="fin-strong">{money(plan.debts.owed)}</span> по {count(plan.debts.contracts)}{" "}
                  {plural(plan.debts.contracts, "договору", "договорам", "договорам")}
                  {Number(plan.debts.advance) ? ` · аванс ${money(plan.debts.advance)}` : ""}
                </p>
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
              </>
            ) : (
              <p className="start-text">после шага 3</p>
            )}
          </div>
        </li>
      </ol>
    </div>
  );
}

function StepButton({
  step,
  next,
  busy,
  onRun,
  children,
}: {
  step: StartStep;
  next: StartStep | "";
  busy: StartStep | "connect" | "";
  onRun: (step: StartStep) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={next === step ? "btn-primary start-go" : "btn-ghost start-go"}
      disabled={Boolean(busy)}
      onClick={() => onRun(step)}
    >
      {busy === step ? "Записываем…" : children}
    </button>
  );
}

/** Шаг 0: подключить сводную таблицу - та же запись, что «Настроить реестр → Сводка оплат». */
function Connect({ onConnected }: { onConnected: () => void }) {
  const [link, setLink] = useSessionState("start.link", "");
  const [sheet, setSheet] = useSessionState("start.sheet", "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <form
      className="start-connect"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError("");
        try {
          await contractsApi.setup.connectSummary(link.trim(), sheet.trim());
          onConnected();
        } catch (exc) {
          setError(messageOf(exc, "Таблица не подключилась"));
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="start-title">Сводная таблица</p>
      <p className="start-text">Google Таблица, где строка - договор за месяц</p>
      <label className="start-field">
        <span className="fin-label">Ссылка на таблицу</span>
        <input
          className="input-field"
          value={link}
          placeholder="https://docs.google.com/spreadsheets/d/…"
          onChange={(event) => setLink(event.target.value)}
          required
        />
      </label>
      <label className="start-field">
        <span className="fin-label">Лист</span>
        <input className="input-field" value={sheet} placeholder="Сводка" onChange={(event) => setSheet(event.target.value)} required />
      </label>
      {error ? <p className="party-error">{error}</p> : null}
      <button type="submit" className="btn-primary start-go" disabled={busy || !link.trim() || !sheet.trim()}>
        {busy ? "Читаем таблицу…" : "Подключить"}
      </button>
    </form>
  );
}
