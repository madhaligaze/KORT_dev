"use client";

/**
 * «Найти или сделать» - окно по Ctrl+K (ядро, фаза 8).
 *
 * Одна строка на всё: договор по номеру, как его ни пиши («обо-62» -
 * «№ОБО/62»), клиент по любому написанию и началу БИН, раздел по слову
 * («долги», «ндс», «сверка») и действие словами («оплаты без договора»,
 * «записать режим НДС»). Действие открывает свой список уже выбранным -
 * состояние экрана пишется до перехода, как у карточек «Сегодня».
 *
 * Клавиатура: ↑ ↓ - выбор, Enter - открыть, Esc - закрыть. Мышь - щелчок.
 */
import { useEffect, useMemo, useRef, useState } from "react";

import { can, isAdmin } from "@/components/finance/access";
import { type Me, type ParticipantHit, coreApi } from "@/components/finance/api";
import { bareNumber } from "@/components/finance/format";
import { CardLayer } from "@/components/finance/ui/card-layer";
import { SearchIcon } from "@/components/icons";
import { useSessionScope, writeSession } from "@/components/session-state";

type ContractHit = { id: string; number: string; customer: string; executor: string; status: string; by: "number" | "client" };

type Item = { key: string; group: string; title: string; hint: string; run: () => void };

/** Слова, по которым находится раздел, кроме его названия. */
const SECTION_WORDS: Record<string, string[]> = {
  today: ["сегодня", "главн", "дела"],
  contracts: ["реестр", "договор"],
  participants: ["участник", "клиент", "бин", "контрагент"],
  shadow: ["сверк", "таблиц", "сводк"],
  debts: ["долг", "дебитор", "должн", "задолж"],
  vat: ["ндс", "порог", "налог"],
  cash: ["деньги", "поступ", "движени"],
  profit: ["прибыль", "выручк", "доход"],
  journal: ["журнал", "операци", "выписк"],
  invoices: ["счет", "счёт"],
  import: ["загруз", "выписк", "импорт"],
};

type Action = { key: string; title: string; words: string[]; section: string; session: Record<string, string>; allowed: (me: Me) => boolean };

const ACTIONS: Action[] = [
  {
    key: "debts-old", title: "Долги больше 90 дней", words: ["долг", "просроч", "90"],
    section: "debts", session: { "core.debts.view": "contracts", "core.debts.side": "receivable", "core.debts.group": "client" },
    allowed: (me) => can(me, "reports.debts") && can(me, "contracts"),
  },
  {
    key: "debts-payable", title: "Что мы должны поставщикам", words: ["мы должны", "поставщ", "покупк", "кредитор"],
    section: "debts", session: { "core.debts.view": "contracts", "core.debts.side": "payable", "core.debts.group": "client" },
    allowed: (me) => can(me, "reports.debts") && can(me, "contracts"),
  },
  {
    key: "without", title: "Оплаты без договора", words: ["оплат", "без договор", "поступлен", "разнест"],
    section: "shadow", session: { "core.shadow.what": "payments", "core.shadow.paid.view": "without" }, allowed: isAdmin,
  },
  {
    key: "opening", title: "Перенести входящее сальдо из таблицы", words: ["сальдо", "входящ", "начало учёт", "перенест"],
    section: "shadow", session: { "core.shadow.what": "payments", "core.shadow.paid.view": "opening" }, allowed: isAdmin,
  },
  {
    key: "unsigned", title: "АВР без подписи клиента", words: ["авр", "акт", "подпис"],
    section: "shadow", session: { "core.shadow.what": "acts", "core.shadow.acts.view": "unsigned" }, allowed: isAdmin,
  },
  {
    key: "esf", title: "ЭСФ не выписаны после срока", words: ["эсф", "счет-фактур", "фактур"],
    section: "shadow", session: { "core.shadow.what": "acts", "core.shadow.acts.view": "no_esf" }, allowed: isAdmin,
  },
  {
    key: "missing", title: "Месяцы без АВР", words: ["авр", "акт", "нет акт", "выставить акт"],
    section: "shadow", session: { "core.shadow.what": "acts", "core.shadow.acts.view": "missing" }, allowed: isAdmin,
  },
  {
    key: "proposals", title: "Сверить начисления с таблицей", words: ["сверк", "начислен", "предложен", "таблиц"],
    section: "shadow", session: { "core.shadow.what": "accruals", "core.shadow.view": "proposals" }, allowed: isAdmin,
  },
  {
    key: "saldo", title: "Сальдо KORT против «Сальдо Конец» таблицы", words: ["сальдо", "сверк"],
    section: "shadow", session: { "core.shadow.what": "saldo" }, allowed: isAdmin,
  },
  {
    key: "regime", title: "Записать режим НДС юрлица", words: ["ндс", "режим", "плательщик", "упрощ"],
    section: "vat", session: {}, allowed: isAdmin,
  },
  {
    key: "transfer", title: "Перевести клиентов на другое ТОО", words: ["перевест", "перевод", "порог", "тоо", "ндс"],
    section: "vat", session: {}, allowed: isAdmin,
  },
  {
    key: "revenue", title: "Выручка по месяцам и отделам", words: ["выручк", "прибыль", "отдел", "начислено"],
    section: "profit", session: { "core.revenue.profit.view": "contracts", "core.revenue.profit.group": "department" },
    allowed: (me) => can(me, "reports.profit") && can(me, "contracts"),
  },
  {
    key: "twins", title: "Двойники клиентов", words: ["двойник", "дубл", "свести"],
    section: "participants", session: { "core.parties.view": "twins", "core.parties.q": "" }, allowed: (me) => can(me, "contracts"),
  },
];

