"use client";

/**
 * «Сверка → Переход» (ядро, фаза 10): готово ли каждое звено у каждого нашего ТОО.
 *
 * Строка - наше юрлицо, колонка - звено цепочки: начисления, счета к
 * выставлению, оплаты, АВР 1С против таблицы, сальдо. В клетке - сколько
 * месяцев договоров совпало с таблицей из сверенных; строки таблицы, которые
 * KORT не связал ни с одним договором, считаются несовпавшими: при переходе
 * именно их KORT не напомнит. Каждое звено - своим запросом (`core/switch/{link}`):
 * сверка читает всю таблицу, и готовая колонка не ждёт остальных.
 *
 * Звено, которое KORT уже умеет вести сам (счета к выставлению и оплаты),
 * переключается у юрлица кнопкой в клетке. Перед переключением окно
 * показывает последствия: у счетов - какие появятся в «Не выставлены», какие
 * уйдут, у каких сменится срок; у оплат - у каких договоров «Оплачено»
 * станет другим. Решает человек, а не порог: расхождение бывает и ошибкой
 * таблицы. Вернуть на таблицу - той же кнопкой.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import {
  type Bill,
  type SwitchEntity,
  type SwitchLinkKey,
  type SwitchPaymentsPreview,
  type SwitchPreview,
  type SwitchSource,
  type SwitchSources,
  type SwitchTally,
  coreApi,
  formatMoney,
  formatMonth,
} from "@/components/finance/api";
import { formatDay, plural } from "@/components/finance/format";
import { useScrollLock } from "@/components/use-scroll-lock";

const LINKS: SwitchLinkKey[] = ["accruals", "bills", "payments", "acts", "saldo"];

function messageOf(exc: unknown, fallback: string): string {
  return exc instanceof Error && exc.message ? exc.message : fallback;
}

function count(value: number): string {
  return value.toLocaleString("ru-RU");
}

type Tally = SwitchTally | { error: string; entities?: undefined; switchable?: undefined };

/** Звено своим запросом; `undefined` - ответ на последний запрос ещё не пришёл. */
function useTally(link: SwitchLinkKey, revision: number): Tally | undefined {
  const [slot, setSlot] = useState<{ revision: number; tally: Tally } | null>(null);
  useEffect(() => {
    const control = new AbortController();
    coreApi
      .switchLink(link, { signal: control.signal })
      .then((tally) => setSlot({ revision, tally }))
      .catch((exc) => {
        if (!control.signal.aborted) setSlot({ revision, tally: { error: messageOf(exc, "Сверка не прочиталась") } });
      });
    return () => control.abort();
  }, [link, revision]);
  return slot && slot.revision === revision ? slot.tally : undefined;
}

const NONE: Record<SwitchLinkKey, number> = { accruals: 0, bills: 0, payments: 0, acts: 0, saldo: 0 };

