"use client";

/**
 * «Долги» - кто сколько должен по договорам на любой день (ядро, фаза 6).
 *
 * Долг не хранится: KORT считает его из входящего сальдо, начислений (или
 * АВР) и оплат на тот день, который выбран. «По начислениям» - что должны по
 * договору; «по АВР» - по выставленным актам. Возраст долга - по неоплаченным
 * месяцам (актам) после разнесения оплат; аванс - отдельно.
 *
 * Сторона: «Нам должны» (продажи), «Мы должны» (покупки - наше юрлицо
 * заказчик), «Между своими» (обе стороны - наши юрлица: их займы и услуги
 * друг другу - не долг клиента). Группы - вторая сторона, наши юрлица, отделы
 * и сотрудники. Отделы и сотрудники - по долям договора: совместный договор
 * делится долями, без долей - «не распределено», а доли, которые человеку не
 * открыты, не делятся вовсе («доли закрыты»): иначе их было бы видно по долгу.
 *
 * Рядом - «Ожидания»: операции журнала, которые ждут оплаты (прежний отчёт).
 */
import { type ReactNode, useEffect, useState } from "react";

import { can } from "@/components/finance/access";
import {
  type CoreView,
  type DebtAge,
  type DebtBasis,
  type DebtContract,
  type DebtGroup,
  type DebtRow,
  type DebtDirection,
  type DebtsView,
  type Me,
  coreApi,
} from "@/components/finance/api";
import { ContractCard } from "@/components/finance/contracts/contract-card";
import { useRegistryBoot } from "@/components/finance/contracts/registry-cards";
import { bareNumber, contractMoney, formatDay, formatTime, parseDay, plural } from "@/components/finance/format";
import { DateInput } from "@/components/finance/ui/date-picker";
import { useSessionState } from "@/components/session-state";

const SIDES: [DebtDirection, string][] = [
  ["receivable", "Нам должны"],
  ["payable", "Мы должны"],
  ["intra", "Между своими"],
];

const GROUPS: DebtGroup[] = ["client", "entity", "department", "person"];

/** Подписи групп: вторая сторона у продажи - клиент, у покупки - поставщик. */
const GROUP_TITLES: Record<DebtDirection, Record<DebtGroup, string>> = {
  receivable: { client: "Клиенты", entity: "Юрлица", department: "Отделы", person: "Сотрудники" },
  payable: { client: "Поставщики", entity: "Юрлица", department: "Отделы", person: "Сотрудники" },
  intra: { client: "Кто должен", entity: "Кому", department: "Отделы", person: "Сотрудники" },
};

const BASES: [DebtBasis, string][] = [
  ["accruals", "По начислениям"],
  ["acts", "По АВР"],
];

/** Колонки возраста - от свежего к старому; «до учёта» - остаток входящего сальдо. */
const AGES: DebtAge[] = ["d30", "d60", "d90", "d90plus", "opening"];

const AGE_SHORT: Record<DebtAge, string> = {
  d30: "до 30 дн.",
  d60: "31-60",
  d90: "61-90",
  d90plus: "больше 90",
  opening: "до учёта",
};

function messageOf(exc: unknown, fallback: string): string {
  return exc instanceof Error && exc.message ? exc.message : fallback;
}

function money(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "" || !Number(value)) return "-";
  return contractMoney(value);
}

/** «до 30 дн. 100 000 · 31-60 50 000» - возраст одной строкой (узкий экран). */
function agingLine(aging: DebtRow["aging"]): string {
  return AGES.filter((key) => Number(aging[key]))
    .map((key) => `${AGE_SHORT[key]} ${contractMoney(aging[key])}`)
    .join(" · ");
}

/** Раздел «Долги»: долги по договорам и ожидания журнала. */
/**
 * `view` - вид «Долги» (`core/views.py`): его сторона, основание и группа -
 * выбор по умолчанию, отбор вида («отдел - ЮО») сужает договоры на сервере.
 * Выбор человека у каждого вида свой.
 */
export function DebtsSection({ me, expectations, view }: { me: Me; expectations: ReactNode; view?: CoreView }) {
  const contracts = can(me, "contracts", "view");
  const [shown, setShown] = useSessionState<"contracts" | "plans">("core.debts.view", "contracts");
  if (!contracts) return <>{expectations}</>;
  return (
    <div className="debts-screen">
      <nav className="fin-mine shadow-what" aria-label="Какие долги">
        {(
          [
            ["contracts", "По договорам"],
            ["plans", "Ожидания"],
          ] as ["contracts" | "plans", string][]
        ).map(([key, title]) => (
          <button key={key} type="button" className="fin-chip" data-on={shown === key ? "" : undefined} onClick={() => setShown(key)}>
            {title}
          </button>
        ))}
      </nav>
      {shown === "contracts" ? <DebtsScreen key={view?.key ?? ""} me={me} source={view} /> : expectations}
    </div>
  );
}

