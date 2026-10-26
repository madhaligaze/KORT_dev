"use client";

/**
 * «Сверка» - начисления KORT против книги-сводки (ядро, фаза 2).
 *
 * Пока правда в книге, KORT считает начисления сам и сравнивает по каждому
 * договору и месяцу. Экран - для того, кто переводит учёт в KORT (владелец,
 * администратор): сколько договоров уже совпадает, что дописать в условия,
 * чтобы совпали остальные (предложения - по видам, простые - «Применить
 * все» с точкой восстановления), какие месяцы расходятся и чем, какие
 * договоры книги в реестре не заведены. Всё записанное - обычные изменения
 * договоров: видно в карточке, в истории, возвращается.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  type BillGroupKey,
  type BillsShadow,
  type BillsShadowCode,
  type Me,
  type ShadowCode,
  type ShadowDecision,
  type ShadowLine,
  type ShadowProposal,
  type ShadowProposalKind,
  type ShadowView,
  coreApi,
  formatMonth,
} from "@/components/finance/api";
import { ChoiceSelect } from "@/components/choice-select";
import { readParam, writeParams } from "@/components/finance/address";
import { ContractCard } from "@/components/finance/contracts/contract-card";
import { useRegistryBoot } from "@/components/finance/contracts/registry-cards";
import { useRegistry } from "@/components/finance/contracts/store";
import { ActsShadow } from "@/components/finance/core/acts-screen";
import { PaymentsShadow } from "@/components/finance/core/payments-screen";
import { ProposalActions, type Verified } from "@/components/finance/core/proposal";
import { SaldoShadowView } from "@/components/finance/core/saldo-screen";
import { SwitchView } from "@/components/finance/core/switch-screen";
import { bareNumber, contractMoney, dayTitle, formatDay, formatTime, plural } from "@/components/finance/format";
import { ConfirmDialog } from "@/components/finance/ui/confirm-dialog";
import { useSessionState } from "@/components/session-state";

type View = "proposals" | "lines" | "unknown";

/** Порядок и подписи видов предложений: сначала то, что меняет расчёт всех месяцев. */
const KINDS: { kind: ShadowProposalKind; title: string }[] = [
  { kind: "billing", title: "Как начислять" },
  { kind: "status", title: "Статус против таблицы" },
  { kind: "period_day", title: "День периода" },
  { kind: "billing_from", title: "Начало начислений" },
  { kind: "executor_from", title: "Исполнитель с даты" },
  { kind: "executor_before", title: "Исполнитель до перевода" },
  { kind: "amount_from", title: "Сумма с даты" },
  { kind: "amount_before", title: "Сумма до смены цены" },
  { kind: "amount_fix", title: "Сумма разового договора" },
  { kind: "adjust", title: "Поправки месяцев" },
  { kind: "pause", title: "Пауза" },
  { kind: "stop", title: "Таблица кончилась раньше" },
  { kind: "end", title: "Дата окончания" },
];
const BULK = new Set<ShadowProposalKind>(["billing", "period_day", "billing_from"]);

const CODE_TITLES: Record<ShadowCode, string> = {
  amount: "сумма",
  period: "период",
  executor: "юрлицо",
  no_kort: "нет в KORT",
  no_book: "нет в таблице",
};

function messageOf(exc: unknown, fallback: string): string {
  return exc instanceof Error && exc.message ? exc.message : fallback;
}

/** «alone» - расходится, а предложения нет: решить «Верно у KORT» или поправить договор в карточке. */
type LineFilter = ShadowCode | "" | "alone" | "slip" | "verified";

function lineKey(line: { contract_id: string; month: string }): string {
  return `${line.contract_id}|${line.month}`;
}

/** Пачкой решается ошибка периода таблицы, только когда расходится одно начало периода. */
function slipped(line: ShadowLine): boolean {
  return Boolean(line.slip) && line.codes.length === 1 && line.codes[0] === "period";
}

const STALE: Record<NonNullable<ShadowLine["stale"]>["side"], string> = {
  kort: "условия договора изменились",
  book: "таблица изменилась",
  both: "изменились и таблица, и условия договора",
};

type SlipsResult = { done: number; contracts: number; batch: string | null; skipped: string[] };