/** `onGo` - открыть сверку звена; с юрлицом - уже выбранной по нему. */
export function SwitchView({ onGo }: { onGo: (link: SwitchLinkKey, entity?: string) => void }) {
  const [sources, setSources] = useState<SwitchSources | null>(null);
  // Своя ревизия у каждого звена: после переключения пересверяется одно звено, а не все пять.
  const [revisions, setRevisions] = useState(NONE);
  const [asking, setAsking] = useState<{ entity: SwitchEntity; source: SwitchSource; link: SwitchLinkKey } | null>(null);
  const [error, setError] = useState("");
  const accruals = useTally("accruals", revisions.accruals);
  const bills = useTally("bills", revisions.bills);
  const payments = useTally("payments", revisions.payments);
  const acts = useTally("acts", revisions.acts);
  const saldo = useTally("saldo", revisions.saldo);
  const tallies: Partial<Record<SwitchLinkKey, Tally>> = { accruals, bills, payments, acts, saldo };

  const loadSources = useCallback(() => {
    coreApi
      .switchSources()
      .then(setSources)
      .catch((exc) => setError(messageOf(exc, "Звенья не прочитались")));
  }, []);
  useEffect(() => {
    loadSources();
  }, [loadSources]);
  const again = (links: SwitchLinkKey[]) =>
    setRevisions((was) => {
      const next = { ...was };
      for (const link of links) next[link] += 1;
      return next;
    });

  const titles = useMemo(() => {
    const out: Partial<Record<SwitchLinkKey, string>> = {};
    for (const link of sources?.links ?? []) out[link.key] = link.title;
    return out;
  }, [sources]);

  // Юрлица - все, что встретились хоть в одном звене; порядок - по коду.
  const entities = useMemo(() => {
    const seen = new Map<string, string>();
    for (const tally of [accruals, bills, payments, acts, saldo]) {
      for (const item of tally?.entities ?? []) seen.set(item.id, item.code);
    }
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1], "ru")).map(([id, code]) => ({ id, code }));
  }, [accruals, bills, payments, acts, saldo]);

  const loading = LINKS.some((link) => tallies[link] === undefined);
  const months = (tallies.accruals as SwitchTally | undefined)?.window ?? [];

  return (
    <>
      <div className="shadow-bar">
        <p className="shadow-source">
          {loading
            ? "Сверяем звенья с таблицей…"
            : months.length
              ? `${entities.length} ${plural(entities.length, "юрлицо", "юрлица", "юрлиц")} · ${formatMonth(months[0])} - ${formatMonth(months[months.length - 1])}`
              : ""}
        </p>
        <button type="button" className="btn-ghost btn-sm" disabled={loading} onClick={() => again(LINKS)}>
          {loading ? "Сверяем…" : "Сверить заново"}
        </button>
      </div>
      {error ? <p className="party-error">{error}</p> : null}
      <div className="switch-grid" role="table" aria-label="Переход по юрлицам и звеньям">
        <div className="switch-row switch-head" role="row">
          <span className="switch-entity" role="columnheader">
            Юрлицо
          </span>
          {LINKS.map((link) => {
            const tally = tallies[link];
            return (
              <span key={link} className="switch-cell" role="columnheader">
                <button type="button" className="fin-link-btn switch-link" onClick={() => onGo(link)}>
                  {titles[link] ?? link}
                </button>
                {tally?.error ? <span className="switch-fail">{tally.error}</span> : null}
              </span>
            );
          })}
        </div>
        {entities.map((entity) => (
          <div key={entity.id} className="switch-row" role="row">
            <span className="switch-entity" role="rowheader">
              {entity.code}
            </span>
            {LINKS.map((link) => {
              const tally = tallies[link];
              const item = tally?.entities?.find((row) => row.id === entity.id);
              return (
                <span key={link} className="switch-cell" role="cell">
                  <span className="switch-cell-title">{titles[link] ?? link}</span>
                  {tally === undefined ? (
                    <span className="fin-muted">сверяем…</span>
                  ) : !item ? (
                    <span className="fin-muted">-</span>
                  ) : (
                    <Cell
                      item={item}
                      switchable={Boolean(tally.switchable)}
                      onAsk={(source) => setAsking({ entity: item, source, link })}
                      onGo={() => onGo(link, item.id)}
                    />
                  )}
                </span>
              );
            })}
          </div>
        ))}
        {!loading && !entities.length ? (
          <p className="creg-empty">
            {LINKS.map((link) => tallies[link]?.error).find(Boolean) || "Сверять нечего: в таблице нет строк наших юрлиц"}
          </p>
        ) : null}
      </div>
      {asking ? (
        <SwitchDialog
          link={asking.link}
          entity={asking.entity}
          source={asking.source}
          onClose={() => setAsking(null)}
          onDone={() => {
            setAsking(null);
            loadSources();
            again([asking.link]);
          }}
        />
      ) : null}
    </>
  );
}

function Cell({
  item,
  switchable,
  onAsk,
  onGo,
}: {
  item: SwitchEntity;
  switchable: boolean;
  onAsk: (source: SwitchSource) => void;
  /** Сверка звена по этому юрлицу - что именно расходится. */
  onGo: () => void;
}) {
  const checked = item.months + item.unknown;
  const differ = item.months - item.same;
  const kort = item.source === "kort";
  return (
    <span className="switch-value">
      {checked ? (
        <button type="button" className={`fin-link-btn switch-main${item.clean ? " fin-strong" : ""}`} onClick={onGo}>
          {count(item.same)} из {count(checked)}
        </button>
      ) : (
        <span className="switch-main">-</span>
      )}
      {item.ready ? (
        <span className="switch-note switch-ready">готово к переходу</span>
      ) : item.clean ? (
        <span className="switch-note">совпадает</span>
      ) : null}
      {differ > 0 ? <span className="switch-note">расходится {count(differ)}</span> : null}
      {!item.ready && item.closed.length ? (
        /* Переход - после закрытых месяцев без расхождений: видно, какой месяц держит. */
        <span className="switch-note">
          {item.closed.map((month) => `${formatMonth(month.month, true)}: ${count(month.same)} из ${count(month.checked)}`).join(" · ")}
        </span>
      ) : null}
      {item.unknown ? (
        <span className="switch-note" title="Строки таблицы, которые KORT не связал ни с одним договором">
          без договора {count(item.unknown)}
        </span>
      ) : null}
      {switchable ? (
        <span className="switch-source">
          <span className={kort ? "fin-strong" : undefined}>{kort ? "из KORT" : "из таблицы"}</span>
          <button type="button" className="fin-link-btn" onClick={() => onAsk(kort ? "book" : "kort")}>
            {kort ? "вернуть на таблицу" : "перевести на KORT"}
          </button>
        </span>
      ) : null}
    </span>
  );
}