function DebtsScreen({ me, source }: { me: Me; source?: CoreView }) {
  // Договор из списка открывается карточкой - ей нужен реестр.
  useRegistryBoot(me);
  const scope = source?.key ? `.${source.key}` : "";
  const preset = source?.params ?? {};
  const [side, setSide] = useSessionState<DebtDirection>(`core.debts.side${scope}`, (preset.side as DebtDirection) || "receivable");
  const [group, setGroup] = useSessionState<DebtGroup>(`core.debts.group${scope}`, (preset.group as DebtGroup) || "client");
  const [basis, setBasis] = useSessionState<DebtBasis>(`core.debts.basis${scope}`, (preset.basis as DebtBasis) || "accruals");
  // Пусто - сегодня компании; день держится, пока вкладка открыта.
  const [day, setDay] = useSessionState("core.debts.day", "");
  const [text, setText] = useState(() => (day ? formatDay(day) : ""));
  const [data, setData] = useState<DebtsView | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  // Считаем, пока пришедший ответ - не на последний запрос.
  const asked = `${side}|${group}|${basis}|${day}|${revision}`;
  const [answered, setAnswered] = useState("");
  const loading = answered !== asked;
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [contractId, setContractId] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    coreApi
      .debts({ side, group, basis, as_of: day || undefined, view: source?.key || undefined }, { signal: controller.signal })
      .then((next) => {
        setData(next);
        setError(next.error);
      })
      .catch((exc) => {
        if (controller.signal.aborted) return;
        setData(null);
        setError(messageOf(exc, "Долги не посчитались"));
      })
      .finally(() => {
        if (!controller.signal.aborted) setAnswered(asked);
      });
    return () => controller.abort();
  }, [side, group, basis, day, revision, asked, source?.key]);

  // Другая сторона или группа - другие строки: раскрытое прежде не значит ничего.
  const chooseSide = (key: DebtDirection) => {
    setSide(key);
    setOpen(new Set());
  };
  const chooseGroup = (key: DebtGroup) => {
    setGroup(key);
    setOpen(new Set());
  };
  const pickDay = (value: string) => {
    setText(value);
    const iso = parseDay(value);
    if (iso) setDay(iso);
    else if (!value.trim()) setDay("");
  };
  const toggle = (key: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const totals = data?.totals;
  const titles = GROUP_TITLES[side];
  return (
    <div className="debts-body">
      <div className="fin-kpis debts-sides">
        {SIDES.map(([key, title]) => {
          const item = data?.sides[key];
          return (
            <button
              key={key}
              type="button"
              className="fin-kpi fin-kpi-pick"
              data-on={side === key ? "" : undefined}
              onClick={() => chooseSide(key)}
            >
              <span className="fin-kpi-label">{title}</span>
              <span className="fin-kpi-value">{item ? money(item.owed) : "-"}</span>
              <span className="fin-kpi-label">
                {item
                  ? [
                      `${item.contracts} ${plural(item.contracts, "договор", "договора", "договоров")}`,
                      Number(item.advance) ? `аванс ${contractMoney(item.advance)}` : "",
                      // Покупки без начислений: долг есть, но KORT его не знает - так и сказать.
                      !item.contracts && item.unknown ? `долг ${item.unknown} неизвестен` : "",
                    ]
                      .filter(Boolean)
                      .join(" · ")
                  : "договоров"}
              </span>
            </button>
          );
        })}
      </div>

      <div className="debts-bar">
        <span className="fin-mine" role="group" aria-label="Основание долга">
          {BASES.map(([key, title]) => (
            <button key={key} type="button" className="fin-chip" data-on={basis === key ? "" : undefined} onClick={() => setBasis(key)}>
              {title}
            </button>
          ))}
        </span>
        <span className="fin-mine" role="group" aria-label="Чей долг">
          {GROUPS.map((key) => (
            <button key={key} type="button" className="fin-chip" data-on={group === key ? "" : undefined} onClick={() => chooseGroup(key)}>
              {titles[key]}
            </button>
          ))}
        </span>
        <span className="debts-day">
          <span className="fin-label">На</span>
          <DateInput value={text} onChange={pickDay} ariaLabel="Долг на дату" className="input-field party-date" />
          {day ? (
            <button
              type="button"
              className="fin-link-btn"
              onClick={() => {
                setText("");
                setDay("");
              }}
            >
              Сегодня
            </button>
          ) : null}
        </span>
      </div>

      {totals && Number(totals.owed) ? <Aging totals={totals} /> : null}

      <p className="debts-source">
        {data
          ? [
              `на ${formatDay(data.as_of)}`,
              data.since ? `оплаты в KORT с ${formatDay(data.since)}, раньше - входящее сальдо` : "оплат в KORT ещё нет",
              basis === "acts" && data.book ? `АВР: KORT, 1С и сводная таблица (прочитана в ${formatTime(data.book.read_at)})` : "",
              totals?.unknown
                ? `долг ${totals.unknown} ${plural(totals.unknown, "договора", "договоров", "договоров")} неизвестен - ${
                    basis === "acts" ? "ни АВР, ни сальдо по АВР" : "KORT не считает их начислений"
                  }`
                : "",
            ]
              .filter(Boolean)
              .join(" · ")
          : loading
            ? "Считаем долги…"
            : ""}
        {data && loading ? " · пересчитываем…" : ""}
      </p>
      {error ? <p className="party-error">{error}</p> : null}

      {!data ? (
        <p className="creg-empty">{loading ? "Считаем долги…" : ""}</p>
      ) : !data.rows.length ? (
        <p className="creg-empty">На {formatDay(data.as_of)} долгов и авансов нет</p>
      ) : (
        <div className="fin-card overflow-x-auto" aria-busy={loading}>
          <table className="fin-table debts-table">
            <thead>
              <tr>
                <th>{titles[group]}</th>
                <th className="fin-num">Долг</th>
                {AGES.map((key) => (
                  <th key={key} className="fin-num only-desktop">
                    {AGE_SHORT[key]}
                  </th>
                ))}
                <th className="fin-num">Аванс</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <GroupRows
                  key={row.key}
                  row={row}
                  shown={open.has(row.key)}
                  onToggle={() => toggle(row.key)}
                  onOpen={setContractId}
                  group={group}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ContractCard
        id={contractId}
        open={Boolean(contractId)}
        book=""
        onClose={() => {
          setContractId(null);
          setRevision((value) => value + 1);
        }}
        onCreated={(id) => setContractId(id)}
      />
    </div>
  );
}

/**
 * Возраст неоплаченного одной полосой: свежее - бледнее, старое - гуще тушью;
 * остаток сальдо «до учёта» - штриховкой. Цвета нет: долг - не отказ.
 */
function Aging({ totals }: { totals: DebtsView["totals"] }) {
  const parts = AGES.filter((key) => Number(totals.aging[key]));
  const label = parts.map((key) => `${AGE_SHORT[key]} ${contractMoney(totals.aging[key])}`).join(", ");
  return (
    <div className="debts-aging-block">
      <div className="debts-aging-bar" role="img" aria-label={`Возраст долга: ${label}`}>
        {parts.map((key) => (
          <span key={key} className="debts-aging-part" data-age={key} style={{ flexGrow: Number(totals.aging[key]) }} />
        ))}
      </div>
      {/* Подпись - чертой того же тона, что и её отрезок полосы, а не точкой. */}
      <dl className="debts-ages">
        {parts.map((key) => (
          <div key={key} className="debts-age" data-age={key}>
            <dt>{AGE_SHORT[key]}</dt>
            <dd className="fin-num">{contractMoney(totals.aging[key])}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function GroupRows({
  row,
  shown,
  onToggle,
  onOpen,
  group,
}: {
  row: DebtRow;
  shown: boolean;
  onToggle: () => void;
  onOpen: (id: string) => void;
  group: DebtGroup;
}) {
  const count = row.contracts.length;
  const aging = agingLine(row.aging);
  return (
    <>
      <tr className="debts-group" data-special={row.special ? "" : undefined}>
        <td>
          <button type="button" className="debts-toggle" aria-expanded={shown} onClick={onToggle}>
            <span className="debts-name">
              <span className="debts-title">{row.title}</span>
              <span className="debts-count">
                {count} {plural(count, "договор", "договора", "договоров")}
              </span>
            </span>
          </button>
          {aging ? <span className="debts-aging only-mobile">{aging}</span> : null}
        </td>
        <td className="fin-num debts-sum">{money(row.owed)}</td>
        {AGES.map((key) => (
          <td key={key} className="fin-num only-desktop">
            {money(row.aging[key])}
          </td>
        ))}
        <td className="fin-num">{money(row.advance)}</td>
      </tr>
      {shown ? row.contracts.map((item) => <ContractRow key={item.id} item={item} onOpen={onOpen} group={group} />) : null}
    </>
  );
}

function ContractRow({ item, onOpen, group }: { item: DebtContract; onOpen: (id: string) => void; group: DebtGroup }) {
  const aging = agingLine(item.aging);
  return (
    <tr className="debts-contract">
      <td>
        <span className="shadow-contract">
          <button type="button" className="fin-link-btn creg-num" onClick={() => onOpen(item.id)}>
            {bareNumber(item.number) || "без номера"}
          </button>
          {group !== "client" ? <span className="shadow-client">{item.party || "-"}</span> : null}
          {group !== "entity" && item.entity ? <span className="annot">{item.entity}</span> : null}
        </span>
        {item.fraction ? (
          <span className="debts-share">
            доля {Number(item.fraction).toLocaleString("ru-RU")}% от {money(item.whole)}
          </span>
        ) : null}
        {aging ? <span className="debts-aging only-mobile">{aging}</span> : null}
      </td>
      <td className="fin-num">{money(item.owed)}</td>
      {AGES.map((key) => (
        <td key={key} className="fin-num only-desktop">
          {money(item.aging[key])}
        </td>
      ))}
      <td className="fin-num">{money(item.advance)}</td>
    </tr>
  );
}
