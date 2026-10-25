"use client";

/**
 * «Сверка → Оплаты» - оплаты KORT против книги-сводки (ядро, фаза 4).
 *
 * Оплаты - операции журнала (выписки, журнал ГК) или поступления 1С - KORT
 * разносит сам: к договору (сторона, счёт юрлица, номер договора из журнала)
 * и к месяцу («за какой месяц», иначе старейший долг). Экран - для того, кто
 * переводит учёт в KORT: с какого дня KORT ведёт оплаты и откуда они у
 * каждого юрлица, где KORT видит по договору другие деньги, чем книга,
 * какие поступления не нашли договор, и входящее сальдо на начало учёта -
 * перенести из книги пачкой.
 */
import { useEffect, useMemo, useState } from "react";

import { type PaymentWithout, type PaymentsView, coreApi, formatMonth } from "@/components/finance/api";
import { DateInput } from "@/components/finance/ui/date-picker";
import { ConfirmDialog } from "@/components/finance/ui/confirm-dialog";
import { bareNumber, contractMoney, formatDay, formatTime, parseDay, plural } from "@/components/finance/format";
import { useSessionState } from "@/components/session-state";

type View = "lines" | "without" | "opening";

function messageOf(exc: unknown, fallback: string): string {
  return exc instanceof Error && exc.message ? exc.message : fallback;
}

function money(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "-";
  return contractMoney(value);
}

/** Ключ чипа «без статьи»: пустая строка уже значит «все». */
const NO_CATEGORY = "\u0000";

const WHY: Record<PaymentWithout["candidates"][number]["why"], string> = {
  спор: "спор",
  номер: "по номеру",
  клиент: "тот же клиент",
  сумма: "та же сумма",
};

export function PaymentsShadow({ onOpen, closed }: { onOpen: (id: string | null) => void; closed: number }) {
  const [view, setView] = useSessionState<View>("core.shadow.paid.view", "lines");
  const [data, setData] = useState<PaymentsView | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [loaded, setLoaded] = useState(-1);
  const loading = loaded !== revision;
  const [note, setNote] = useState("");
  useEffect(() => {
    let alive = true;
    coreApi
      .payments()
      .then((next) => {
        if (!alive) return;
        setData(next);
        setError(next.error);
      })
      .catch((exc) => alive && setError(messageOf(exc, "Оплаты не сверились")))
      .finally(() => alive && setLoaded(revision));
    return () => {
      alive = false;
    };
  }, [revision, closed]);
  const reload = (text: string) => {
    setNote(text);
    setRevision((value) => value + 1);
  };
  const shadow = data?.shadow ?? null;
  const counts = shadow?.counts ?? {};
  const opening = data?.opening ?? null;
  const openingChanges = opening ? opening.counts.new + opening.counts.changed + opening.counts.remove : 0;
  return (
    <>
      <div className="shadow-bar">
        <p className="shadow-source">
          {data?.book
            ? `${data.book.title || "Сводная таблица"} · прочитана в ${formatTime(data.book.read_at)}${
                shadow?.window.length ? ` · ${formatMonth(shadow.window[0])} - ${formatMonth(shadow.window[shadow.window.length - 1])}` : ""
              }`
            : loading
              ? "Читаем сводную таблицу…"
              : ""}
        </p>
        <button type="button" className="btn-ghost btn-sm" disabled={loading} onClick={() => setRevision((value) => value + 1)}>
          {loading ? "Сверяем…" : "Сверить заново"}
        </button>
      </div>

      {data ? <Settings key={data.settings.since_used ?? ""} data={data} onChanged={reload} /> : null}

      <div className="fin-kpis">
        <div className="fin-kpi">
          <span className="fin-kpi-label">Совпадает</span>
          <span className="fin-kpi-value">{shadow ? `${counts.same ?? 0} из ${counts.contracts ?? 0}` : "-"}</span>
          <span className="fin-kpi-label">{shadow ? `месяцев ${counts.months_same ?? 0} из ${counts.months ?? 0}` : "договоров"}</span>
        </div>
        {(
          [
            ["lines", "Расходится", shadow ? shadow.lines.length : null, "договоров"],
            ["without", "Без договора", data ? data.without.length : null, "поступлений"],
            ["opening", "Входящее сальдо", opening ? openingChanges : null, "к переносу"],
          ] as [View, string, number | null, string][]
        ).map(([key, title, value, unit]) => (
          <button
            key={key}
            type="button"
            className="fin-kpi fin-kpi-pick"
            data-on={view === key ? "" : undefined}
            onClick={() => setView(key)}
          >
            <span className="fin-kpi-label">{title}</span>
            <span className="fin-kpi-value">{value ?? "-"}</span>
            <span className="fin-kpi-label">{unit}</span>
          </button>
        ))}
      </div>

      {error ? <p className="party-error">{error}</p> : null}
      {note ? (
        <p className="shadow-note" role="status">
          {note}
        </p>
      ) : null}

      {!data ? (
        <p className="creg-empty">{loading ? "Сверяем оплаты с таблицей…" : ""}</p>
      ) : view === "lines" ? (
        <PaidLines data={data} onOpen={onOpen} />
      ) : view === "without" ? (
        <Without data={data} onOpen={onOpen} onDecided={reload} />
      ) : (
        <Opening data={data} onOpen={onOpen} onApplied={reload} />
      )}
    </>
  );
}

