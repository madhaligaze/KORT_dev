"use client";

/**
 * «Сегодня» - главный экран (этап 3): решить, под угрозой, пришло.
 *
 * Всё - вызовами API модели (`/finance/model`), а не маршрутами экранов:
 * * «Решить» - вопросы ядра одним списком (`ask questions`): оплаты без
 *   договора, БИН из источников, двойники участников, сверка с таблицей. У
 *   варианта ответа - пачка команд; щелчок - «предложить» (что изменится, до
 *   записи), затем «применить» с отпечатком предложения. Вопрос уходит, когда
 *   ушла его причина в данных, «Вернуть» возвращает его.
 * * «Под угрозой» - пункты ядра порознь (`ask attention`): медленный не держит
 *   быстрые. Щелчок ведёт туда, где пункт раскрыт списком.
 * * «Пришло» - факты журнала, впервые записанные за неделю (`ask arrived`).
 * * «С чего начать» - первые шаги компании по порядку (`ask start`), пока они не
 *   пройдены: наше юрлицо, договоры, начало учёта, деньги. Пустая компания видела
 *   здесь «Вопросов нет» и «Акты подписаны» (проход новичка 31.10).
 *
 * Строка внизу - после действия («Применено … · Вернуть»), в покое молчит.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import {
  type ArrivedAnswer,
  type AttentionItem,
  type ModelCommand,
  type ModelOpen,
  type ModelProposal,
  type ModelQuestion,
  type QuestionOption,
  type HomeStartAnswer,
  type HomeStartStep,
  coreApi,
  formatDate,
  modelApi,
} from "@/components/finance/api";
import { REGIMES } from "@/components/finance/core/words";
import { contractMoney, formatDay, plural } from "@/components/finance/format";
import { ArrowRightIcon } from "@/components/icons";
import { useSessionScope, writeSession } from "@/components/session-state";

const KIND_ORDER = ["payments", "bins", "twins", "reconcile"];
/** Порядок работы с месяцем: выставить, закрыть актом, получить деньги; ниже - что впереди. */
const ITEM_ORDER = ["unbilled", "acts", "debts", "cash", "vat"];
const WEEKDAY = new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

type Load<T> = { value: T | null; error: string };
type Kind = { rows: ModelQuestion[]; count: number; shown: number };

/** Вид вопросов - подзаголовком: очередь читается группами, а не лентой из сотни карточек. */
const KIND_TITLES: Record<string, string> = {
  payments: "Оплаты без договора",
  bins: "БИН участников",
  twins: "Двойники участников",
  reconcile: "Сверка с таблицей",
};
/** Заголовок карточки, который повторил бы подзаголовок группы, - не пишется: «Возврат клиенту?» остаётся. */
const KIND_CARD_TITLES: Record<string, string> = {
  payments: "Оплата без договора",
  bins: "БИН участника",
  twins: "Похоже на одного участника",
  reconcile: "Сверка с таблицей",
};
/** Сколько вопросов вида видно сразу; остальные пришедшие - «Показать ещё», все - списком в разделе. */
const FIRST = 5;

/** Остальные вопросы вида - списком в своём разделе: очередь показывает последние. */
const MORE_TARGET: Record<string, { title: string; section: string; session: Record<string, string> }> = {
  payments: { title: "оплаты без договора", section: "shadow", session: { "core.shadow.what": "payments", "core.shadow.paid.view": "without" } },
  bins: { title: "БИН участников", section: "participants", session: { "core.parties.view": "all" } },
  twins: { title: "двойники участников", section: "participants", session: { "core.parties.view": "twins" } },
};
type Live = { text: string; point: string | null; failed?: boolean } | null;

function messageOf(exc: unknown, fallback: string): string {
  return exc instanceof Error && exc.message ? exc.message : fallback;
}

function money(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "-";
  return contractMoney(Math.round(Number(value)));
}

function isoDaysAgo(days: number): string {
  const day = new Date();
  day.setDate(day.getDate() - days);
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
}