type What = "switch" | "accruals" | "bills" | "payments" | "acts" | "saldo";

export function ShadowScreen({ me }: { me: Me }) {
  // Договор из сверки открывается карточкой договора - ей нужен реестр.
  useRegistryBoot(me);
  const [what, setWhat] = useSessionState<What>("core.shadow.what", "accruals");
  // Карточку закрыли - сверка могла измениться: пересчитать открытую.
  const [closed, setClosed] = useState(0);
  const [contractId, setContractId] = useState<string | null>(() => readParam("id"));
  const openContract = useCallback((id: string | null) => {
    setContractId(id);
    writeParams({ id }, id !== null);
  }, []);
  useEffect(() => {
    const onPop = () => setContractId(readParam("id"));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  // Одно наше юрлицо во всех звеньях - как его считает «Переход»; пусто - все.
  const [entity, setEntity] = useSessionState("core.shadow.entity", "");
  const schema = useRegistry((s) => s.schema);
  const entities = schema?.own_entities ?? [];
  return (
    <div className="shadow-screen">
      <div className="shadow-top">
        <nav className="fin-mine shadow-what" aria-label="Что сверяем">
          {(
            [
              ["switch", "Переход"],
              ["accruals", "Начисления"],
              ["bills", "Счета"],
              ["payments", "Оплаты"],
              ["acts", "Акты"],
              ["saldo", "Сальдо"],
            ] as [What, string][]
          ).map(([key, title]) => (
            <button key={key} type="button" className="fin-chip" data-on={what === key ? "" : undefined} onClick={() => setWhat(key)}>
              {title}
            </button>
          ))}
        </nav>
        {what !== "switch" && entities.length > 1 ? (
          <ChoiceSelect className="input-field shadow-entity" value={entity} onChange={setEntity} placeholder="все юрлица" clearable>
            {entities.map((item) => (
              <option key={item.id} value={item.id}>
                {item.code || item.name}
              </option>
            ))}
          </ChoiceSelect>
        ) : null}
      </div>
      {what === "switch" ? (
        <SwitchView
          onGo={(link, id) => {
            setEntity(id ?? "");
            setWhat(link);
          }}
        />
      ) : what === "accruals" ? (
        <AccrualsShadow onOpen={openContract} closed={closed} entity={entity} />
      ) : what === "bills" ? (
        <BillsShadowView onOpen={openContract} closed={closed} entity={entity} />
      ) : what === "payments" ? (
        <PaymentsShadow onOpen={openContract} closed={closed} entity={entity} />
      ) : what === "acts" ? (
        <ActsShadow onOpen={openContract} closed={closed} entity={entity} />
      ) : (
        <SaldoShadowView onOpen={openContract} closed={closed} entity={entity} />
      )}
      <ContractCard
        id={contractId}
        open={Boolean(contractId)}
        book=""
        onClose={() => {
          openContract(null);
          setClosed((value) => value + 1);
        }}
        onCreated={(id) => openContract(id)}
      />
    </div>
  );
}

function AccrualsShadow({
  onOpen: openContract,
  closed,
  entity,
}: {
  onOpen: (id: string | null) => void;
  closed: number;
  entity: string;
}) {
  const [view, setView] = useSessionState<View>("core.shadow.view", "proposals");
  const [data, setData] = useState<ShadowView | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  // Сверка «идёт», пока пришедший ответ - не на последний запрос (и не на прежний выбор юрлица).
  const asked = `${revision}|${entity}`;
  const [loaded, setLoaded] = useState("");
  const loading = loaded !== asked;
  // Записанное прячется сразу; сверка пересчитывается следом, раз в пару секунд.
  const [applied, setApplied] = useState<Set<string>>(() => new Set());
  // Решения «верно у KORT» до пересчёта: месяц уходит из расходящихся сразу, а не через пересчёт.
  const [decided, setDecided] = useState<Map<string, ShadowDecision | null>>(() => new Map());
  // Пачка «верно у KORT» возвращается целиком - кнопкой у сообщения о записи;
  // `proposal` - предложение, вместо которого решили: вернули - оно снова на экране.
  const [batch, setBatch] = useState<{ id: string; done: number; proposal?: string } | null>(null);
  const [note, setNote] = useState("");
  const later = useRef(0);
  const reload = useCallback(() => {
    window.clearTimeout(later.current);
    later.current = window.setTimeout(() => setRevision((value) => value + 1), 1500);
  }, []);
  useEffect(() => () => window.clearTimeout(later.current), []);
  useEffect(() => {
    if (closed) reload();
  }, [closed, reload]);
  useEffect(() => {
    let alive = true;
    coreApi
      .shadow(entity)
      .then((next) => {
        if (!alive) return;
        setData(next);
        setApplied(new Set());
        setDecided(new Map());
        setError(next.error);
      })
      .catch((exc) => alive && setError(messageOf(exc, "Сверка не прочиталась")))
      .finally(() => alive && setLoaded(asked));
    return () => {
      alive = false;
    };
  }, [asked, entity]);

  const proposals = useMemo(
    () => (data?.proposals ?? []).filter((item) => !applied.has(item.key)),
    [data, applied],
  );
  const counts = data?.counts ?? {};
  const verdictOf = useCallback(
    (line: ShadowLine) => {
      const key = lineKey(line);
      return decided.has(key) ? (decided.get(key) ?? null) : line.verified;
    },
    [decided],
  );
  const differing = data ? data.lines.filter((line) => !verdictOf(line)).length : 0;
  const settled = data ? data.lines.length - differing : 0;
  const onApplied = (proposal: ShadowProposal) => (text: string) => {
    setApplied((current) => new Set(current).add(proposal.key));
    setBatch(null);
    setNote(text);
    reload();
  };
  const onVerified = (proposal: ShadowProposal) => (result: Verified) => {
    setApplied((current) => new Set(current).add(proposal.key));
    setBatch({ id: result.batch, done: result.done, proposal: proposal.key });
    setNote(result.text);
    reload();
  };
  const onDecided = (line: ShadowLine, decision: ShadowDecision | null, text: string) => {
    setDecided((current) => new Map(current).set(lineKey(line), decision));
    setBatch(null);
    setNote(text);
    reload();
  };
  const onSlips = (result: SlipsResult, lines: ShadowLine[]) => {
    const at = new Date().toISOString();
    setDecided((current) => {
      const next = new Map(current);
      for (const line of lines) next.set(lineKey(line), { id: "", at, batch: result.batch });
      return next;
    });
    setBatch(result.batch ? { id: result.batch, done: result.done } : null);
    setNote(
      `Верно у KORT: ${result.done} ${plural(result.done, "месяц", "месяца", "месяцев")} у ${result.contracts} ${plural(result.contracts, "договора", "договоров", "договоров")}` +
        (result.skipped.length ? `, не записано: ${result.skipped.join("; ")}` : ""),
    );
    // Сразу, а не через паузу: у месяцев пачки «Вернуть» по одному ждёт их решений с сервера.
    setRevision((value) => value + 1);
  };
  const [undoing, setUndoing] = useState(false);
  const undoBatch = async () => {
    if (!batch || !data) return;
    setUndoing(true);
    try {
      const result = await coreApi.unverifyBatch(batch.id);
      setDecided((current) => {
        const next = new Map(current);
        for (const line of data.lines) if (verdictOf(line)?.batch === batch.id) next.set(lineKey(line), null);
        return next;
      });
      const back = batch.proposal;
      if (back) {
        setApplied((current) => {
          const next = new Set(current);
          next.delete(back);
          return next;
        });
      }
      setBatch(null);
      setNote(`Вернули ${result.done} ${plural(result.done, "решение", "решения", "решений")} «верно у KORT» - месяцы снова расходятся`);
      reload();
    } catch (exc) {
      setError(messageOf(exc, "Решения не вернулись"));
    } finally {
      setUndoing(false);
    }
  };

  return (
    <>
      <div className="shadow-bar">
        <p className="shadow-source">
          {data?.book ? (
            <>
              {data.book.url ? (
                <a href={data.book.url} target="_blank" rel="noreferrer" className="fin-link-btn">
                  {data.book.title || "Сводная таблица"}
                </a>
              ) : (
                data.book.title || "Сводная таблица"
              )}
              {data.book.worksheet ? ` · ${data.book.worksheet}` : ""}
              {data.book.read_at ? ` · прочитана в ${formatTime(data.book.read_at)}` : ""}
              {data.window.length ? ` · ${formatMonth(data.window[0])} - ${formatMonth(data.window[data.window.length - 1])}` : ""}
            </>
          ) : loading ? (
            "Читаем сводную таблицу…"
          ) : null}
        </p>
        <button type="button" className="btn-ghost btn-sm" disabled={loading} onClick={() => setRevision((value) => value + 1)}>
          {loading ? "Сверяем…" : "Сверить заново"}
        </button>
      </div>

      <div className="fin-kpis">
        <div className="fin-kpi">
          <span className="fin-kpi-label">Совпадает</span>
          <span className="fin-kpi-value">
            {data ? `${counts.clean ?? 0} из ${counts.contracts ?? 0}` : "-"}
          </span>
          <span className="fin-kpi-label">
            {data ? `месяцев ${counts.same ?? 0} из ${counts.months ?? 0}${settled ? ` · верно у KORT ${settled}` : ""}` : ""}
          </span>
        </div>
        {(
          [
            ["proposals", "Предложения", data ? proposals.length : null],
            ["lines", "Расходится", data ? differing : null],
            ["unknown", "Нет в реестре", data ? (counts.unknown ?? 0) : null],
          ] as [View, string, number | null][]
        ).map(([key, title, value]) => (
          <button
            key={key}
            type="button"
            className="fin-kpi fin-kpi-pick"
            data-on={view === key ? "" : undefined}
            onClick={() => setView(key)}
          >
            <span className="fin-kpi-label">{title}</span>
            <span className="fin-kpi-value">{value ?? "-"}</span>
            {key === "lines" && data ? (
              <span className="fin-kpi-label">{plural(differing, "месяц", "месяца", "месяцев")} договоров</span>
            ) : null}
          </button>
        ))}
      </div>

      {error ? <p className="party-error">{error}</p> : null}
      {note ? (
        <p className="shadow-note" role="status">
          {note}
          {batch ? (
            <>
              {" · "}
              <button type="button" className="fin-link-btn" disabled={undoing} onClick={undoBatch}>
                {batch.done > 1 ? `Вернуть все ${batch.done}` : "Вернуть"}
              </button>
            </>
          ) : null}
        </p>
      ) : null}

      {!data ? (
        <p className="creg-empty">{loading ? "Сверяем начисления с таблицей…" : ""}</p>
      ) : view === "proposals" ? (
        <Proposals
          data={data}
          proposals={proposals}
          onOpen={openContract}
          onApplied={onApplied}
          onVerified={onVerified}
          onBulk={(text) => {
            setBatch(null);
            setNote(text);
            setRevision((value) => value + 1);
          }}
        />
      ) : view === "lines" ? (
        <Lines data={data} verdictOf={verdictOf} entity={entity} onOpen={openContract} onDecided={onDecided} onSlips={onSlips} />
      ) : (
        <Unknown
          data={data}
          onOpen={openContract}
          onCreated={(text, id) => {
            setNote(text);
            reload();
            openContract(id);
          }}
        />
      )}
    </>
  );
}

/**
 * «Счета»: список «Не выставлены» KORT против списка книги. KORT ждёт счёт по
 * начислению, у которого счёта нет ни в KORT, ни в книге; срок - «Период с».
 */
function BillsShadowView({ onOpen, closed, entity }: { onOpen: (id: string | null) => void; closed: number; entity: string }) {
  const [data, setData] = useState<BillsShadow | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const asked = `${revision}|${closed}|${entity}`;
  const [loaded, setLoaded] = useState("");
  const loading = loaded !== asked;
  const [code, setCode] = useSessionState<BillsShadowCode | "">("core.shadow.bills.code", "");
  useEffect(() => {
    let alive = true;
    coreApi
      .shadowBills(entity)
      .then((next) => {
        if (!alive) return;
        setData(next);
        setError(next.error);
      })
      .catch((exc) => alive && setError(messageOf(exc, "Сверка счетов не прочиталась")))
      .finally(() => alive && setLoaded(asked));
    return () => {
      alive = false;
    };
  }, [asked, entity]);
  const counts = data?.counts ?? {};
  const total = (counts.same ?? 0) + (data?.lines.length ?? 0);
  const lines = (data?.lines ?? []).filter((line) => !code || line.code === code);
  const groupWord = (group: BillGroupKey | null) => (group ? (data?.groups[group] ?? group) : "выставлен");
  return (
    <>
      <div className="shadow-bar">
        <p className="shadow-source">
          {data?.book
            ? `${data.book.title || "Сводная таблица"} · прочитана в ${formatTime(data.book.read_at)} · ${data.window.length ? `${formatMonth(data.window[0])} - ${formatMonth(data.window[data.window.length - 1])}` : ""}`
            : loading
              ? "Читаем сводную таблицу…"
              : ""}
        </p>
        <button type="button" className="btn-ghost btn-sm" disabled={loading} onClick={() => setRevision((value) => value + 1)}>
          {loading ? "Сверяем…" : "Сверить заново"}
        </button>
      </div>
      <div className="fin-kpis">
        <div className="fin-kpi">
          <span className="fin-kpi-label">Совпадает</span>
          <span className="fin-kpi-value">{data ? `${counts.same ?? 0} из ${total}` : "-"}</span>
          <span className="fin-kpi-label">договоро-месяцев</span>
        </div>
        <div className="fin-kpi">
          <span className="fin-kpi-label">Ждут счёта</span>
          <span className="fin-kpi-value">{data ? `${counts.kort_waits ?? 0} · ${counts.book_waits ?? 0}` : "-"}</span>
          <span className="fin-kpi-label">KORT · таблица</span>
        </div>
        {(
          [
            ["no_kort", "Только в таблице"],
            ["no_book", "Только у KORT"],
          ] as [BillsShadowCode, string][]
        ).map(([key, title]) => (
          <button
            key={key}
            type="button"
            className="fin-kpi fin-kpi-pick"
            data-on={code === key ? "" : undefined}
            onClick={() => setCode(code === key ? "" : key)}
          >
            <span className="fin-kpi-label">{title}</span>
            <span className="fin-kpi-value">{data ? (counts[key] ?? 0) : "-"}</span>
          </button>
        ))}
      </div>
      {error ? <p className="party-error">{error}</p> : null}
      {data ? (
        <div className="fin-mine shadow-codes" role="group" aria-label="Чем расходится">
          <button type="button" className="fin-chip" data-on={code === "" ? "" : undefined} onClick={() => setCode("")}>
            Все {data.lines.length}
          </button>
          {(["group", "kort_issued"] as BillsShadowCode[]).map((key) =>
            counts[key] ? (
              <button key={key} type="button" className="fin-chip" data-on={code === key ? "" : undefined} onClick={() => setCode(key)}>
                {data.codes[key]} {counts[key]}
              </button>
            ) : null,
          )}
        </div>
      ) : null}
      {!data ? (
        <p className="creg-empty">{loading ? "Сверяем счета с таблицей…" : ""}</p>
      ) : lines.length ? (
        <div className="fin-card overflow-x-auto">
          <table className="fin-table shadow-table">
            <thead>
              <tr>
                <th>Договор</th>
                <th>Месяц</th>
                <th>Чем</th>
                <th>KORT</th>
                <th>Таблица</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => {
                const contract = data.contracts[line.contract_id];
                return (
                  <tr key={`${line.contract_id}-${line.month}`}>
                    <td>
                      <span className="shadow-contract">
                        <button type="button" className="fin-link-btn creg-num" onClick={() => onOpen(line.contract_id)}>
                          {bareNumber(contract?.number) || "без номера"}
                        </button>
                        <span className="shadow-client">{contract?.customer || "-"}</span>
                        {contract?.executor ? <span className="annot">{contract.executor}</span> : null}
                      </span>
                    </td>
                    <td className="fin-bills-date">{formatMonth(line.month)}</td>
                    <td className="fin-out">{data.codes[line.code]}</td>
                    <td>
                      {line.kort ? (
                        <>
                          {groupWord(line.kort.group)}
                          <span className="fin-bills-note">срок {formatDay(line.kort.due)}</span>
                        </>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td>
                      {line.book ? (
                        <>
                          {line.book.text || groupWord(line.book.group)}
                          <span className="fin-bills-note">{line.book.due ? `срок ${formatDay(line.book.due)}` : "без «Периода с»"}</span>
                        </>
                      ) : (
                        "строки нет"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="creg-empty">Списки совпадают</p>
      )}
    </>
  );
}

function ContractCell({ data, id, onOpen }: { data: ShadowView; id: string; onOpen: (id: string) => void }) {
  const contract = data.contracts[id];
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

function Proposals({
  data,
  proposals,
  onOpen,
  onApplied,
  onVerified,
  onBulk,
}: {
  data: ShadowView;
  proposals: ShadowProposal[];
  onOpen: (id: string) => void;
  onApplied: (proposal: ShadowProposal) => (text: string) => void;
  onVerified: (proposal: ShadowProposal) => (result: Verified) => void;
  onBulk: (text: string) => void;
}) {
  const [confirm, setConfirm] = useState<ShadowProposalKind | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!proposals.length) {
    return <p className="creg-empty">Предложений нет - условия договоров дают то же, что таблица</p>;
  }
  const groups = KINDS.map((item) => ({ ...item, items: proposals.filter((proposal) => proposal.kind === item.kind) })).filter(
    (group) => group.items.length,
  );
  const bulk = groups.find((group) => group.kind === confirm);
  return (
    <div className="shadow-groups">
      {error ? <p className="party-error">{error}</p> : null}
      {groups.map((group) => (
        <section key={group.kind} className="shadow-group">
          <div className="card-section">
            <span>
              {group.title}
              <span className="fin-muted" style={{ fontWeight: 400 }}>
                {" "}
                {group.items.length}
              </span>
            </span>
            <span className="card-section-line" />
            {BULK.has(group.kind) && group.items.length > 1 ? (
              <span className="card-section-end">
                <button type="button" className="fin-link-btn" disabled={busy} onClick={() => setConfirm(group.kind)}>
                  Применить все
                </button>
              </span>
            ) : null}
          </div>
          {group.items.map((proposal) => (
            <div key={proposal.key} className="shadow-proposal">
              <ContractCell data={data} id={proposal.contract_id} onOpen={onOpen} />
              <span className="shadow-text">{proposal.text}</span>
              <ProposalActions proposal={proposal} disabled={busy} onApplied={onApplied(proposal)} onVerified={onVerified(proposal)} />
            </div>
          ))}
        </section>
      ))}
      <ConfirmDialog
        open={Boolean(bulk)}
        title={bulk ? `${bulk.title}: записать у ${bulk.items.length} ${plural(bulk.items.length, "договора", "договоров", "договоров")}?` : ""}
        text="Каждый договор получит значение, как в таблице. Вернуть всё разом - «Восстановление» в личном кабинете."
        confirm="Записать"
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          if (!bulk || !BULK.has(bulk.kind)) return;
          setBusy(true);
          setError("");
          try {
            const result = await coreApi.applyAll(bulk.kind as "billing" | "period_day" | "billing_from");
            setConfirm(null);
            onBulk(
              `${bulk.title}: записано у ${result.done} ${plural(result.done, "договора", "договоров", "договоров")}` +
                (result.skipped.length ? `, не записано: ${result.skipped.join("; ")}` : ""),
            );
          } catch (exc) {
            setConfirm(null);
            setError(messageOf(exc, "Не записалось"));
          } finally {
            setBusy(false);
          }
        }}
      />
    </div>
  );
}

function money(value: string | null | undefined): string {
  return value ? contractMoney(value) : "-";
}

/**
 * Расходящиеся месяцы. Ошиблась таблица, а не договор, - «Верно у KORT»: месяц
 * засчитывается сошедшимся, пока KORT и таблица считают его так же. Месяцы, где
 * таблица пропустила день периода или посчитала его дважды и расходится одно
 * начало периода, решаются и пачкой.
 */
function Lines({
  data,
  verdictOf,
  entity,
  onOpen,
  onDecided,
  onSlips,
}: {
  data: ShadowView;
  verdictOf: (line: ShadowLine) => ShadowDecision | null;
  entity: string;
  onOpen: (id: string) => void;
  onDecided: (line: ShadowLine, decision: ShadowDecision | null, text: string) => void;
  onSlips: (result: SlipsResult, lines: ShadowLine[]) => void;
}) {
  const [filter, setFilter] = useSessionState<LineFilter>("core.shadow.code", "");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);
  const open = data.lines.filter((line) => !verdictOf(line));
  const settled = data.lines.filter((line) => verdictOf(line));
  const slips = open.filter(slipped);
  const slipContracts = new Set(slips.map((line) => line.contract_id)).size;
  const proposed = new Set(data.proposals.flatMap((proposal) => proposal.months.map((month) => lineKey({ contract_id: proposal.contract_id, month }))));
  const alone = open.filter((line) => !proposed.has(lineKey(line)));
  const lines =
    filter === "verified"
      ? settled
      : filter === "slip"
        ? slips
        : filter === "alone"
          ? alone
          : open.filter((line) => !filter || line.codes.includes(filter));
  const count = (key: ShadowCode) => open.filter((line) => line.codes.includes(key)).length;
  const chip = (key: LineFilter, title: string, value: number) =>
    value || filter === key ? (
      <button key={key} type="button" className="fin-chip" data-on={filter === key ? "" : undefined} onClick={() => setFilter(key)}>
        {title} {value}
      </button>
    ) : null;

  const decide = async (line: ShadowLine) => {
    const verdict = verdictOf(line);
    setBusy(lineKey(line));
    setError("");
    try {
      if (verdict) {
        const result = await coreApi.unverify(verdict.id);
        onDecided(line, null, result.text);
      } else {
        const result = await coreApi.verify(line.contract_id, line.month);
        onDecided(line, { id: result.id, at: new Date().toISOString(), batch: null }, result.text);
      }
    } catch (exc) {
      setError(messageOf(exc, verdict ? "Решение не снялось" : "Решение не записалось"));
    } finally {
      setBusy("");
    }
  };

  return (
    <>
      <div className="fin-mine shadow-codes" role="group" aria-label="Чем расходится">
        <button type="button" className="fin-chip" data-on={filter === "" ? "" : undefined} onClick={() => setFilter("")}>
          Все {open.length}
        </button>
        {chip("alone", "без предложения", alone.length)}
        {(Object.keys(CODE_TITLES) as ShadowCode[]).map((key) => chip(key, CODE_TITLES[key], count(key)))}
        {chip("slip", "ошибка периода в таблице", slips.length)}
        {chip("verified", "верно у KORT", settled.length)}
        {filter === "slip" && slips.length ? (
          <button type="button" className="btn-ghost btn-sm shadow-bulk" disabled={Boolean(busy)} onClick={() => setConfirm(true)}>
            Верно у KORT - все {slips.length}
          </button>
        ) : null}
      </div>
      {error ? <p className="party-error">{error}</p> : null}
      {lines.length ? (
        <div className="fin-card overflow-x-auto">
          <table className="fin-table shadow-table">
            <thead>
              <tr>
                <th>Договор</th>
                <th>Месяц</th>
                <th>Чем</th>
                <th style={{ textAlign: "right" }}>KORT</th>
                <th style={{ textAlign: "right" }}>Таблица</th>
                <th>
                  <span className="sr-only">Решение</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <LineRow
                  key={lineKey(line)}
                  data={data}
                  line={line}
                  verdict={verdictOf(line)}
                  busy={busy === lineKey(line) || busy === "slips"}
                  onOpen={onOpen}
                  onDecide={() => decide(line)}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="creg-empty">
          {filter === "verified"
            ? "Решений «верно у KORT» нет"
            : filter === "slip"
              ? "Ошибок периода в таблице больше нет"
              : filter === "alone"
                ? "У всех расхождений есть предложение"
                : "Расхождений нет"}
        </p>
      )}
      <ConfirmDialog
        open={confirm}
        title={`Верно у KORT: ${slips.length} ${plural(slips.length, "месяц", "месяца", "месяцев")} у ${slipContracts} ${plural(slipContracts, "договора", "договоров", "договоров")}?`}
        text="В них таблица пропустила день периода или посчитала его дважды. Условия договоров не меняются; вернуть - сразу после записи."
        confirm="Записать"
        busy={busy === "slips"}
        onCancel={() => setConfirm(false)}
        onConfirm={async () => {
          setBusy("slips");
          setError("");
          try {
            const result = await coreApi.verifySlips(entity);
            setConfirm(false);
            onSlips(result, slips);
          } catch (exc) {
            setConfirm(false);
            setError(messageOf(exc, "Не записалось"));
          } finally {
            setBusy("");
          }
        }}
      />
    </>
  );
}

function LineRow({
  data,
  line,
  verdict,
  busy,
  onOpen,
  onDecide,
}: {
  data: ShadowView;
  line: ShadowLine;
  verdict: ShadowDecision | null;
  busy: boolean;
  onOpen: (id: string) => void;
  onDecide: () => void;
}) {
  const side = (amount: string | null | undefined, from: string | null | undefined, code: string) => (
    <>
      {money(amount)}
      <span className="fin-bills-note">{[from ? `с ${formatDay(from).slice(0, 5)}` : "", code].filter(Boolean).join(" · ")}</span>
    </>
  );
  return (
    <tr>
      <td>
        <ContractCell data={data} id={line.contract_id} onOpen={onOpen} />
      </td>
      <td className="fin-bills-date">{formatMonth(line.month)}</td>
      <td className={verdict ? undefined : "fin-out"}>
        {line.codes.map((code) => CODE_TITLES[code]).join(", ")}
        {line.hint ? <span className="fin-bills-note">{line.hint}</span> : null}
        {verdict ? (
          <span className="fin-bills-note">верно у KORT{verdict.at ? ` · ${dayTitle(verdict.at).toLowerCase()}` : ""}</span>
        ) : line.stale ? (
          <span className="fin-bills-note">
            верно у KORT решили {dayTitle(line.stale.at).toLowerCase()}, но {STALE[line.stale.side]}
          </span>
        ) : null}
      </td>
      <td className="fin-num">
        {line.kort ? side(line.kort.skipped ? "0" : line.kort.amount, line.kort.period_from, "") : "-"}
      </td>
      <td className="fin-num">{line.book ? side(line.book.amount, line.book.period_from, line.book.code) : "-"}</td>
      <td className="shadow-decide">
        <button type="button" className="fin-link-btn" disabled={busy || (verdict !== null && !verdict.id)} onClick={onDecide}>
          {verdict ? "Вернуть" : "Верно у KORT"}
        </button>
      </td>
    </tr>
  );
}

function Unknown({
  data,
  onOpen,
  onCreated,
}: {
  data: ShadowView;
  onOpen: (id: string) => void;
  onCreated: (text: string, id: string) => void;
}) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [made, setMade] = useState<Set<string>>(() => new Set());
  const items = data.unknown.filter((item) => !made.has(item.key));
  if (!items.length) return <p className="creg-empty">Все договоры таблицы заведены в реестре</p>;
  return (
    <div className="shadow-unknown">
      {error ? <p className="party-error">{error}</p> : null}
      {items.map((item) => (
        <div key={item.key} className="shadow-proposal">
          <span className="shadow-contract">
            <span className="creg-num">{bareNumber(item.number) || "без номера"}</span>
            <span className="shadow-client">{item.customer || "-"}</span>
            {item.own ? <span className="annot">{item.own}</span> : null}
          </span>
          <span className="shadow-text">
            {item.months.map((month) => formatMonth(month)).join(", ")}
            {item.amount ? ` · ${contractMoney(item.amount)}` : ""}
            {item.state === "other_client" ? (
              <span className="fin-bills-note">
                этот номер в реестре у другого клиента:{" "}
                {item.candidates.map((candidate, index) => (
                  <span key={candidate.id}>
                    {index ? ", " : ""}
                    <button type="button" className="fin-link-btn" onClick={() => onOpen(candidate.id)}>
                      {candidate.customer || candidate.number}
                    </button>
                  </span>
                ))}
              </span>
            ) : null}
          </span>
          <span className="shadow-acts">
            <button
              type="button"
              className="fin-link-btn"
              disabled={busy === item.key}
              onClick={async () => {
                setBusy(item.key);
                setError("");
                try {
                  const created = await coreApi.createFromBook(item.key);
                  setMade((current) => new Set(current).add(item.key));
                  onCreated(`Договор ${created.number || "без номера"} заведён по таблице`, created.id);
                } catch (exc) {
                  setError(messageOf(exc, "Договор не завёлся"));
                } finally {
                  setBusy("");
                }
              }}
            >
              Завести договор
            </button>
          </span>
        </div>
      ))}
    </div>
  );
}