/** Начало учёта оплат и источник оплат каждого нашего юрлица. */
function Settings({ data, onChanged }: { data: PaymentsView; onChanged: (text: string) => void }) {
  const used = data.settings.since_used;
  const [since, setSince] = useState(used ? formatDay(used) : "");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const save = async (key: string, body: Parameters<typeof coreApi.paymentSettings>[0], text: string) => {
    setBusy(key);
    setError("");
    try {
      await coreApi.paymentSettings(body);
      onChanged(text);
    } catch (exc) {
      setError(messageOf(exc, "Не записалось"));
    } finally {
      setBusy("");
    }
  };
  const iso = parseDay(since);
  const rules: ["categories" | "payers", string][] = [
    ...data.settings.ignore.categories.map((name) => ["categories", name] as ["categories", string]),
    ...data.settings.ignore.payers.map((name) => ["payers", name] as ["payers", string]),
  ];
  return (
    <div className="paid-settings">
      <div className="paid-since">
        <span className="fin-label">Учёт оплат с</span>
        <DateInput value={since} onChange={setSince} ariaLabel="Учёт оплат с" className="input-field party-date" />
        {iso && iso !== data.settings.since ? (
          <button type="button" className="btn-ghost btn-sm" disabled={busy === "since"} onClick={() => void save("since", { since: iso }, `Оплаты ведутся с ${formatDay(iso)}`)}>
            Записать
          </button>
        ) : null}
        <span className="fin-muted">
          {data.settings.since ? "задано" : used ? "по первой оплате" : "оплат ещё нет"} · до этого дня долг - входящее сальдо
        </span>
        {data.settings.since ? (
          <button
            type="button"
            className="fin-link-btn"
            disabled={busy === "since"}
            onClick={() => void save("since", { since: null }, "Начало учёта оплат - по первой оплате")}
          >
            По первой оплате
          </button>
        ) : null}
      </div>
      <div className="paid-sources" role="list" aria-label="Откуда оплаты юрлиц">
        {/* Юрлицо без единой оплаты ни в журнале, ни в 1С - выбирать нечего. */}
        {data.entities.filter((entity) => entity.journal || entity.onec || entity.source !== "journal").map((entity) => (
          <div key={entity.id} className="paid-source" role="listitem">
            <span className="paid-source-name">{entity.code || entity.name}</span>
            <span className="fin-mine paid-source-pick" role="group" aria-label={`Оплаты ${entity.code || entity.name}`}>
              {(
                [
                  ["journal", "Журнал", entity.journal],
                  ["1c", "1С", entity.onec],
                ] as ["journal" | "1c", string, number][]
              ).map(([source, title, count]) => (
                <button
                  key={source}
                  type="button"
                  className="fin-chip"
                  data-on={entity.source === source ? "" : undefined}
                  disabled={busy === entity.id || entity.source === source}
                  onClick={() =>
                    void save(entity.id, { entity_id: entity.id, source }, `Оплаты ${entity.code || entity.name} - из ${source === "1c" ? "1С" : "журнала"}`)
                  }
                >
                  {title} {count}
                </button>
              ))}
            </span>
          </div>
        ))}
      </div>
      {rules.length ? (
        <p className="paid-ignore">
          <span className="fin-label">Не оплаты по договорам</span>
          {rules.map(([kind, name]) => (
            <span key={`${kind}:${name}`} className="paid-ignore-item">
              {kind === "categories" ? "статья" : "плательщик"} «{name}»
              <button
                type="button"
                className="fin-link-btn"
                disabled={busy === `${kind}:${name}`}
                onClick={async () => {
                  setBusy(`${kind}:${name}`);
                  setError("");
                  try {
                    await coreApi.paymentIgnore(kind, name, false);
                    onChanged(`${kind === "categories" ? "Статья" : "Плательщик"} «${name}» - снова оплаты по договорам`);
                  } catch (exc) {
                    setError(messageOf(exc, "Не записалось"));
                  } finally {
                    setBusy("");
                  }
                }}
              >
                Вернуть
              </button>
            </span>
          ))}
        </p>
      ) : null}
      {error ? <p className="ifield-error">{error}</p> : null}
    </div>
  );
}