/** Куда ведёт пункт: раздел и что в нём выбрать (состояние экрана пишется до перехода). */
function targetOf(open: ModelOpen, unbilled: string | null): { section: string; session: Record<string, string> } | null {
  if ("place" in open) {
    if (open.place === "vat") return { section: "vat", session: {} };
    if (open.place === "reconcile") return { section: "shadow", session: { "core.shadow.what": "accruals", "core.shadow.view": "proposals" } };
    return null;
  }
  const params = open.params ?? {};
  switch (open.source) {
    case "debts":
      return {
        section: "debts",
        session: {
          "core.debts.view": "contracts",
          "core.debts.side": params.side ?? "receivable",
          "core.debts.group": params.group ?? "client",
          "core.debts.basis": params.basis ?? "accruals",
        },
      };
    case "documents":
      return { section: "shadow", session: { "core.shadow.what": "acts", "core.shadow.acts.view": params.view ?? "missing" } };
    case "unbilled":
      return unbilled ? { section: unbilled, session: {} } : { section: "invoices", session: {} };
    case "calendar":
      return { section: "cash-calendar", session: {} };
    default:
      return null;
  }
}

export function HomeScreen({ onGo, unbilledSection }: { onGo: (section: string) => void; unbilledSection: string | null }) {
  const scope = useSessionScope();
  const [kinds, setKinds] = useState<string[] | null>(null);
  const [items, setItems] = useState<string[]>([]);
  const [showArrived, setShowArrived] = useState(false);
  const [questions, setQuestions] = useState<Record<string, Load<Kind>>>({});
  const [attention, setAttention] = useState<Record<string, Load<AttentionItem>>>({});
  const [arrived, setArrived] = useState<Load<ArrivedAnswer>>({ value: null, error: "" });
  const [revision, setRevision] = useState(0);
  const [live, setLive] = useState<Live>(null);
  const [describeError, setDescribeError] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [showStart, setShowStart] = useState(false);
  const [start, setStart] = useState<HomeStartAnswer | null>(null);

  useEffect(() => {
    let alive = true;
    modelApi
      .describe()
      .then((described) => {
        if (!alive) return;
        setKinds(KIND_ORDER.filter((kind) => described.home.questions.includes(kind)));
        setItems(ITEM_ORDER.filter((item) => described.home.attention.includes(item)));
        setShowArrived(described.home.arrived);
        setShowStart(Boolean(described.home.start));
      })
      .catch((exc) => alive && setDescribeError(messageOf(exc, "Схема компании не прочиталась")));
    return () => {
      alive = false;
    };
  }, []);

  const loadKind = useCallback((kind: string, signal?: AbortSignal) => {
    modelApi
      .questions(kind, { signal })
      .then((answer) => {
        const meta = answer.kinds[kind];
        const value = { rows: answer.rows, count: meta?.count ?? answer.rows.length, shown: meta?.shown ?? answer.rows.length };
        setQuestions((was) => ({ ...was, [kind]: { value, error: "" } }));
      })
      .catch((exc) => {
        if (signal?.aborted) return;
        setQuestions((was) => ({ ...was, [kind]: { value: null, error: messageOf(exc, "Не посчиталось") } }));
      });
  }, []);

  const loadItem = useCallback((item: string, signal?: AbortSignal) => {
    modelApi
      .attention(item, { signal })
      .then((answer) => setAttention((was) => ({ ...was, [item]: { value: answer.rows[0] ?? null, error: "" } })))
      .catch((exc) => {
        if (signal?.aborted) return;
        setAttention((was) => ({ ...was, [item]: { value: null, error: messageOf(exc, "Не посчиталось") } }));
      });
  }, []);

  const loadArrived = useCallback((signal?: AbortSignal) => {
    modelApi
      .arrived(isoDaysAgo(7), { signal })
      .then((answer) => setArrived({ value: answer, error: "" }))
      .catch((exc) => !signal?.aborted && setArrived({ value: null, error: messageOf(exc, "Не прочиталось") }));
  }, []);

  const loadStart = useCallback((signal?: AbortSignal) => {
    modelApi
      .start({ signal })
      .then(setStart)
      // Шаги - подсказка, а не данные: не прочитались - экран живёт без них.
      .catch(() => !signal?.aborted && setStart(null));
  }, []);

  useEffect(() => {
    if (kinds === null) return;
    const controller = new AbortController();
    for (const kind of kinds) loadKind(kind, controller.signal);
    for (const item of items) loadItem(item, controller.signal);
    if (showArrived) loadArrived(controller.signal);
    if (showStart) loadStart(controller.signal);
    return () => controller.abort();
  }, [kinds, items, showArrived, showStart, revision, loadKind, loadItem, loadArrived, loadStart]);

  const open = (target: ModelOpen | null | undefined) => {
    if (!target) return;
    const where = targetOf(target, unbilledSection);
    if (!where) return;
    for (const [key, value] of Object.entries(where.session)) writeSession(scope, key, value);
    onGo(where.section);
  };

  // Ответ записан: вопросы того же вида, угрозы и пришедшее - заново; строка внизу говорит, что сделано.
  const answered = (kind: string, title: string, point: string | null) => {
    setLive({ text: title, point });
    loadKind(kind);
    for (const item of items) loadItem(item);
    if (showArrived) loadArrived();
  };

  const undo = async () => {
    if (!live?.point) return;
    try {
      const back = await modelApi.undo(live.point);
      setLive({ text: `Вернули: ${back.title}`, point: null });
    } catch (exc) {
      setLive({ text: messageOf(exc, "Вернуть не получилось"), point: null, failed: true });
    }
    for (const kind of kinds ?? []) loadKind(kind);
    for (const item of items) loadItem(item);
    if (showArrived) loadArrived();
  };

  const total = (kinds ?? []).reduce((sum, kind) => sum + (questions[kind]?.value?.count ?? 0), 0);
  const groups = (kinds ?? []).flatMap((kind) => {
    const value = questions[kind]?.value;
    return value && value.rows.length ? [{ kind, value }] : [];
  });
  const showAll = (kind: string) => {
    const target = MORE_TARGET[kind];
    if (!target) return;
    for (const [key, item] of Object.entries(target.session)) writeSession(scope, key, item);
    onGo(target.section);
  };
  const waiting = (kinds ?? []).filter((kind) => !questions[kind]);
  const failed = (kinds ?? []).filter((kind) => questions[kind]?.error);
  const loaded = items.map((item) => ({ key: item, slot: attention[item] }));
  const busy = loaded.filter((entry) => !entry.slot?.value?.empty);
  const calm = loaded.filter((entry) => entry.slot?.value?.empty);
  // Денег ещё не приходило - и вопросов о них быть не может: «KORT разложил всё» было бы неправдой.
  const noMoney = start?.rows.some((step) => step.key === "money" && !step.done) ?? false;

  return (
    <div className="home-screen">
      <div className="today-head">
        <p className="today-date">{WEEKDAY.format(new Date())}</p>
        <button type="button" className="btn-ghost btn-sm" onClick={() => setRevision((value) => value + 1)}>
          Пересчитать
        </button>
      </div>
      {describeError ? <p className="home-refusal">{describeError}</p> : null}
      {start && !start.done ? (
        <StartBlock
          steps={start.rows}
          onGo={onGo}
          onChanged={() => {
            loadStart();
            for (const item of items) loadItem(item);
          }}
        />
      ) : null}
      <div className="home-grid">
        <section className="home-col" aria-labelledby="home-decide">
          <h2 id="home-decide" className="home-head">
            Решить
            {total ? <span className="home-count">{total}</span> : null}
          </h2>
          {kinds !== null && !total && !waiting.length && !failed.length ? (
            <p className="home-calm">
              {noMoney
                ? "Вопросы появятся, когда в KORT придут выписки банка или 1С."
                : "Вопросов нет. KORT разложил всё, что пришло."}
            </p>
          ) : null}
          {waiting.length && !groups.length ? <p className="today-loading">Собираем вопросы…</p> : null}
          {failed.map((kind) => (
            <p key={kind} className="home-refusal">
              {questions[kind]?.error}
            </p>
          ))}
          {groups.map(({ kind, value }) => {
            const unfolded = expanded.has(kind);
            const shown = unfolded ? value.rows : value.rows.slice(0, FIRST);
            return (
              <section key={kind} className="home-kind" aria-label={KIND_TITLES[kind]}>
                <h3 className="home-kind-head">
                  {KIND_TITLES[kind]}
                  <span className="home-count">{value.count}</span>
                </h3>
                <ol className="home-questions">
                  {shown.map((question) => (
                    <li key={question.key}>
                      <QuestionCard
                        question={question}
                        titled={question.title !== KIND_CARD_TITLES[kind]}
                        onDone={(title, point) => answered(kind, title, point)}
                        onPlace={(place) => open({ place })}
                      />
                    </li>
                  ))}
                </ol>
                <div className="home-kind-more">
                  {!unfolded && value.rows.length > FIRST ? (
                    <button type="button" className="fin-link-btn" onClick={() => setExpanded((was) => new Set(was).add(kind))}>
                      Показать ещё {value.rows.length - FIRST}
                    </button>
                  ) : null}
                  {value.count > shown.length && MORE_TARGET[kind] ? (
                    <button type="button" className="fin-link-btn" onClick={() => showAll(kind)}>
                      Все {value.count} - списком
                    </button>
                  ) : null}
                </div>
              </section>
            );
          })}
        </section>
        <section className="home-col" aria-labelledby="home-risk">
          <h2 id="home-risk" className="home-head">
            Под угрозой
          </h2>
          {busy.map(({ key, slot }) => (
            <AttentionCard key={key} slot={slot} onOpen={open} />
          ))}
          {calm.length ? (
            <div className="today-calm" aria-label="Угроз нет">
              {calm.map(({ key, slot }) => (
                <button key={key} type="button" className="today-calm-item" onClick={() => open(slot?.value?.open)}>
                  <span className="today-calm-title">{slot?.value?.title}</span>
                  <span className="fin-soft">{slot?.value?.empty}</span>
                </button>
              ))}
            </div>
          ) : null}
        </section>
      </div>
      {showArrived ? <ArrivedBlock load={arrived} /> : null}
      <div className="home-live" aria-live="polite">
        {live ? (
          <>
            <span className={live.failed ? "home-refusal" : undefined}>{live.text}</span>
            {live.point ? (
              <button type="button" className="btn-ghost btn-sm" onClick={() => void undo()}>
                Вернуть
              </button>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}

// ── С чего начать ────────────────────────────────────────────────────────────

/** Чем занят шаг, пока до него не дошли: одна строка, без действий. */
const STEP_AHEAD: Record<HomeStartStep["key"], string> = {
  entity: "БИН и режим налогов",
  contracts: "От договоров KORT считает начисления и счета",
  since: "С какого дня считать оплаты и счета",
  money: "Выписка банка или 1С",
};

/** Пачка команд ядра: предложить, отказ - словами, применить. */
async function applyCommands(commands: ModelCommand[]) {
  const proposal = await modelApi.propose(commands);
  if (proposal.problems.length) throw new Error(proposal.problems.map((problem) => problem.detail).join("; "));
  return modelApi.apply(commands, proposal.base);
}

/**
 * Первые шаги по порядку: что KORT делает - одной фразой, и четыре шага до
 * первых чисел. Действие есть только у текущего: человек не выбирает, с чего
 * начать, а отвечает на один вопрос за раз. Пройденный шаг остаётся тихой
 * строкой, будущий - одной подписью. Юрлицо и начало учёта отвечаются здесь
 * же, на месте; договор и выписка ведут туда, где их заводят, и экран
 * возвращает сюда. Шаг закрывают данные: файлы могут закрыть сразу несколько.
 */
function StartBlock({ steps, onGo, onChanged }: { steps: HomeStartStep[]; onGo: (section: string) => void; onChanged: () => void }) {
  const scope = useSessionScope();
  const now = steps.find((step) => !step.done);
  const position = now ? steps.indexOf(now) + 1 : steps.length;

  const action = (step: HomeStartStep) => {
    switch (step.key) {
      case "entity":
        return <EntityStep step={step} onDone={onChanged} />;
      case "contracts":
        return (
          <div className="home-step-acts">
            <button
              type="button"
              className="btn-primary btn-sm"
              onClick={() => {
                // Сразу карточка нового договора: пустой реестр - лишний шаг до неё.
                writeSession(scope, "registry.new", {});
                onGo("contracts");
              }}
            >
              Завести договор
            </button>
            <button type="button" className="btn-ghost btn-sm" onClick={() => onGo("contracts-import")}>
              Загрузить из Excel
            </button>
          </div>
        );
      case "since":
        return <SinceStep step={step} onDone={onChanged} />;
      case "money":
        return (
          <div className="home-step-acts">
            <button type="button" className="btn-primary btn-sm" onClick={() => onGo("import")}>
              Загрузить выписку банка
            </button>
            <button type="button" className="btn-ghost btn-sm" onClick={() => onGo("integrations")}>
              Подключить 1С
            </button>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <section className="home-start" aria-labelledby="home-start">
      <h2 id="home-start" className="home-head">
        С чего начать
        <span className="home-count">
          шаг {position} из {steps.length}
        </span>
      </h2>
      <p className="home-start-lead">
        KORT по вашим договорам считает, сколько вам должны и сколько денег придёт. Выписки банка и 1С он сам
        раскладывает по договорам, а что не смог разложить - спрашивает здесь.
      </p>
      <ol className="home-steps">
        {steps.map((step, index) => {
          const state = step.done ? "done" : step === now ? "now" : "ahead";
          return (
            <li key={step.key} className="home-step" data-state={state}>
              <span className="home-step-num">{String(index + 1).padStart(2, "0")}</span>
              <div className="home-step-body">
                <span className="home-step-title">{step.title}</span>
                <span className="home-step-text">
                  {state === "done" ? `готово · ${step.text}` : state === "now" ? step.text : STEP_AHEAD[step.key]}
                </span>
              </div>
              {state === "now" ? <div className="home-step-now">{action(step)}</div> : null}
            </li>
          );
        })}
      </ol>
      {!steps[1]?.done ? (
        <p className="home-start-files">
          <button type="button" className="fin-link-btn" onClick={() => onGo("start")}>
            Реестр, выписки и 1С уже есть файлами? Загрузить всё сразу
          </button>
        </p>
      ) : null}
    </section>
  );
}

/** Шаг 1: наше юрлицо, БИН и режим - прямо здесь, без карточки и второго экрана. */
function EntityStep({ step, onDone }: { step: HomeStartStep; onDone: () => void }) {
  const adding = !step.entity;
  const needs = step.needs ?? { bin: true, regime: true };
  const [name, setName] = useState("");
  const [bin, setBin] = useState("");
  const [regime, setRegime] = useState<(typeof REGIMES)[number]["value"]>("general");
  const [vat, setVat] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      let id = step.entity ?? "";
      if (adding) {
        const done = await applyCommands([{ command: "entity.create", params: { name: name.trim(), ...(bin.trim() ? { bin: bin.trim() } : {}) } }]);
        id = String(done.commands[0]?.result?.id ?? "");
      } else if (needs.bin) {
        await coreApi.setBin(id, bin.trim());
      }
      if ((adding || needs.regime) && id) {
        // С начала года: режим редко меняется; другая дата - в карточке юрлица.
        await coreApi.addTaxPeriod(id, { valid_from: `${new Date().getFullYear()}-01-01`, regime, vat_payer: regime === "general" && vat });
      }
      onDone();
    } catch (exc) {
      setError(messageOf(exc, "Не записалось"));
    } finally {
      setBusy(false);
    }
  };

  const ready = (!adding || name.trim()) && (!(adding || needs.bin) || bin.trim());
  return (
    <form
      className="home-step-form"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      {adding ? (
        <input
          className="input-field"
          aria-label="Название нашего юрлица"
          placeholder="ТОО «Название»"
          value={name}
          autoFocus
          onChange={(event) => setName(event.target.value)}
        />
      ) : null}
      {adding || needs.bin ? (
        <input
          className="input-field home-step-bin"
          aria-label="БИН"
          placeholder="БИН"
          inputMode="numeric"
          value={bin}
          autoFocus={!adding}
          onChange={(event) => setBin(event.target.value)}
        />
      ) : null}
      {adding || needs.regime ? (
        <>
          <select
            className="input-field"
            aria-label="Режим налогов"
            value={regime}
            onChange={(event) => {
              const next = event.target.value as typeof regime;
              setRegime(next);
              if (next !== "general") setVat(false);
            }}
          >
            {REGIMES.map((item) => (
              <option key={item.value} value={item.value}>
                {item.title}
              </option>
            ))}
          </select>
          <label className="party-check">
            <input type="checkbox" checked={vat} disabled={regime !== "general"} onChange={(event) => setVat(event.target.checked)} />
            плательщик НДС
          </label>
        </>
      ) : null}
      <button type="submit" className="btn-primary btn-sm" disabled={busy || !ready}>
        {busy ? "Записываем…" : "Записать"}
      </button>
      {error ? <p className="home-refusal home-step-wide">{error}</p> : null}
    </form>
  );
}

/** Шаг 3: начало учёта - один ответ, от него зависят и долги, и список счетов. */
function SinceStep({ step, onDone }: { step: HomeStartStep; onDone: () => void }) {
  const [other, setOther] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const first = step.first ?? "";
  const current = step.current ?? "";

  const choose = async (since: string) => {
    setBusy(true);
    setError("");
    try {
      await applyCommands([{ command: "accounting.start", params: { since } }]);
      onDone();
    } catch (exc) {
      setError(messageOf(exc, "Не записалось"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="home-step-since">
      <p className="home-step-note">Месяцы раньше этого дня KORT считает закрытыми: не ждёт за них ни оплат, ни счетов.</p>
      <div className="home-step-acts">
        {first ? (
          <button type="button" className="btn-primary btn-sm" disabled={busy} onClick={() => void choose(first)}>
            С первого начисления · {formatDay(first)}
          </button>
        ) : null}
        {current && current !== first ? (
          <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => void choose(current)}>
            С этого месяца · {formatDay(current)}
          </button>
        ) : null}
        <input
          className="input-field home-step-date"
          type="date"
          aria-label="Другая дата начала учёта"
          value={other}
          onChange={(event) => setOther(event.target.value)}
        />
        {other ? (
          <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => void choose(other)}>
            С этой даты
          </button>
        ) : null}
      </div>
      {error ? <p className="home-refusal">{error}</p> : null}
    </div>
  );
}

// ── Вопрос ───────────────────────────────────────────────────────────────────

function QuestionCard({
  question,
  titled,
  onDone,
  onPlace,
}: {
  question: ModelQuestion;
  titled: boolean;
  onDone: (title: string, point: string | null) => void;
  onPlace: (place: string) => void;
}) {
  const [option, setOption] = useState<QuestionOption | null>(null);
  const [picking, setPicking] = useState(false);
  const [commands, setCommands] = useState<ModelCommand[] | null>(null);
  const [proposal, setProposal] = useState<ModelProposal | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const titles = new Map(question.objects.filter((item) => item.type === "contract").map((item) => [item.id, item.title ?? ""]));

  const reset = () => {
    setOption(null);
    setPicking(false);
    setCommands(null);
    setProposal(null);
    setError("");
  };

  const propose = async (chosen: QuestionOption, extra: Record<string, unknown> = {}) => {
    const pack = chosen.commands.map((item) => ({ command: item.command, params: { ...item.params, ...extra } }));
    setOption(chosen);
    setPicking(false);
    setCommands(pack);
    setProposal(null);
    setError("");
    setBusy(true);
    try {
      setProposal(await modelApi.propose(pack));
    } catch (exc) {
      setError(messageOf(exc, "Предложение не посчиталось"));
    } finally {
      setBusy(false);
    }
  };

  const choose = (chosen: QuestionOption) => {
    if (chosen.place) {
      onPlace(chosen.place);
      return;
    }
    if (option?.key === chosen.key && (proposal || picking)) {
      reset();
      return;
    }
    if (chosen.needs.length) {
      setOption(chosen);
      setPicking(true);
      setProposal(null);
      setError("");
      return;
    }
    void propose(chosen);
  };

  const apply = async () => {
    if (!commands || !proposal) return;
    setBusy(true);
    setError("");
    try {
      const done = await modelApi.apply(commands, proposal.base);
      const title = done.commands[0]?.title ?? option?.title ?? "Записано";
      onDone(done.commands.length > 1 ? `${title} и ещё ${done.commands.length - 1}` : title, done.point?.id ?? null);
    } catch (exc) {
      setError(messageOf(exc, "Не записалось"));
      setBusy(false);
    }
  };

  const suggested = question.options.find((item) => item.key === question.suggested) ?? null;
  const ordered = suggested ? [suggested, ...question.options.filter((item) => item !== suggested)] : question.options;

  // В группе вид уже назван подзаголовком: оплата - плательщиком, остальное - самим текстом вопроса.
  const payer = question.kind === "payment" && !titled;
  const heading = titled ? question.title : payer ? question.party || "плательщик не указан" : "";
  // Сумма и дата - уже в заголовке: под плательщиком - назначение платежа (и сколько оплат, если их несколько).
  const operation = question.objects.find((item) => item.type === "operation");
  const purpose = operation?.comment ? `«${operation.comment}»` : "без назначения";
  const many = question.count && question.count > 1 ? `${question.count} ${plural(question.count, "оплата", "оплаты", "оплат")}: ` : "";
  const lead = payer ? `${many}${purpose}` : question.text;
  return (
    <article className="home-q" aria-busy={busy}>
      <header className="home-q-head" hidden={!heading && !question.amount && !question.day}>
        <span className="home-q-title">{heading}</span>
        <span className="home-q-meta">
          {question.amount ? (
            <span className={question.direction === "in" ? "fin-in fin-num" : "fin-num"}>
              {question.direction === "in" ? "+" : question.direction === "out" ? "−" : ""}
              {money(question.amount)}
            </span>
          ) : null}
          {question.day ? <span className="fin-soft">{formatDate(question.day)}</span> : null}
        </span>
      </header>
      <p className="home-q-text">{lead}</p>
      {question.reason ? <p className="home-q-reason">{question.reason}</p> : null}
      <div className="home-q-options">
        {ordered.map((item) => (
          <button
            key={item.key}
            type="button"
            className={item === suggested ? "btn-primary btn-sm" : "btn-ghost btn-sm"}
            disabled={!item.open || busy}
            aria-pressed={option?.key === item.key}
            title={item.open ? item.hint || undefined : "Делает владелец или администратор"}
            onClick={() => choose(item)}
          >
            {item.title}
          </button>
        ))}
      </div>
      {picking && option ? <ContractPicker onPick={(id) => void propose(option, { contract: id })} onCancel={reset} /> : null}
      {proposal ? <Proposal proposal={proposal} titles={titles} busy={busy} onApply={() => void apply()} onCancel={reset} /> : null}
      {busy && !proposal ? <p className="today-loading">Считаем, что изменится…</p> : null}
      {error ? <p className="home-refusal">{error}</p> : null}
    </article>
  );
}

function Proposal({
  proposal,
  titles,
  busy,
  onApply,
  onCancel,
}: {
  proposal: ModelProposal;
  titles: Map<string, string>;
  busy: boolean;
  onApply: () => void;
  onCancel: () => void;
}) {
  const debts = proposal.changes.filter((item) => item.debt);
  return (
    <div className="home-prop" role="group" aria-label="Что изменится">
      <span className="home-prop-k">что изменится, до записи</span>
      {proposal.ready ? (
        <ul className="home-prop-list">
          {debts.length
            ? debts.map((item) => (
                <li key={item.id}>
                  {item.number || titles.get(item.id) || "договор"}: долг {money(item.debt?.before)} → {money(item.debt?.after)}
                </li>
              ))
            : proposal.commands.map((item) => <li key={item.command}>{item.title}</li>)}
        </ul>
      ) : (
        <ul className="home-prop-list">
          {proposal.problems.map((item) => (
            <li key={item.command} className="home-refusal">
              {item.detail}
            </li>
          ))}
        </ul>
      )}
      <div className="home-q-options">
        {proposal.ready ? (
          <button type="button" className="btn-primary btn-sm" disabled={busy} onClick={onApply}>
            Применить
          </button>
        ) : null}
        <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={onCancel}>
          Отмена
        </button>
      </div>
    </div>
  );
}

function ContractPicker({ onPick, onCancel }: { onPick: (id: string) => void; onCancel: () => void }) {
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<{ id: string; number: string; customer: string; executor: string }[]>([]);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement | null>(null);

  useEffect(() => input.current?.focus(), []);
  useEffect(() => {
    const text = query.trim();
    if (text.length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      coreApi
        .searchContracts(text, { signal: controller.signal })
        .then((answer) => {
          setFound(answer.items.slice(0, 8));
          setError("");
        })
        .catch((exc) => !controller.signal.aborted && setError(messageOf(exc, "Поиск не ответил")));
    }, 200);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query]);

  // Короче двух букв - не ищем, и прежний ответ не показываем.
  const shown = query.trim().length >= 2 ? found : [];
  return (
    <div className="home-prop" role="group" aria-label="Выбрать договор">
      <label className="home-prop-k" htmlFor="home-contract-pick">
        договор - номер или клиент
      </label>
      <input
        id="home-contract-pick"
        ref={input}
        className="input-field"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => event.key === "Escape" && onCancel()}
        autoComplete="off"
      />
      {shown.length ? (
        <ul className="home-pick-list">
          {shown.map((item) => (
            <li key={item.id}>
              <button type="button" className="home-pick" onClick={() => onPick(item.id)}>
                <span className="mono">{item.number || "без номера"}</span>
                <span>{item.customer}</span>
                <span className="fin-soft">{item.executor}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : query.trim().length >= 2 && !error ? (
        <p className="fin-soft">Не нашлось</p>
      ) : null}
      {error ? <p className="home-refusal">{error}</p> : null}
      <div className="home-q-options">
        <button type="button" className="btn-ghost btn-sm" onClick={onCancel}>
          Отмена
        </button>
      </div>
    </div>
  );
}

// ── Под угрозой ──────────────────────────────────────────────────────────────

function AttentionCard({ slot, onOpen }: { slot: Load<AttentionItem> | undefined; onOpen: (open: ModelOpen | null | undefined) => void }) {
  const item = slot?.value;
  if (!item) {
    return (
      <section className="today-card" aria-busy={!slot?.error}>
        <p className={slot?.error ? "home-refusal" : "today-loading"}>{slot?.error || "Считаем…"}</p>
      </section>
    );
  }
  const value = item.amount !== null ? money(item.amount) : item.count !== null ? String(item.count) : "-";
  const unit =
    item.unit === "договоров"
      ? plural(item.count ?? 0, "договор", "договора", "договоров")
      : item.unit === "дел"
        ? plural(item.count ?? 0, "дело", "дела", "дел")
        : item.unit === "счетов"
          ? plural(item.count ?? 0, "счёт", "счёта", "счетов")
          : item.unit === "разрывов"
            ? plural(item.count ?? 0, "разрыв", "разрыва", "разрывов")
            : item.unit;
  return (
    <section className="today-card">
      <button type="button" className="today-card-head" onClick={() => onOpen(item.open)} disabled={!item.open}>
        <span className="today-title">{item.title}</span>
        {item.open ? <ArrowRightIcon size={14} /> : null}
      </button>
      <p className="today-value">
        <span className="fin-kpi-value">{value}</span>
        {item.count && (item.amount !== null || unit) ? (
          <span className="today-unit">
            {item.amount !== null ? `${item.count} ` : ""}
            {unit}
          </span>
        ) : null}
      </p>
      {item.lines.length ? (
        <ul className="today-lines">
          {item.lines.map((line) => (
            <li key={line.label}>
              <button type="button" className="today-line" onClick={() => onOpen(line.open ?? item.open)}>
                <span className="today-line-label">{line.label}</span>
                <span className="fin-num">
                  {line.amount !== undefined && line.amount !== null ? money(line.amount) : line.count !== undefined ? line.count : ""}
                  {line.of ? <span className="fin-soft"> из {line.of}</span> : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {item.note ? <p className="today-note">{item.note.replace(/(\d+\.\d{2})/, (match) => money(match))}</p> : null}
    </section>
  );
}

// ── Пришло ───────────────────────────────────────────────────────────────────

function ArrivedBlock({ load }: { load: Load<ArrivedAnswer> }) {
  const answer = load.value;
  if (!answer) {
    return (
      <section className="home-arrived" aria-labelledby="home-came">
        <h2 id="home-came" className="home-head">
          Пришло за неделю
        </h2>
        <p className={load.error ? "home-refusal" : "today-loading"}>{load.error || "Читаем журнал…"}</p>
      </section>
    );
  }
  const payments = answer.payments;
  const others = answer.rows.filter((row) => row.kind !== "payment");
  return (
    <section className="home-arrived" aria-labelledby="home-came">
      <h2 id="home-came" className="home-head">
        Пришло за неделю
      </h2>
      {!answer.totals.facts ? <p className="home-calm">Ничего нового</p> : null}
      {payments.count ? (
        <p className="home-arrived-line">
          {payments.count} {plural(payments.count, "оплата", "оплаты", "оплат")} на{" "}
          <span className="fin-in fin-num">{money(payments.amount)}</span>
          <span className="fin-soft">
            {" "}
            · {payments.placed} {plural(payments.placed, "разложена", "разложены", "разложены")} по договорам
            {payments.without ? ` · ${payments.without} без договора` : ""}
          </span>
        </p>
      ) : null}
      {others.length ? (
        <p className="home-arrived-line fin-soft">{others.map((row) => `${row.title}: ${row.count}`).join(" · ")}</p>
      ) : null}
      {answer.latest.length ? (
        <details className="home-latest">
          <summary>Последние {answer.latest.length}</summary>
          <ul>
            {answer.latest.map((item, index) => (
              <li key={`${item.kind}-${item.day}-${index}`}>
                <span className="fin-soft">{item.day ? formatDate(item.day) : ""}</span>
                <span>{item.title}</span>
                <span className="mono">{item.contract?.number || ""}</span>
                <span>{item.party}</span>
                <span className={item.kind === "payment" && Number(item.amount) > 0 ? "fin-in fin-num" : "fin-num"}>{money(item.amount)}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