const GROUP_WORDS: Record<string, string> = {
  overdue: "просрочен",
  soon: "скоро",
  early: "ещё рано",
  undated: "без срока",
  issued: "выставлен",
};

function BillLine({ bill, note }: { bill: Bill; note?: string }) {
  return (
    <li className="switch-bill">
      <span className="switch-bill-what">
        <span className="fin-strong">{bill.customer || "-"}</span>
        <span className="switch-note">
          {[bill.number, bill.month.toLowerCase(), bill.period_from ? `с ${formatDay(bill.period_from)}` : ""].filter(Boolean).join(" · ")}
        </span>
      </span>
      <span className="switch-bill-sum">{bill.amount && Number(bill.amount) ? formatMoney(bill.amount, { whole: true }) : "-"}</span>
      <span className="switch-note switch-bill-state">{note ?? (bill.text || GROUP_WORDS[bill.group] || "")}</span>
    </li>
  );
}

/** Сколько строк каждого списка показать сразу: остальное - числом и «Показать все». */
const FIRST = 12;

function BillList({ title, bills, notes }: { title: string; bills: Bill[]; notes?: string[] }) {
  const [all, setAll] = useState(false);
  if (!bills.length) return null;
  const shown = all ? bills : bills.slice(0, FIRST);
  return (
    <section className="switch-list">
      <p className="switch-list-title">
        {title} <span className="fin-muted">{count(bills.length)}</span>
      </p>
      <ul>
        {shown.map((bill, index) => (
          <BillLine key={`${bill.id}-${index}`} bill={bill} note={notes?.[index]} />
        ))}
      </ul>
      {bills.length > shown.length ? (
        <button type="button" className="fin-link-btn" onClick={() => setAll(true)}>
          Показать все {count(bills.length)}
        </button>
      ) : null}
    </section>
  );
}

const PAID_CODES: Record<SwitchPaymentsPreview["items"][number]["code"], string> = {
  differ: "расходится",
  table_only: "оплата только в таблице",
  kort_only: "оплата только у KORT",
};

/**
 * Окно перехода звена юрлица. Счета - что станет со списком «Не выставлены»;
 * оплаты - у каких договоров «Оплачено» реестра станет другим и на сколько.
 */