function ContractCell({ data, id, onOpen }: { data: PaymentsView; id: string; onOpen: (id: string) => void }) {
  const contract = data.shadow?.contracts[id];
  return (
    <span className="shadow-contract">
      <button type="button" className="fin-link-btn creg-num" onClick={() => onOpen(id)}>
        {bareNumber(contract?.number) || "без номера"}
      </button>
      <span className="shadow-client">{contract?.customer || "-"}</span>
      {contract?.executor ? <span className="annot">{contract.executor}</span> : null}
    </span>
  );
}

const PAID_CODE_TITLES = { paid: "сумма", paid_no_kort: "нет у KORT", paid_no_book: "нет в таблице" } as const;

/** Договоры, где KORT видит другие деньги, чем книга: итог за окно и месяцы. */
function PaidLines({ data, onOpen }: { data: PaymentsView; onOpen: (id: string) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!data.shadow) return <p className="creg-empty">{data.error || "Сводная таблица не прочитана"}</p>;
  if (!data.shadow.lines.length) return <p className="creg-empty">Оплаты KORT и таблицы совпадают</p>;
  return (
    <div className="fin-card overflow-x-auto">
      <table className="fin-table shadow-table paid-table">
        <thead>
          <tr>
            <th>Договор</th>
            <th style={{ textAlign: "right" }}>KORT</th>
            <th style={{ textAlign: "right" }}>Таблица</th>
            <th style={{ textAlign: "right" }}>Разница</th>
            <th>Месяцы</th>
          </tr>
        </thead>
        <tbody>
          {data.shadow.lines.map((line) => {
            const contract = data.shadow?.contracts[line.contract_id];
            const differ = line.months.filter((month) => month.code);
            const shown = open === line.contract_id;
            return (
              <tr key={line.contract_id}>
                <td>
                  <ContractCell data={data} id={line.contract_id} onOpen={onOpen} />
                </td>
                <td className="fin-num">
                  {money(contract?.kort)}
                  {contract?.opening_paid && Number(contract.opening_paid) ? (
                    <span className="fin-bills-note">и в сальдо {money(contract.opening_paid)}</span>
                  ) : null}
                  {contract?.over ? <span className="fin-bills-note">сверх начислений {money(contract.over)}</span> : null}
                </td>
                <td className="fin-num">{money(contract?.book)}</td>
                <td className={`fin-num${Number(line.diff) ? " fin-out" : ""}`}>{Number(line.diff) ? money(line.diff) : "-"}</td>
                <td>
                  <button type="button" className="fin-link-btn" aria-expanded={shown} onClick={() => setOpen(shown ? null : line.contract_id)}>
                    {differ.length
                      ? `${differ.length} ${plural(differ.length, "месяц", "месяца", "месяцев")} врозь`
                      : "по месяцам"}
                  </button>
                  {shown ? (
                    <div className="paid-months">
                      {line.months.map((month) => (
                        <div key={month.month} className="paid-month" data-off={month.code ? "true" : undefined}>
                          <span>{formatMonth(month.month, true)}</span>
                          <span className="fin-num">{money(month.kort)}</span>
                          <span className="fin-num">{money(month.book)}</span>
                          <span className="paid-month-code">{month.code ? PAID_CODE_TITLES[month.code] : ""}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Поступления журнала без договора - с кандидатами и решением человека. */
function Without({ data, onOpen, onDecided }: { data: PaymentsView; onOpen: (id: string) => void; onDecided: (text: string) => void }) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [gone, setGone] = useState<Set<string>>(() => new Set());
  const [category, setCategory] = useSessionState("core.shadow.paid.category", "");
  const categories = useMemo(() => {
    const seen = new Map<string, number>();
    for (const item of data.without) {
      const key = item.category || NO_CATEGORY;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    return [...seen.entries()].sort((a, b) => b[1] - a[1]);
  }, [data.without]);
  const items = data.without.filter(
    (item) => !gone.has(item.operation_id) && (!category || (item.category || NO_CATEGORY) === category),
  );
  const hidden = data.without_hidden;
  /** Статья или плательщик целиком - «не оплаты по договорам»: уходит всё, что под правило. */
  const ignore = async (kind: "categories" | "payers", name: string) => {
    setBusy(`${kind}:${name}`);
    setError("");
    try {
      await coreApi.paymentIgnore(kind, name, true);
      setCategory("");
      onDecided(`${kind === "categories" ? "Статья" : "Плательщик"} «${name}» - не оплаты по договорам`);
    } catch (exc) {
      setError(messageOf(exc, "Не записалось"));
    } finally {
      setBusy("");
    }
  };
  const decide = async (item: PaymentWithout, action: "link" | "none", contractId?: string, number?: string) => {
    setBusy(item.operation_id);
    setError("");
    try {
      await coreApi.paymentDecide(item.operation_id, { action, ...(contractId ? { contract_id: contractId } : {}) });
      setGone((current) => new Set(current).add(item.operation_id));
      onDecided(
        action === "link"
          ? `Оплата ${formatDay(item.paid_at)} на ${money(item.amount)} - к договору ${bareNumber(number) || "без номера"}`
          : `Оплата ${formatDay(item.paid_at)} на ${money(item.amount)} - не по договору`,
      );
    } catch (exc) {
      setError(messageOf(exc, "Не записалось"));
    } finally {
      setBusy("");
    }
  };
  const hiddenText = [
    hidden?.own ? `переводы со своих юрлиц ${hidden.own}` : "",
    hidden?.ignored ? `не оплаты по договорам ${hidden.ignored}` : "",
    hidden?.decided ? `решено «не по договору» ${hidden.decided}` : "",
  ].filter(Boolean);
  if (!data.without.length) {
    return (
      <p className="creg-empty">
        Все поступления нашли договор{hiddenText.length ? ` · скрыто: ${hiddenText.join(" · ")}` : ""}
      </p>
    );
  }
  return (
    <div className="paid-without">
      {hiddenText.length ? <p className="paid-hidden">Скрыто: {hiddenText.join(" · ")}</p> : null}
      {categories.length > 1 ? (
        <div className="fin-mine shadow-codes" role="group" aria-label="Статья">
          <button type="button" className="fin-chip" data-on={category === "" ? "" : undefined} onClick={() => setCategory("")}>
            Все {data.without.length}
          </button>
          {categories.map(([name, count]) => (
            <button key={name} type="button" className="fin-chip" data-on={category === name ? "" : undefined} onClick={() => setCategory(name)}>
              {name === NO_CATEGORY ? "без статьи" : name} {count}
            </button>
          ))}
        </div>
      ) : null}
      {category && category !== NO_CATEGORY ? (
        <p className="paid-rule">
          <button type="button" className="fin-link-btn" disabled={Boolean(busy)} onClick={() => void ignore("categories", category)}>
            Статья «{category}» - не оплаты по договорам
          </button>
        </p>
      ) : null}
      {error ? <p className="party-error">{error}</p> : null}
      {items.map((item) => (
        <div key={item.operation_id} className="paid-item" data-id={item.operation_id}>
          <span className="paid-item-when fin-mono">{formatDay(item.paid_at)}</span>
          <span className="paid-item-sum">{money(item.amount)}</span>
          <span className="paid-item-who">
            <span>
              {item.payer || "плательщик не указан"}
              {item.contract_ref ? <span className="annot">{item.contract_ref}</span> : null}
              {item.hint ? <span className="annot">за {formatMonth(item.hint[0], true)}</span> : null}
            </span>
            {item.comment ? <small>{item.comment}</small> : null}
            <small className="fin-muted">{[item.account, item.category].filter(Boolean).join(" · ")}</small>
          </span>
          <span className="paid-item-acts">
            {item.candidates.map((candidate) => (
              <span key={candidate.id} className="paid-candidate">
                <button
                  type="button"
                  className="fin-link-btn"
                  disabled={busy === item.operation_id}
                  onClick={() => void decide(item, "link", candidate.id, candidate.number)}
                >
                  К {bareNumber(candidate.number) || "договору"}
                </button>
                <button type="button" className="fin-link-btn fin-muted" onClick={() => onOpen(candidate.id)}>
                  {candidate.customer || "договор"}
                </button>
                <span className="annot">{WHY[candidate.why]}</span>
              </span>
            ))}
            <button type="button" className="fin-link-btn" disabled={busy === item.operation_id} onClick={() => void decide(item, "none")}>
              Не по договору
            </button>
            {item.payer ? (
              <button
                type="button"
                className="fin-link-btn"
                disabled={Boolean(busy)}
                onClick={() => void ignore("payers", item.payer)}
              >
                Всё от «{item.payer}» - не оплаты
              </button>
            ) : null}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Входящее сальдо на начало учёта - из книги, пачкой. */
function Opening({ data, onOpen, onApplied }: { data: PaymentsView; onOpen: (id: string) => void; onApplied: (text: string) => void }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const plan = data.opening;
  if (!data.settings.since_used) return <p className="creg-empty">Оплат ещё нет - начало учёта не определено</p>;
  if (!plan) return <p className="creg-empty">{data.error || "Сводная таблица не прочитана"}</p>;
  // Сальдо два - по начислениям и по АВР; переносятся договоры, у которых сменилось хоть одно.
  const changes = new Set(plan.items.map((item) => item.contract_id)).size;
  return (
    <div className="paid-opening">
      <p className="paid-opening-text">
        На {formatDay(plan.since)} по таблице: по начислениям долг {money(plan.debt)}, аванс {money(plan.advance)} · по АВР
        долг {money(plan.acts_debt)}, аванс {money(plan.acts_advance)}
        {plan.counts.same ? ` · уже в KORT ${plan.counts.same}` : ""}
        {plan.counts.manual ? ` · поставлено вручную ${plan.counts.manual} - таблица их не меняет` : ""}
      </p>
      {changes ? (
        <>
          <button type="button" className="btn-primary" disabled={busy} onClick={() => setConfirm(true)}>
            Перенести сальдо · {changes} {plural(changes, "договор", "договора", "договоров")}
          </button>
          <div className="fin-card overflow-x-auto">
            <table className="fin-table shadow-table">
              <thead>
                <tr>
                  <th>Договор</th>
                  <th>Сальдо</th>
                  <th style={{ textAlign: "right" }}>Было в KORT</th>
                  <th style={{ textAlign: "right" }}>По таблице</th>
                  <th>Строка таблицы</th>
                </tr>
              </thead>
              <tbody>
                {plan.items.map((item) => (
                  <tr key={`${item.contract_id}-${item.basis}`}>
                    <td>
                      <button type="button" className="fin-link-btn creg-num" onClick={() => onOpen(item.contract_id)}>
                        {bareNumber(item.number) || "без номера"}
                      </button>
                    </td>
                    <td className="fin-muted">{item.basis === "acts" ? "по АВР" : "по начислениям"}</td>
                    <td className="fin-num">{money(item.was)}</td>
                    <td className="fin-num">{item.state === "remove" ? "снять" : money(item.amount)}</td>
                    <td className="fin-muted">{item.line || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p className="creg-empty">Сальдо в KORT такое же, как в таблице</p>
      )}
      {error ? <p className="party-error">{error}</p> : null}
      <ConfirmDialog
        open={confirm}
        title={`Перенести входящее сальдо на ${formatDay(plan.since)}: ${changes} ${plural(changes, "договор", "договора", "договоров")}?`}
        text="Оплаты будут гасить сальдо по начислениям раньше начислений; сальдо по АВР - начало долга по актам. Вернуть всё разом - «Восстановление» в личном кабинете."
        confirm="Перенести"
        busy={busy}
        onCancel={() => setConfirm(false)}
        onConfirm={async () => {
          setBusy(true);
          setError("");
          try {
            const done = await coreApi.paymentsOpening();
            setConfirm(false);
            onApplied(`Входящее сальдо перенесено: ${done.done} ${plural(done.done, "договор", "договора", "договоров")}`);
          } catch (exc) {
            setConfirm(false);
            setError(messageOf(exc, "Сальдо не перенеслось"));
          } finally {
            setBusy(false);
          }
        }}
      />
    </div>
  );
}