function norm(text: string): string {
  return text.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
}

function matches(query: string, title: string, words: string[]): boolean {
  const q = norm(query);
  if (!q) return true;
  const hay = [norm(title), ...words.map(norm)];
  return q.split(" ").every((part) => hay.some((word) => word.includes(part) || part.startsWith(word)));
}

export function FindLayer({
  me,
  open,
  sections,
  onClose,
  onSection,
  onContract,
  onParticipant,
}: {
  me: Me;
  open: boolean;
  sections: { key: string; title: string }[];
  onClose: () => void;
  onSection: (section: string) => void;
  onContract: (id: string) => void;
  onParticipant: (id: string) => void;
}) {
  const scope = useSessionScope();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [contracts, setContracts] = useState<ContractHit[]>([]);
  const [parties, setParties] = useState<ParticipantHit[]>([]);
  const [searching, setSearching] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const seesContracts = can(me, "contracts");

  // Окно открылось - пустая строка и фокус в ней.
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => input.current?.focus(), 30);
    return () => window.clearTimeout(timer);
  }, [open]);

  const text = query.trim();
  useEffect(() => {
    if (!open || !seesContracts || text.length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setSearching(true);
      Promise.all([
        coreApi.searchContracts(text, { signal: controller.signal }).then((result) => result.items),
        coreApi.list(text, "all", { signal: controller.signal }).then((result) => result.items.slice(0, 6)),
      ])
        .then(([found, people]) => {
          setContracts(found);
          setParties(people);
          setActive(0);
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setContracts([]);
            setParties([]);
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, 180);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [open, text, seesContracts]);

  const close = () => {
    setQuery("");
    setContracts([]);
    setParties([]);
    setActive(0);
    onClose();
  };

  const items: Item[] = useMemo(() => {
    const out: Item[] = [];
    const remote = text.length >= 2;
    if (remote) {
      for (const hit of contracts) {
        out.push({
          key: `c:${hit.id}`,
          group: "Договоры",
          title: `${bareNumber(hit.number) || "без номера"} · ${hit.customer || "-"}`,
          hint: [hit.executor, hit.status, hit.by === "client" ? "по клиенту" : ""].filter(Boolean).join(" · "),
          run: () => onContract(hit.id),
        });
      }
      for (const hit of parties) {
        out.push({
          key: `p:${hit.id}`,
          group: "Участники",
          title: hit.own ? `${hit.own} · ${hit.name}` : hit.name,
          hint: [hit.bin ? `БИН ${hit.bin}` : "без БИН", hit.contracts ? `договоров ${hit.contracts}` : ""].filter(Boolean).join(" · "),
          run: () => onParticipant(hit.id),
        });
      }
    }
    for (const action of ACTIONS) {
      if (action.allowed(me) && matches(text, action.title, action.words)) {
        out.push({
          key: `a:${action.key}`,
          group: "Действия",
          title: action.title,
          hint: sections.find((item) => item.key === action.section)?.title ?? "",
          run: () => {
            for (const [key, value] of Object.entries(action.session)) writeSession(scope, key, value);
            onSection(action.section);
          },
        });
      }
    }
    const found = sections.filter((section) => matches(text, section.title, SECTION_WORDS[section.key] ?? []));
    // Пустая строка - подсказки: действия и первые разделы колонки, а не все тридцать.
    for (const section of text ? found : found.slice(0, 6)) {
      out.push({ key: `s:${section.key}`, group: "Разделы", title: section.title, hint: "", run: () => onSection(section.key) });
    }
    return out;
  }, [text, contracts, parties, me, sections, scope, onContract, onParticipant, onSection]);

  const pick = (item: Item | undefined) => {
    if (!item) return;
    close();
    item.run();
  };

  // Выбранная строка - в виду при ходе стрелками.
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  let index = -1;
  let group = "";
  return (
    <CardLayer open={open} onClose={close} label="Найти или сделать" className="find-sheet">
      <div className="find-box">
        <span className="find-icon" aria-hidden="true">
          <SearchIcon size={16} />
        </span>
        <input
          ref={input}
          className="find-input"
          value={query}
          placeholder="Договор, клиент, раздел или действие"
          aria-label="Найти или сделать"
          aria-controls="find-results"
          aria-activedescendant={items[active] ? `find-${items[active].key}` : undefined}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActive((value) => Math.min(value + 1, Math.max(items.length - 1, 0)));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActive((value) => Math.max(value - 1, 0));
            } else if (event.key === "Enter") {
              event.preventDefault();
              pick(items[active]);
            }
          }}
        />
        {searching ? <span className="fin-soft find-busy">ищем…</span> : null}
      </div>
      <div ref={list} id="find-results" className="find-results" role="listbox" aria-label="Найдено">
        {!items.length ? (
          <p className="party-none">{text.length >= 2 && !searching ? `По «${text}» ничего нет` : ""}</p>
        ) : (
          items.map((item) => {
            index += 1;
            const head = item.group !== group;
            group = item.group;
            const current = index;
            return (
              <div key={item.key}>
                {head ? <p className="find-group">{item.group}</p> : null}
                <button
                  type="button"
                  id={`find-${item.key}`}
                  role="option"
                  aria-selected={current === active}
                  data-index={current}
                  className="find-item"
                  onMouseMove={() => current !== active && setActive(current)}
                  onClick={() => pick(item)}
                >
                  <span className="find-title">{item.title}</span>
                  {item.hint ? <span className="find-hint">{item.hint}</span> : null}
                </button>
              </div>
            );
          })
        )}
      </div>
      <p className="find-keys fin-soft">↑ ↓ - выбрать · Enter - открыть · Esc - закрыть</p>
    </CardLayer>
  );
}