function SwitchDialog({
  link,
  entity,
  source,
  onClose,
  onDone,
}: {
  link: SwitchLinkKey;
  entity: SwitchEntity;
  source: SwitchSource;
  onClose: () => void;
  onDone: () => void;
}) {
  const [bills, setBills] = useState<SwitchPreview | null>(null);
  const [paid, setPaid] = useState<SwitchPaymentsPreview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useScrollLock(true);

  useEffect(() => {
    let alive = true;
    const fail = (exc: unknown) => alive && setError(messageOf(exc, "Не посчиталось, что изменится"));
    if (link === "payments") {
      coreApi
        .switchPaymentsPreview(entity.id, source)
        .then((data) => alive && setPaid(data))
        .catch(fail);
    } else {
      coreApi
        .switchPreview(entity.id, source)
        .then((data) => alive && setBills(data))
        .catch(fail);
    }
    return () => {
      alive = false;
    };
  }, [link, entity.id, source]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const go = async () => {
    setBusy(true);
    setError("");
    try {
      await coreApi.setSwitch(link, entity.id, source);
      onDone();
    } catch (exc) {
      setError(messageOf(exc, "Не переключилось"));
      setBusy(false);
    }
  };

  const toKort = source === "kort";
  const what = link === "payments" ? "Оплаты" : "Счета";
  const title = toKort ? `${what} ${entity.code} - из KORT` : `${what} ${entity.code} - снова из таблицы`;
  const ready = link === "payments" ? paid : bills;

  return createPortal(
    <div
      className="fin-dialog-scrim"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div className="fin-dialog switch-dialog" role="dialog" aria-modal="true" aria-label={title}>
        <h2 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
          {title}
        </h2>
        {!ready && !error ? (
          <p className="text-sm fin-muted">
            {link === "payments" ? "Сравниваем «Оплачено» таблицы и KORT…" : "Считаем, что станет со списком «Не выставлены»…"}
          </p>
        ) : null}
        {bills ? <BillsBody preview={bills} entity={entity} toKort={toKort} /> : null}
        {paid ? <PaymentsBody preview={paid} entity={entity} toKort={toKort} /> : null}
        {toKort && entity.closed.length && ready ? (
          <p className="text-sm">
            {entity.ready ? "Закрытые месяцы без расхождений: " : "Переход - после двух закрытых месяцев без расхождений: "}
            {entity.closed.map((month) => `${formatMonth(month.month, true)} - ${count(month.same)} из ${count(month.checked)}`).join(", ")}.
          </p>
        ) : null}
        {error ? <p className="text-sm fin-bill-fail">{error}</p> : null}
        <div className="switch-actions">
          <button type="button" className="btn-ghost" disabled={busy} onClick={onClose}>
            Отмена
          </button>
          <button type="button" className="btn-primary" disabled={busy || !ready} onClick={() => void go()}>
            {busy ? "Переключаем…" : toKort ? "Перевести на KORT" : "Вернуть на таблицу"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function BillsBody({ preview, entity, toKort }: { preview: SwitchPreview; entity: SwitchEntity; toKort: boolean }) {
  const counts = preview.counts;
  const same = !counts.appear && !counts.vanish && !counts.regroup;
  return (
    <>
      <dl className="switch-counts">
        <div>
          <dt>Не выставлено сейчас</dt>
          <dd>{count(counts.before)}</dd>
        </div>
        <div>
          <dt>Станет</dt>
          <dd className="fin-strong">{count(counts.after)}</dd>
        </div>
        <div>
          <dt>Просрочено</dt>
          <dd>
            {count(counts.overdue_before)} → {count(counts.overdue_after)}
          </dd>
        </div>
      </dl>
      {same ? <p className="text-sm">Список «Не выставлены» у {entity.code} не изменится.</p> : null}
      <div className="switch-lists">
        <BillList title={toKort ? "Появятся: KORT начисляет, в таблице счёт не ждут" : "Появятся: таблица ждёт счёт"} bills={preview.appear} />
        <BillList title={toKort ? "Уйдут: по условиям договора счёт не нужен" : "Уйдут: их ждёт только KORT"} bills={preview.vanish} />
        <BillList
          title="Сменят срок"
          bills={preview.regroup.map((item) => item.bill)}
          notes={preview.regroup.map(
            (item) => `${item.before_text || GROUP_WORDS[item.before] || item.before} → ${item.bill.text || GROUP_WORDS[item.bill.group] || ""}`,
          )}
        />
      </div>
      {toKort ? (
        <p className="text-xs fin-muted">
          Счета {entity.code} в списке, боте и шаблоне - у KORT; счёт со строкой в таблице пишется в неё, без строки - в KORT.
        </p>
      ) : null}
    </>
  );
}

type PaidItem = SwitchPaymentsPreview["items"][number];

function PaymentsBody({ preview, entity, toKort }: { preview: SwitchPaymentsPreview; entity: SwitchEntity; toKort: boolean }) {
  const [all, setAll] = useState(false);
  const counts = preview.counts;
  const shown = all ? preview.items : preview.items.slice(0, FIRST);
  // «Было» - то, что «Оплачено» показывает сейчас; «станет» - после перехода.
  const was = (item: PaidItem) => (toKort ? item.table : item.kort);
  const will = (item: PaidItem) => (toKort ? item.kort : item.table);
  return (
    <>
      <dl className="switch-counts">
        <div>
          <dt>Договоров с оплатами</dt>
          <dd>{count(counts.contracts)}</dd>
        </div>
        <div>
          <dt>«Оплачено» не изменится</dt>
          <dd className="fin-strong">{count(counts.same)}</dd>
        </div>
        <div>
          <dt>Оплачено всего</dt>
          <dd>
            {paidMoney(toKort ? preview.totals.table : preview.totals.kort)} → {paidMoney(toKort ? preview.totals.kort : preview.totals.table)}
          </dd>
        </div>
      </dl>
      {preview.items.length ? (
        <section className="switch-list">
          <p className="switch-list-title">
            «Оплачено» станет другим <span className="fin-muted">{count(preview.items.length)}</span>
          </p>
          <ul>
            {shown.map((item) => (
              <li key={item.id} className="switch-bill">
                <span className="switch-bill-what">
                  <span className="fin-strong">{item.customer || "-"}</span>
                  <span className="switch-note">{[item.number, PAID_CODES[item.code]].filter(Boolean).join(" · ")}</span>
                </span>
                <span className="switch-bill-sum">
                  {paidMoney(was(item))} → {paidMoney(will(item))}
                </span>
              </li>
            ))}
          </ul>
          {preview.items.length > shown.length ? (
            <button type="button" className="fin-link-btn" onClick={() => setAll(true)}>
              Показать все {count(preview.items.length)}
            </button>
          ) : null}
        </section>
      ) : (
        <p className="text-sm">«Оплачено» договоров {entity.code} не изменится.</p>
      )}
      {toKort ? (
        <p className="text-xs fin-muted">«Оплачено» и «Остаток» договоров {entity.code} - по оплатам KORT из журнала и 1С.</p>
      ) : null}
    </>
  );
}

function paidMoney(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "-";
  return formatMoney(value, { whole: true });
}
