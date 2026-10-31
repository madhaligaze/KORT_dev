"use client";

import dynamic from "next/dynamic";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";

import {
  BookIcon,
  CalendarIcon,
  ClockIcon,
  CloseIcon,
  CompareIcon,
  ContractGridIcon,
  ContractIcon,
  GroupIcon,
  PersonIcon,
  PlugIcon,
  ReceiptIcon,
  OneoffIcon,
  PartiesIcon,
  RefreshIcon,
  SearchIcon,
  StepsIcon,
  ThresholdIcon,
  TodayIcon,
  TrendIcon,
  UploadIcon,
} from "@/components/icons";
import {
  type CoreView,
  type Dictionaries,
  AUTH_LOST_EVENT,
  FORBIDDEN_EVENT,
  SCHEMA_EVENT,
  FinanceApiError,
  coreApi,
  financeApi,
  looksApi,
  peopleApi,
} from "@/components/finance/api";
import { MONEY_RESOURCES, can, canAny, isAdmin, nameOf } from "@/components/finance/access";
import { AuthGate, AuthLoading, PasswordChangeGate, useMe } from "@/components/finance/auth-gate";
import { Cabinet } from "@/components/finance/cabinet/cabinet";
import { DeviceApprovalBar } from "@/components/finance/device-approval-bar";
import { plural, shortName } from "@/components/finance/format";
import { FadeIn } from "@/components/motion/fade-in";
import { SplitReveal } from "@/components/motion/split-reveal";
import { ThemeSwitch } from "@/components/stage/theme-switch";
import { ImportPanel } from "@/components/finance/import-panel";
import { KortWordmark } from "@/components/brand/kort-wordmark";
import { InvoicesPanel } from "@/components/finance/invoices-panel";
import { IntegrationsPanel } from "@/components/finance/integrations-panel";
import { DictionariesPanel } from "@/components/finance/dictionaries-panel";
import { Registry, RegistryActions, useRegistryBoot } from "@/components/finance/contracts/registry-cards";
import { ContractCard } from "@/components/finance/contracts/contract-card";
import { bookOf, bookTitle } from "@/components/finance/contracts/schema";
import {
  boot,
  ensureSchema,
  ensureSummary,
  forgetRegistry,
  holdQueue,
  useRegistry,
} from "@/components/finance/contracts/store";
import { DesktopBars } from "@/components/desktop/desktop-bars";
import { BookStaff, SummaryLine } from "@/components/finance/contracts/book-summary";
import { RegistryImport } from "@/components/finance/contracts/import/registry-import";
import { RegistrySetup } from "@/components/finance/contracts/setup/registry-setup";
import { FindLayer } from "@/components/finance/core/find";
import { GroupScreen } from "@/components/finance/core/group-screen";
import {
  PARTICIPANT_EVENT,
  SECTION_EVENT,
  VIEWS_EVENT,
  type SectionGo,
  openParticipant,
} from "@/components/finance/core/open";
import { DebtsSection } from "@/components/finance/core/debts-screen";
import { ParticipantsScreen } from "@/components/finance/core/participants";
import { RevenueSection } from "@/components/finance/core/revenue-screen";
import { ShadowScreen } from "@/components/finance/core/shadow-screen";
import { StartScreen } from "@/components/finance/core/start-screen";
import { HomeScreen } from "@/components/finance/core/home-screen";
import { CashCalendarScreen } from "@/components/finance/core/cash-calendar";
import { VatScreen } from "@/components/finance/core/vat-screen";
import { readParam, writeParams } from "@/components/finance/address";
import { forgetLooks } from "@/components/finance/look-store";
import { habitsOwner, pickMode, preferOf, useModeTracker } from "@/components/finance/habits";
import type { Me } from "@/components/finance/api";
import { SessionScope, dropAllSessions, useSessionState, useSessionStateIn, writeSession } from "@/components/session-state";
import { SupportButton } from "@/components/support/button";
import { SupportLayer } from "@/components/support/layer";
import { forgetSupport, openSupport, useSupportUnread } from "@/components/support/store";

/** «Настроить реестр» читает схему из хранилища реестра - поднимаем его, если
 *  экран открыли по ссылке, минуя «Реестр». */
function SetupScreen({ me, onBack, backLabel }: { me: Me; onBack: () => void; backLabel: string }) {
  useRegistryBoot(me);
  return <RegistrySetup onBack={onBack} backLabel={backLabel} />;
}

/** Univer роняет серверную отрисовку - лист реестра только в браузере. */
const RegistrySheet = dynamic(
  () => import("./contracts/registry-sheet").then((m) => m.RegistrySheet),
  { ssr: false, loading: () => <p className="creg-empty">Готовим лист…</p> },
);

/**
 * «Реестр · таблица»: лист и карточка договора.
 *
 * Карточка - по центру, как в «Карточках», с затемнением: щелчок мимо и Esc
 * её закрывают, стрелки ведут по строкам листа. До 29.09.2026 она вставала
 * внизу без затемнения, чтобы правимая строка оставалась видна, - но на окне
 * 1280×590 закрывала почти весь лист, закрыть её можно было только крестиком,
 * и открывалась она с первого щелчка по «№», которым отмечают строку.
 */
function SheetScreen({ me }: { me: Me }) {
  return <RegistryTable me={me} book="" />;
}

function RegistryTable({ me, book }: { me: Me; book: string }) {
  useRegistryBoot(me);
  const [openId, setOpenId] = useState<string | null>(() => readParam("id"));
  const open = useCallback((id: string | null) => {
    setOpenId(id);
    writeParams({ id }, id !== null);
  }, []);
  useEffect(() => {
    const onPop = () => setOpenId(readParam("id"));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  // Соседей открытого договора знает лист: порядок строк, отбор фильтром.
  const [around, setAround] = useState<{ prev: string | null; next: string | null }>({ prev: null, next: null });
  const prev = openId ? around.prev : null;
  const next = openId ? around.next : null;
  return (
    <>
      <RegistrySheet me={me} book={book} onOpenCard={open} openId={openId} onNeighbors={setAround} />
      <ContractCard
        id={openId}
        open={!!openId}
        book={book}
        onClose={() => open(null)}
        onCreated={(id) => open(id)}
        onPrev={prev ? () => open(prev) : undefined}
        onNext={next ? () => open(next) : undefined}
      />
    </>
  );
}

/** Вид считает «Оплачено» или «Остаток» - сводной таблице есть что перечитывать. */
function paysOf(book: { measures: string[] } | undefined): boolean {
  return Boolean(book?.measures.some((key) => key === "summary_paid" || key === "summary_remaining"));
}

/**
 * Вид договоров, кроме реестра («Разовые ЮО»), таблицей: листы его книги
 * (`core/views.py`). Над листом - «Обновить», если вид считает оплаты и
 * сводная таблица подключена; «По сотрудникам» - листом книги, если у вида
 * такая группировка (`staff-sheet.ts`). Карточка - та же, что у реестра.
 */
function BookSheetScreen({ me, book }: { me: Me; book: string }) {
  const schema = useRegistry((s) => s.schema);
  const pays = paysOf(bookOf(schema, book));
  useEffect(() => {
    if (pays) void ensureSummary();
  }, [pays]);
  return (
    <>
      {pays ? (
        <div className="creg-book-top">
          <SummaryLine />
        </div>
      ) : null}
      <RegistryTable me={me} book={book} />
    </>
  );
}

/**
 * Тот же вид карточками; «По сотрудникам» - таблицами, если у вида такая
 * группировка (28.09.2026: «в карточном виде пускай остаётся как есть»).
 */
function BookCardsScreen({ me, onGo, book }: { me: Me; onGo: (section: string) => void; book: string }) {
  useRegistryBoot(me);
  const schema = useRegistry((s) => s.schema);
  const found = bookOf(schema, book);
  const pays = paysOf(found);
  const people = Boolean(found?.groups.includes("people"));
  const [staff, setStaff] = useSessionState(`book.staff.${book}`, false);
  useEffect(() => {
    if (pays) void ensureSummary();
  }, [pays]);
  return (
    <>
      {pays ? (
        <div className="creg-book-top">
          <SummaryLine />
        </div>
      ) : null}
      {/* «По сотрудникам» - в одном ряду с «Все · Мои · С долями» под «Новый
          договор» (30.09.2026: пунктирная ссылка над кнопкой ломала верх). */}
      <Registry
        me={me}
        onGo={onGo}
        book={book}
        staff={people ? { on: staff, set: setStaff, view: <BookStaff book={book} /> } : undefined}
      />
    </>
  );
}

/**
 * Сотрудник, которому ещё не открыли ни одного раздела, стоит на главном
 * экране, а не в кабинете (28.09.2026): колонка пустая, на месте раздела -
 * отказ словами и кто его снимает.
 */
function NoSections({ onCabinet }: { onCabinet: () => void }) {
  return (
    <div className="fin-nosections" role="status">
      <p className="fin-nosections-line">Вам пока не открыт ни один раздел.</p>
      <p className="fin-nosections-sub">
        Доступ даёт владелец или администратор компании - открытый раздел появится здесь сам.
      </p>
      <button type="button" className="fin-link-btn" onClick={onCabinet}>
        Личный кабинет
      </button>
    </div>
  );
}

/**
 * Разделы видов (`core/views.py`): книга листов карточками и таблицей,
 * «Долги» и «Не выставлены» со своим отбором. Ключ вида - `[a-z0-9_]`, поэтому
 * раздел годится и в адрес, и в привычку учётки (`habits.py`).
 */
type ViewSection = `cards.${string}` | `sheet.${string}` | `debts.${string}` | `unbilled.${string}`;

type Section =
  | "contracts"
  | "contracts-sheet"
  | "today"
  | "start"
  | "group"
  | "contracts-import"
  | "contracts-setup"
  | "participants"
  | "shadow"
  | "vat"
  | "cash-calendar"
  | "profit"
  | "debts"
  | "import"
  | "dictionaries"
  | "invoices"
  | "integrations"
  | "me"
  | ViewSection;

const VIEW_SECTION = /^(cards|sheet|debts|unbilled)\.[a-z0-9_]{1,64}$/;

/**
 * Прежние адреса и привычки «Разовых» (`contracts-oneoff…`) ведут в книгу
 * `oneoff` - вид, в который она переехала (миграция 0041).
 */
const LEGACY_SECTIONS: Record<string, Section> = {
  "contracts-oneoff-cards": "cards.oneoff",
  "contracts-oneoff": "sheet.oneoff",
  // Журнал денег (копия Finmap) снят 31.10.2026 решением владельца: его адреса
  // и запомненные разделы ведут на главную, календарь - в «Деньги вперёд» ядра.
  calendar: "cash-calendar",
  cash: "cash-calendar",
  journal: "today",
  table: "today",
  projects: "today",
  plan: "today",
  sheets: "today",
  rules: "today",
  recurrences: "today",
  balance: "today",
  indicators: "today",
  statement: "today",
};

/**
 * Места KORT - строкой над разделом, а не колонкой слева (этап 3, 31.10.2026).
 *
 * Колонка в 23 пункта была админкой базы данных: договоры, учёт, отчёты,
 * настройки - по типам данных, и половина из них - журнал денег, которым не
 * пользовались. Теперь строка короткая: «Сегодня» (решить, под угрозой,
 * пришло), закреплённые виды и то, с чем работают каждый день; остальное - в
 * «Ещё» и в «Найти или сделать» (Ctrl+K). Значок остался пункту для поиска.
 */
type SectionItem = {
  key: Section;
  title: string;
  icon: (props: { size?: number }) => ReactElement;
  /** Право, которое открывает раздел (`app/finance/access.py`, RESOURCES). */
  resource: string;
  /** Вид, из которого собран пункт (`core/views.py`). */
  view?: CoreView;
};

/**
 * Порядок мест: от главной к договорам, деньгам и отчётам. Виды встают в свою
 * группу первыми: «Реестр» и «Разовые ЮО» - в «Договоры», «Не выставлены» - в
 * «Деньги», «Долги» - в «Отчёты». Группы на экране не подписаны - строка
 * плоская, группа задаёт только порядок.
 */
const GROUPS: { title: string; items: SectionItem[]; views?: { source: CoreView["source"]; after?: Section } }[] = [
  {
    // «Сегодня» - главный экран (этап 3): вопросы ядра, угрозы, пришедшее.
    title: "Главное",
    items: [
      { key: "today", title: "Сегодня", icon: TodayIcon, resource: "contracts" },
      // От таблицы и 1С до «Долгов» (фаза 9); заведённой компании - в «Ещё» (`core/usage.py`).
      { key: "start", title: "Первые шаги", icon: StepsIcon, resource: "contracts" },
    ],
  },
  {
    // «Участники» - стороны договоров одним списком: клиент по любому написанию и БИН.
    title: "Договоры",
    views: { source: "contracts" },
    items: [
      { key: "participants", title: "Участники", icon: PartiesIcon, resource: "contracts" },
      // Начисления KORT против сводной таблицы - пока правда в таблице (ядро, фаза 2).
      { key: "shadow", title: "Сверка", icon: CompareIcon, resource: "contracts" },
    ],
  },
  {
    title: "Деньги",
    views: { source: "unbilled" },
    items: [
      // Платёжный календарь ядра: остаток вперёд по дням, разрывы, обещания клиентов.
      { key: "cash-calendar", title: "Деньги вперёд", icon: CalendarIcon, resource: "reports.cash" },
      { key: "profit", title: "Выручка", icon: TrendIcon, resource: "reports.profit" },
      { key: "import", title: "Загрузка выписок", icon: UploadIcon, resource: "import" },
    ],
  },
  {
    title: "Отчёты",
    views: { source: "debts" },
    items: [
      // НДС наших юрлиц: плательщики - НДС, остальные - оборот к порогу; перевод клиентов (ядро, фаза 7).
      { key: "vat", title: "НДС", icon: ThresholdIcon, resource: "reports.summary" },
      // Наши ТОО и что между ними: обороты, договоры между своими, переводы, выплаты людям (фаза 8).
      { key: "group", title: "Карта группы", icon: GroupIcon, resource: "contracts" },
    ],
  },
  {
    // «Команда» и «История» - в личном кабинете: строка - инструмент учёта.
    title: "Настройки",
    items: [
      { key: "integrations", title: "Интеграции", icon: PlugIcon, resource: "integrations" },
      { key: "dictionaries", title: "Справочники", icon: BookIcon, resource: "dictionaries" },
    ],
  },
];

/** Места, которые в строке только своей отметкой: редкие, их находят в «Ещё» и поиском. */
const MORE_SECTIONS = new Set<Section>(["start", "profit", "import", "group", "integrations", "dictionaries"]);

/**
 * Экраны без пункта в колонке: редкие действия внутри «Реестра» (меню ⋯) и
 * личный кабинет, который открывается по имени в раме. У кабинета права нет:
 * своё видит каждый, а вкладки людей решают права `people` и `audit`.
 * «Долги» без вида - прежний адрес (`?s=debts`, ссылки «Сегодня»): ведёт в
 * первый вид «Долгов», а без него - в долги без отбора.
 */
const HIDDEN_SECTIONS: SectionItem[] = [
  { key: "contracts-sheet", title: "Реестр", icon: ContractGridIcon, resource: "contracts" },
  { key: "contracts-import", title: "Загрузка реестра", icon: UploadIcon, resource: "contracts" },
  { key: "contracts-setup", title: "Настроить реестр", icon: BookIcon, resource: "contracts" },
  { key: "debts", title: "Долги", icon: ClockIcon, resource: "reports.debts" },
  // Счета к выставлению без вида «Не выставлены» - пункт «под угрозой» ведёт сюда.
  { key: "invoices", title: "Счета", icon: ReceiptIcon, resource: "invoices" },
  { key: "me", title: "Личный кабинет", icon: PersonIcon, resource: "" },
];

const STATIC_SECTIONS: SectionItem[] = [...GROUPS.flatMap((group) => group.items), ...HIDDEN_SECTIONS];

const SOURCE_RESOURCE: Record<CoreView["source"], string> = {
  contracts: "contracts",
  debts: "reports.debts",
  unbilled: "invoices",
};

/** Пункт колонки вида: реестр - «Реестр», книга - её карточки, долги и «Не выставлены» - свои. */
function viewNav(view: CoreView): Section {
  if (view.source === "contracts") return view.key ? `cards.${view.key}` : "contracts";
  return `${view.source}.${view.key}` as Section;
}

function viewItems(view: CoreView): SectionItem[] {
  const resource = SOURCE_RESOURCE[view.source];
  if (view.source === "contracts") {
    const icon = view.key ? OneoffIcon : ContractIcon;
    const table: Section = view.key ? `sheet.${view.key}` : "contracts-sheet";
    return [
      { key: viewNav(view), title: view.title, icon, resource, view },
      { key: table, title: view.title, icon: ContractGridIcon, resource, view },
    ];
  }
  const icon = view.source === "debts" ? ClockIcon : ReceiptIcon;
  return [{ key: viewNav(view), title: view.title, icon, resource, view }];
}

/**
 * Виды до ответа сервера - то, что есть у любой компании: «Реестр» и «Долги».
 * Колонка не ждёт запроса пустой, а у новой компании и не меняется после него.
 */
const FALLBACK_VIEWS: CoreView[] = [
  {
    id: "", key: "", title: "Реестр", source: "contracts", owner: { kind: "company" }, filter: {}, measures: [],
    groups: [], forms: ["cards", "table"], params: {}, pin: "all", position: 10, template: "registry",
    pinned: true, editable: false,
  },
  {
    id: "", key: "dolgi", title: "Долги", source: "debts", owner: { kind: "company" }, filter: {}, measures: [],
    groups: [], forms: ["list"], params: {}, pin: "all", position: 20, template: "debts", pinned: true,
    editable: false,
  },
];

/** Виды с прошлого раза - чтобы «Разовые ЮО» в колонке не появлялись вслед за загрузкой. */
const VIEWS_KEY = "fin_views";

function readViews(owner: string): CoreView[] | null {
  if (!owner) return null;
  try {
    const raw = localStorage.getItem(`${VIEWS_KEY}:${owner}`);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(parsed) ? (parsed as CoreView[]) : null;
  } catch {
    return null;
  }
}

function writeViews(owner: string, views: CoreView[]): void {
  if (!owner) return;
  try {
    localStorage.setItem(`${VIEWS_KEY}:${owner}`, JSON.stringify(views));
  } catch {
    /* не запомнится - колонка подождёт ответа */
  }
}

/**
 * Реестры и их формы. Реестр - пункт колонки и заголовок раздела, форма -
 * «Карточки · Таблица» рядом с заголовком. Выбранная форма - весом и чертой
 * под словом, не цветом и не плашкой (правило индикаторов). Порядок форм
 * постоянный: переключение не переставляет слова. Какие формы у вида есть -
 * решает вид (`forms`).
 */
type Registry = { nav: Section; book: string; modes: { key: Section; form: string; title: string }[] };

function registryOf(section: Section): Registry | undefined {
  if (section === "contracts" || section === "contracts-sheet") {
    return {
      nav: "contracts",
      book: "",
      modes: [
        { key: "contracts", form: "cards", title: "Карточки" },
        { key: "contracts-sheet", form: "table", title: "Таблица" },
      ],
    };
  }
  const found = /^(cards|sheet)\.([a-z0-9_]+)$/.exec(section);
  if (!found) return undefined;
  const book = found[2];
  return {
    nav: `cards.${book}`,
    book,
    modes: [
      { key: `cards.${book}`, form: "cards", title: "Карточки" },
      { key: `sheet.${book}`, form: "table", title: "Таблица" },
    ],
  };
}

/** Пункт колонки, который горит для раздела: у формы реестра - его реестр. */
function navKey(section: Section): Section {
  return registryOf(section)?.nav ?? section;
}

/**
 * Раздел из адреса, хранилища или ссылки: известный, раздел вида или прежний адрес «Разовых».
 *
 * «Реестр» (`contracts`) с 28.10 - пункт вида, а не строка колонки в коде, и
 * без отдельной строки здесь его адрес не узнавался: «Скопировать ссылку» в
 * карточке договора (`?s=contracts&id=…`) открывала «Сегодня».
 */
function sectionOf(value: string | null | undefined): Section | null {
  if (!value) return null;
  if (value === "contracts") return "contracts";
  if (value in LEGACY_SECTIONS) return LEGACY_SECTIONS[value];
  if (STATIC_SECTIONS.some((item) => item.key === value)) return value as Section;
  return VIEW_SECTION.test(value) ? (value as Section) : null;
}

/** Ключ прежней привычки и запомненной формы: у книги `oneoff` - группа «Разовых». */
const LEGACY_NAV: Record<string, string> = { "cards.oneoff": "contracts-oneoff-cards" };

/**
 * Последняя форма каждого реестра: «Разовые ЮО» в колонке ведут туда, где
 * человек работал, - в таблицу, если он в ней, а не каждый раз в карточки.
 */
const MODE_KEY = "fin_registry_mode";

function modeOf(nav: Section, value: string | null | undefined): Section | null {
  const wanted = sectionOf(value);
  return registryOf(nav)?.modes.find((mode) => mode.key === wanted)?.key ?? null;
}

function readMode(nav: Section): Section | null {
  try {
    const legacy = LEGACY_NAV[nav];
    return (
      modeOf(nav, localStorage.getItem(`${MODE_KEY}:${nav}`)) ??
      (legacy ? modeOf(nav, localStorage.getItem(`${MODE_KEY}:${legacy}`)) : null)
    );
  } catch {
    return null;
  }
}

/**
 * Форма реестра, выбранная в этой вкладке, - главнее привычки: переключился на
 * карточки ради одного договора и ушёл в «Разовые» - вернёшься в карточки.
 * Новая вкладка или вход - снова по привычке (`habits.ts`).
 */
const SESSION_MODE_KEY = "fin_registry_mode_now";

function readSessionMode(nav: Section): Section | null {
  try {
    return modeOf(nav, sessionStorage.getItem(`${SESSION_MODE_KEY}:${nav}`));
  } catch {
    return null;
  }
}

function writeSessionMode(section: Section): void {
  const registry = registryOf(section);
  if (!registry) return;
  try {
    sessionStorage.setItem(`${SESSION_MODE_KEY}:${registry.nav}`, section);
  } catch {
    /* вкладка без хранилища - решит привычка */
  }
}

/**
 * Какой формой открыть реестр: выбор в этой вкладке → привычка учётки →
 * последний в браузере. `allowed` - формы вида: форма, которой у вида больше
 * нет, не открывается.
 */
function chooseMode(
  nav: Section,
  owner: string,
  fromMe?: Readonly<Record<string, string>> | null,
  allowed?: ReadonlySet<Section>,
): Section | null {
  if (!registryOf(nav)) return null;
  const legacy = LEGACY_NAV[nav];
  const habit = preferOf(owner, nav, fromMe) ?? (legacy ? preferOf(owner, legacy, fromMe) : null);
  const fits = (mode: Section | null) => (mode && (!allowed || allowed.has(mode)) ? mode : null);
  return (
    fits(readSessionMode(nav)) ?? fits(modeOf(nav, habit)) ?? fits(readMode(nav)) ?? (allowed ? [...allowed][0] ?? null : null)
  );
}

function writeMode(section: Section): void {
  const registry = registryOf(section);
  if (!registry) return;
  try {
    localStorage.setItem(`${MODE_KEY}:${registry.nav}`, section);
  } catch {
    /* форма не запомнится - откроются карточки */
  }
}
/** Загрузка и настройка реестра меняют шаблон компании - владелец и администратор.
 *  Сверка с книгой - работа того, кто переводит учёт в KORT, - тоже; порог
 *  НДС и перевод клиентов между юрлицами - решение владельца. */
const ADMIN_SECTIONS = new Set<Section>(["contracts-import", "contracts-setup", "shadow", "vat", "group", "start"]);

/**
 * Мера раздела (`.fin-body[data-measure]` в globals.css): до какой ширины
 * раздел растёт на широком окне. Листы Univer - во всю ширину, настройки и
 * загрузки - узкой строкой, остальное - шириной таблиц и отчётов.
 */
const FORM_SECTIONS = new Set<Section>([
  "import",
  "integrations",
  "dictionaries",
  "contracts-import",
  "contracts-setup",
]);
function measureOf(section: Section): "full" | "form" | "data" {
  if (section === "contracts-sheet" || section.startsWith("sheet.")) return "full";
  return FORM_SECTIONS.has(section) ? "form" : "data";
}

function sectionFromAddress(): Section | null {
  return sectionOf(readParam("s"));
}

/**
 * Последний открытый раздел - туда же при следующем входе. Раньше вход всегда
 * вёл в «Журнал», и компания, которая ведёт договоры, каждый раз начинала с
 * пустого журнала, хотя колонка начинается с «Реестра». Служебные экраны
 * (загрузка, настройка, кабинет) последним не запоминаются.
 */
const LAST_KEY = "fin_last_section";
const NOT_LAST = new Set<Section>(["contracts-import", "contracts-setup", "debts", "me"]);

function readLast(): Section | null {
  try {
    const value = sectionOf(localStorage.getItem(LAST_KEY));
    return value && !NOT_LAST.has(value) ? value : null;
  } catch {
    return null;
  }
}

function writeLast(section: Section): void {
  if (NOT_LAST.has(section)) return;
  try {
    localStorage.setItem(LAST_KEY, section);
  } catch {
    /* не запомнится - откроется первый раздел колонки */
  }
}

/** Как часто перечитывать «кто я и что мне открыто», пока вкладка видна. */
const ME_POLL_MS = 20000;

export function FinanceClient() {
  // Раздел сам решает, кто вошёл: своя учётка, свой вход, своя компания.
  const { me, setMe, loading, offline } = useMe();
  const [picked, setSectionState] = useState<Section | null>(null);
  /**
   * Раздел живёт в адресе: ссылку на реестр или договор можно переслать.
   * Первый раздел читается после монтирования, а не в начальном состоянии -
   * иначе серверная отрисовка и первая клиентская разошлись бы.
   */
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- адрес читается только в браузере
    setSectionState(sectionFromAddress());
    const onPop = () => setSectionState(sectionFromAddress());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  /** Колонка - только разрешённые разделы (фронт-план, 3.1). */
  const visible = useCallback(
    (item: SectionItem) =>
      item.key === "me" || (ADMIN_SECTIONS.has(item.key) ? isAdmin(me) : can(me, item.resource)),
    [me],
  );
  /**
   * Подпись «Разовые ЮО» - из правила книги, поэтому колонке нужна схема
   * реестра. Одна схема, без договоров: человек может и не открывать реестр.
   */
  const seesContracts = can(me, "contracts");
  const companyKey = me?.company?.id ?? null;
  const userKey = me?.user?.id ?? null;
  useEffect(() => {
    if (companyKey && seesContracts) void ensureSchema(companyKey, userKey);
  }, [companyKey, userKey, seesContracts]);
  // Десктоп: правки, оставшиеся без связи с прошлого раза, уходят, даже если
  // реестр сейчас не открыт.
  useEffect(() => {
    if (companyKey && seesContracts) return holdQueue(companyKey, userKey);
  }, [companyKey, userKey, seesContracts]);
  // Привычки учётки - до выбора раздела входа: форма реестра берётся из них.
  const habitOwner = habitsOwner(userKey, companyKey);
  const meHabits = me?.habits ?? null;
  const registrySchema = useRegistry((s) => s.schema);
  /**
   * Виды компании (`core/views.py`) - из них собирается колонка: «Реестр»,
   * «Разовые ЮО», «Долги». Первый кадр - виды с прошлого раза (иначе пункт
   * «Разовые ЮО» появлялся бы вслед за загрузкой), до них - «Реестр» и
   * «Долги», которые есть у любой компании. Перечитываются со сменой схемы
   * реестра (вид её сдвигает) и по сигналу настройки видов.
   */
  const [views, setViews] = useState<CoreView[] | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- хранилище читается только в браузере
    setViews(readViews(habitOwner));
  }, [habitOwner]);
  const [viewsTick, setViewsTick] = useState(0);
  useEffect(() => {
    const bump = () => setViewsTick((value) => value + 1);
    window.addEventListener(VIEWS_EVENT, bump);
    return () => window.removeEventListener(VIEWS_EVENT, bump);
  }, []);
  const seesViews = canAny(me, ["contracts", "reports.debts", "invoices"]);
  const schemaRev = registrySchema?.schema_rev ?? 0;
  useEffect(() => {
    if (!companyKey || !userKey || !seesViews) return;
    let alive = true;
    coreApi
      .views()
      .then((result) => {
        if (!alive) return;
        setViews(result.views);
        writeViews(habitOwner, result.views);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [companyKey, userKey, seesViews, schemaRev, viewsTick, habitOwner]);
  const known = useMemo(() => [...(views ?? FALLBACK_VIEWS)].sort((a, b) => a.position - b.position), [views]);
  /** Пункты видов: у вида договоров - карточки и таблица, у остальных - один. */
  const viewSections = useMemo(() => known.flatMap(viewItems), [known]);
  const itemOf = useCallback(
    (key: Section | null | undefined): SectionItem | undefined =>
      key ? viewSections.find((item) => item.key === key) ?? STATIC_SECTIONS.find((item) => item.key === key) : undefined,
    [viewSections],
  );
  /** Формы вида, которые у него есть: «Карточки · Таблица» или одна из них. */
  const formsOf = useCallback(
    (target: Registry): Registry["modes"] => {
      const forms = viewSections.find((item) => item.key === target.nav)?.view?.forms ?? [];
      const modes = target.modes.filter((mode) => forms.includes(mode.form));
      return modes.length ? modes : target.modes;
    },
    [viewSections],
  );
  /**
   * Виды (ядро, фаза 8): раздел, где у компании нет ни одной строки, не
   * занимает колонку - он в «Ещё» и в поиске (Ctrl+K). Закрепить его в колонке
   * каждый может для себя: личное хранилище `/looks/nav`. Так же - вид,
   * который не закреплён у человека видом (`pin`): он в «Ещё».
   */
  const [emptySections, setEmptySections] = useState<Set<string>>(() => new Set());
  const [pins, setPins] = useState<Set<string>>(() => new Set());
  const [moreOpen, setMoreOpen] = useState(false);
  useEffect(() => {
    if (!companyKey || !userKey) return;
    let alive = true;
    coreApi
      .usage()
      .then((result) => alive && setEmptySections(new Set(result.empty)))
      .catch(() => alive && setEmptySections(new Set()));
    looksApi
      .get("nav")
      .then(({ look }) => alive && setPins(new Set(Array.isArray(look?.pinned) ? (look.pinned as string[]) : [])))
      .catch(() => alive && setPins(new Set()));
    return () => {
      alive = false;
    };
  }, [companyKey, userKey]);
  const togglePin = useCallback((key: string) => {
    setPins((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      void looksApi.put("nav", { pinned: [...next] }).catch(() => {});
      return next;
    });
  }, []);
  /** Группы колонки с видами на своих местах (`GROUPS.views`). */
  const allGroups = useMemo(
    () =>
      GROUPS.map((group) => {
        const place = group.views;
        if (!place) return group;
        const own = known.filter((view) => view.source === place.source).map((view) => viewItems(view)[0]);
        const items = [...group.items];
        const at = place.after ? items.findIndex((item) => item.key === place.after) + 1 : 0;
        items.splice(at, 0, ...own);
        return { ...group, items };
      }),
    [known],
  );
  /** Все разрешённые разделы - для поиска, где пустые и незакреплённые тоже находятся. */
  const allowedItems = useMemo(() => allGroups.flatMap((group) => group.items.filter(visible)), [allGroups, visible]);
  /** Стоит ли пункт в колонке: вид - закреплён у человека, раздел - есть строки; своя отметка и открытый - всегда. */
  const shown = useCallback(
    (item: SectionItem) => {
      if (pins.has(item.key) || (picked !== null && item.key === navKey(picked))) return true;
      return item.view ? item.view.pinned : !emptySections.has(item.key);
    },
    [emptySections, pins, picked],
  );
  const groups = useMemo(
    () =>
      allGroups
        .map((group) => ({ ...group, items: group.items.filter((item) => visible(item) && shown(item)) }))
        .filter((group) => group.items.length),
    [allGroups, visible, shown],
  );
  /**
   * Строка мест: разделы и виды колонки, кроме редких (`MORE_SECTIONS`), -
   * их человек ставит в строку своей отметкой. «Ещё» - всё остальное, что ему
   * открыто: редкие места, пустые разделы и незакреплённые виды.
   */
  const strip = useMemo(
    () => groups.flatMap((group) => group.items).filter((item) => !MORE_SECTIONS.has(item.key) || pins.has(item.key)),
    [groups, pins],
  );
  const more = useMemo(() => {
    const inStrip = new Set(strip.map((item) => item.key));
    return allowedItems.filter((item) => !inStrip.has(item.key));
  }, [allowedItems, strip]);
  const placesRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!moreOpen) return;
    // Закрывается щелчком мимо и Esc - как любое окно KORT.
    const onDown = (event: PointerEvent) => {
      if (placesRef.current && !placesRef.current.contains(event.target as Node)) setMoreOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setMoreOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [moreOpen]);
  /** «Не выставлены» - вид, если он есть: туда ведёт пункт «Счета пора выставить» главной. */
  const unbilledSection = useMemo(() => {
    const view = known.find((item) => item.source === "unbilled");
    return view ? viewNav(view) : null;
  }, [known]);
  const [last, setLast] = useState<Section | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- хранилище читается только в браузере
    setLast(readLast());
  }, []);
  /**
   * Без раздела в адресе - последний открытый, иначе первый в колонке.
   *
   * Разделов нет (сотрудник, которому ещё ничего не открыли) - всё равно
   * главный экран, а не кабинет: пустая колонка и предупреждение на месте
   * раздела (`NoSections`). Право, выданное, пока человек смотрит, открывает
   * раздел само: `me` перечитывается раз в 20 с.
   *
   * «Долги» без вида (прежний адрес, ссылки «Сегодня») - первый вид «Долгов»
   * из видных человеку; его нет - долги без отбора.
   */
  const firstDebts = useMemo(() => known.find((view) => view.source === "debts" && view.key) ?? null, [known]);
  const { home, section, sectionItem, hasSections, registry } = useMemo(() => {
    // Вход - главный экран (этап 3): день начинается с того, что ждёт решения.
    // Без права на «Сегодня» - последний открытый раздел, иначе первый в строке.
    const lastItem = itemOf(last);
    const todayItem = itemOf("today");
    const firstKey = groups[0]?.items[0]?.key ?? null;
    const entry: Section | null =
      todayItem && visible(todayItem) ? "today" : lastItem && visible(lastItem) ? lastItem.key : firstKey;
    // Вход в реестр - формой по привычке учётки, а не тем, что открывался
    // последним в этом браузере (29.09.2026); на новом компьютере, где
    // «последнего» нет, - тоже. Показанная форма сразу становится выбором этой
    // вкладки (эффект ниже), поэтому опрос `me` раз в 20 с с новой привычкой
    // не перекинет открытые карточки на таблицу посреди работы.
    const entryRegistry = entry ? registryOf(entry) : undefined;
    const allowedModes = entryRegistry ? new Set(formsOf(entryRegistry).map((mode) => mode.key)) : undefined;
    const homeKey: Section | null = entryRegistry
      ? (chooseMode(entryRegistry.nav, habitOwner, meHabits, allowedModes) ?? entry)
      : entry;
    let current: Section | null = picked ?? homeKey;
    if (current === "debts" && firstDebts) current = viewNav(firstDebts);
    const baseItem = itemOf(current);
    return {
      home: homeKey,
      section: current,
      sectionItem: baseItem,
      hasSections: groups.length > 0,
      registry: current ? registryOf(current) : undefined,
    };
  }, [last, groups, visible, picked, habitOwner, meHabits, itemOf, formsOf, firstDebts]);
  const allowed = sectionItem ? visible(sectionItem) : false;
  const money = canAny(me, MONEY_RESOURCES);
  const setSection = useCallback((next: Section | string) => {
    const key = sectionOf(next) ?? "today";
    setSectionState(key);
    writeLast(key);
    writeMode(key);
    // Запись открытого договора, лист и вкладки кабинета принадлежат своему
    // экрану - при смене раздела они уходят из адреса.
    writeParams({ s: key, id: null, v: null, t: null, d: null, bill: null, p: null }, true);
  }, []);
  /**
   * Досье участника из любого места - из стороны в карточке договора:
   * раздел «Участники» с досье по `p`. Назад - туда, откуда пришли (запись
   * истории новая).
   */
  useEffect(() => {
    const onParticipant = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      if (!id) return;
      setSectionState("participants");
      writeLast("participants");
      writeParams({ s: "participants", p: id, id: null, v: null, t: null, d: null, bill: null }, true);
    };
    window.addEventListener(PARTICIPANT_EVENT, onParticipant);
    return () => window.removeEventListener(PARTICIPANT_EVENT, onParticipant);
  }, []);
  /** Раздел с выбранным списком - из досье ТОО и других карточек (`openSection`). */
  const scopeRef = useRef("");
  useEffect(() => {
    const onSection = (event: Event) => {
      const go = (event as CustomEvent<SectionGo>).detail;
      const key = sectionOf(go?.section);
      if (!key) return;
      for (const [name, value] of Object.entries(go.session ?? {})) writeSession(scopeRef.current, name, value);
      setSectionState(key);
      writeLast(key);
      writeParams({ s: key, p: null, id: null, v: null, t: null, d: null, bill: null }, true);
    };
    window.addEventListener(SECTION_EVENT, onSection);
    return () => window.removeEventListener(SECTION_EVENT, onSection);
  }, []);
  /**
   * «Карточки · Таблица»: явный выбор - голос в привычку учётки и выбор этой
   * вкладки (`habits.ts`, `writeSessionMode`).
   */
  const pickView = useCallback(
    (next: Section) => {
      const target = registryOf(next);
      if (target && next !== section) {
        pickMode(habitOwner, target.nav, next);
        writeSessionMode(next);
      }
      setSection(next);
    },
    [section, setSection, habitOwner],
  );
  /**
   * Пункт колонки: у реестра - форма по привычке учётки или выбранная в этой
   * вкладке; у «Не выставлены» - отбор вида (юрлицо, отдел) на месте фильтров списка.
   */
  const openNav = useCallback(
    (key: Section) => {
      const found = registryOf(key);
      if (found) {
        setSection(chooseMode(key, habitOwner, meHabits, new Set(formsOf(found).map((mode) => mode.key))) ?? key);
        return;
      }
      const view = itemOf(key)?.view;
      if (view?.source === "unbilled") {
        writeSession(scopeRef.current, "inv.side", "todo");
        writeSession(scopeRef.current, "inv.bills.own", view.params.own ?? "");
        writeSession(scopeRef.current, "inv.bills.department", view.params.department ?? "");
      }
      setSection(key);
    },
    [setSection, habitOwner, meHabits, formsOf, itemOf],
  );
  /** Откуда пришли в кабинет - туда и возвращает «← К учёту». */
  const [cameFrom, setCameFrom] = useState<Section | null>(null);
  const openCabinet = useCallback(() => {
    if (section && section !== "me") setCameFrom(section);
    setSection("me");
  }, [section, setSection]);
  /**
   * Из кабинета - к учёту: туда, откуда пришли, иначе на главный раздел; без
   * разделов - на главный экран с предупреждением. Одна дорога у «← К учёту»
   * и у знака KORT в шапке.
   */
  const leaveCabinet = useCallback(() => {
    const came = itemOf(cameFrom);
    const back = came && came.key !== "me" && visible(came) ? came.key : home;
    if (back) setSection(back);
    else {
      setSectionState(null);
      writeParams({ s: null, id: null, v: null, t: null, d: null, bill: null, p: null }, true);
    }
  }, [cameFrom, visible, home, setSection, itemOf]);
  /**
   * Знак KORT - «на главную» (29.09.2026): до того из кабинета на главную
   * вела только «← К учёту» на портрете. В кабинете знак дышит - подсказка,
   * что он и есть дорога назад.
   */
  const goHome = useCallback(() => {
    if (section === "me") leaveCabinet();
    else if (home && home !== section) setSection(home);
  }, [section, home, leaveCabinet, setSection]);
  const openContract = useCallback((id: string) => {
    setSectionState("contracts");
    writeParams({ s: "contracts", id, v: null, t: null, d: null, bill: null, p: null }, true);
  }, []);
  /**
   * «Найти или сделать» (ядро, фаза 8): Ctrl+K в любом разделе - по коду
   * клавиши, а не по букве, иначе в русской раскладке («л») не срабатывало бы.
   * В листе Univer сочетание остаётся листу: там это вставка ссылки.
   */
  const [finding, setFinding] = useState(false);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.code !== "KeyK" || event.altKey || event.shiftKey) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target?.closest(".usheet")) return;
      event.preventDefault();
      setFinding((value) => !value);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const [pending, setPending] = useState(0);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- число приходит вместе с me
    setPending(me?.pending_requests ?? 0);
  }, [me?.pending_requests]);
  /**
   * Просьбы о сбросе видно и с другой вкладки браузера: число в заголовке.
   * Кнопка «N запросов» в раме видна, только пока смотришь на раздел.
   * Туда же - непрочитанные ответы поддержки: человек, ушедший в другую
   * вкладку, увидит ответ по заголовку.
   */
  const seesRequests = can(me, "people", "edit");
  const supportUnread = useSupportUnread(me?.support);
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\)\s/, "");
    const waiting = (seesRequests ? pending : 0) + supportUnread;
    document.title = waiting > 0 ? `(${waiting}) ${base}` : base;
  }, [pending, seesRequests, supportUnread]);

  /**
   * Права могут поменяться, пока человек в разделе: `me` перечитывается раз в
   * 20 с, пока вкладка видна, - колонка перестраивается, «N запросов»
   * обновляется. 403 на любом запросе перечитывает сразу (фронт-план, 3.4):
   * раньше это было только обещанием плана, и отобранный реестр минуту стоял
   * на экране с подписью «Нет связи».
   */
  const [authNotice, setAuthNotice] = useState("");
  const refreshMe = useCallback(async () => {
    try {
      const next = await financeApi.me();
      if (!next.authenticated) setAuthNotice("Сеанс завершён - войдите снова");
      setMe(next.authenticated ? next : null);
    } catch (exc) {
      if (exc instanceof FinanceApiError && exc.status === 401) setMe(null);
    }
  }, [setMe]);
  useEffect(() => {
    if (!me) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refreshMe();
    }, ME_POLL_MS);
    return () => clearInterval(timer);
  }, [me, refreshMe]);
  const signedIn = me !== null;
  // Минуты работы в виде реестра - в привычку учётки (`habits.ts`).
  useModeTracker(signedIn ? habitOwner : "", registry?.nav ?? null, registry && allowed ? section : null);
  // Открытый вид реестра - выбор этой вкладки: новая привычка с опроса его не сменит.
  useEffect(() => {
    if (signedIn && registry && section) writeSessionMode(section);
  }, [signedIn, registry, section]);
  useEffect(() => {
    if (!signedIn) return;
    // Сеанс закрыли (блокировка, сброс, «Завершить сеансы») - ко входу со
    // словами, а не кабинет со своим именем и чужой ошибкой внутри.
    const lost = () => {
      setAuthNotice("Сеанс завершён - войдите снова");
      setMe(null);
    };
    // Не чаще раза в 3 с - но сигнал внутри этих секунд не теряется, а
    // откладывается: права, сменившиеся сразу после открытия страницы,
    // иначе доезжали только с опросом через 20 с.
    let lastCheck = 0;
    let later = 0;
    const forbidden = () => {
      const wait = lastCheck + 3000 - Date.now();
      if (wait > 0) {
        if (!later) {
          later = window.setTimeout(() => {
            later = 0;
            lastCheck = Date.now();
            void refreshMe();
          }, wait);
        }
        return;
      }
      lastCheck = Date.now();
      void refreshMe();
    };
    window.addEventListener(AUTH_LOST_EVENT, lost);
    window.addEventListener(FORBIDDEN_EVENT, forbidden);
    window.addEventListener(SCHEMA_EVENT, forbidden);
    return () => {
      window.clearTimeout(later);
      window.removeEventListener(AUTH_LOST_EVENT, lost);
      window.removeEventListener(FORBIDDEN_EVENT, forbidden);
      window.removeEventListener(SCHEMA_EVENT, forbidden);
    };
  }, [signedIn, setMe, refreshMe]);

  /** Сигнал «открыт раздел» в журнал действий; сервер сам держит «не чаще раза в минуту». */
  useEffect(() => {
    if (!me?.company || !sectionItem?.resource || !allowed) return;
    void peopleApi.audit.view(sectionItem.resource).catch(() => undefined);
  }, [me?.company, sectionItem?.resource, allowed]);
  /**
   * Новый раздел открывается с начала.
   *
   * Иначе прокрутка оставалась там, где был прошлый раздел: пункт «Правила»
   * внизу колонки нажимали, прокрутив страницу, и новый раздел рисовался выше
   * экрана - человек видел пустоту и листал наверх сам. Первое открытие
   * пропускается: страница и так в начале, а прыжок при загрузке мешал бы
   * якорю в адресе, если он когда-нибудь появится.
   */
  const firstSection = useRef(true);
  useEffect(() => {
    if (firstSection.current) {
      firstSection.current = false;
      return;
    }
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [section]);
  /**
   * Высота липкой шапки - переменной `--fin-head-h` на странице.
   *
   * Колонка разделов, шапка списка договоров и полоса записи разбора липнут
   * к окну, а шапка «Финансов» липнет поверх них. Отступ был прибит в 0.75rem
   * от края окна, и после прокрутки верх колонки («Договоры», «Реестр»)
   * уезжал под шапку: на MacBook (окно ~790px) и в длинной «Настройке
   * реестра» - всегда. Высота шапки меняется (перенос кнопок, другая ширина),
   * поэтому она меряется, а не записывается числом.
   */
  const headObserver = useRef<ResizeObserver | null>(null);
  const measureHead = useCallback((node: HTMLElement | null) => {
    headObserver.current?.disconnect();
    headObserver.current = null;
    if (!node) return;
    const page = node.parentElement;
    const put = () => page?.style.setProperty("--fin-head-h", `${Math.round(node.getBoundingClientRect().height)}px`);
    put();
    if (typeof ResizeObserver === "undefined") return;
    headObserver.current = new ResizeObserver(put);
    headObserver.current.observe(node);
  }, []);
  const [dictionaries, setDictionaries] = useState<Dictionaries | null>(null);
  const [error, setError] = useState<string>("");
  /**
   * Чьё запомненное состояние (`session-state.tsx`): учётка и компания. До
   * входа - пусто, и открытое перед перезагрузкой окно операции встаёт, как
   * только вход известен.
   */
  const sessionScope = me?.user?.id ? `${me.user.id}:${me.company?.id ?? ""}` : "";
  // Слушатель перехода в раздел (`SECTION_EVENT`) читает учётку из ссылки - пишется после отрисовки.
  useEffect(() => {
    scopeRef.current = sessionScope;
  }, [sessionScope]);
  /**
   * Откуда открыли «Настроить реестр» и «Загрузить Excel» - туда «назад» и
   * после загрузки (01.10.2026: из «Разовых ЮО» возвращало в основной
   * «Реестр»). Переживает перезагрузку вместе с адресом экрана.
   */
  const [setupFrom, setSetupFrom] = useSessionStateIn<Section | null>(
    sessionScope,
    sessionScope ? "fin.setup-from" : null,
    null,
  );
  const goFromRegistry = useCallback(
    (next: Section | string) => {
      if ((next === "contracts-setup" || next === "contracts-import") && section && registryOf(section)) {
        setSetupFrom(section);
      }
      setSection(next);
    },
    [section, setSection, setSetupFrom],
  );
  const setupBack: Section = setupFrom && registryOf(setupFrom) ? setupFrom : "contracts";
  const setupBackTitle = bookTitle(registrySchema, registryOf(setupBack)?.book ?? "");
  /**
   * Выход - один для кабинета и экрана временного пароля (там его не было до
   * 01.10.2026, уйти можно было только очисткой cookie).
   */
  const logout = useCallback(async () => {
    await financeApi.logout().catch(() => undefined);
    // Компьютер бывает общим: черновики вышедшего не ждут следующего.
    // Второй раз - после того как экраны снялись: лист, снимаясь,
    // запоминает своё место.
    dropAllSessions();
    forgetLooks();
    forgetRegistry();
    forgetSupport();
    setAuthNotice("");
    // Выходят из кабинета, и раздел «кабинет» оставался выбранным:
    // следующий вход - свой или чужой - открывался кабинетом, а не
    // главным экраном (28.09.2026). Раздел и адрес - с чистого листа.
    setSectionState(null);
    setCameFrom(null);
    writeParams({ s: null, id: null, v: null, t: null, d: null, bill: null, p: null }, false);
    setMe(null);
    window.setTimeout(dropAllSessions, 300);
  }, [setMe]);
  /**
   * Счётчик перезагрузок. Меняется, когда данные изменились где угодно в
   * разделе, и по нему обновляются и сводка слева, и открытый экран.
   *
   * Счётчик, а не флаг: два изменения подряд с флагом дали бы одну
   * перезагрузку, и вторая правка осталась бы не видна на быстром наборе.
   */
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  const companyId = me?.company?.id ?? null;

  useEffect(() => {
    // Справочники - у денежных разделов. Юристу с одними договорами они не
    // открыты: запрос ответил бы 403 и повесил бы над реестром чужую ошибку.
    if (!companyId || !money) return;
    let alive = true;
    (async () => {
      try {
        const dicts = await financeApi.dictionaries();
        if (!alive) return;
        setDictionaries(dicts);
        setError("");
      } catch (exc) {
        if (!alive) return;
        setError(exc instanceof Error ? exc.message : "Не удалось прочитать данные раздела");
      }
    })();
    return () => {
      alive = false;
    };
    // Компания в зависимостях не для порядка: при переключении надо перечитать
    // всё, иначе на экране останутся счета и операции прежней компании.
  }, [revision, companyId, money]);

  const content = useMemo(() => {
    if (!me) return null;
    if (!section) return <NoSections onCabinet={() => setSection("me")} />;
    if (!allowed) {
      return (
        <p className="fin-denied">
          Нет доступа к разделу «{sectionItem?.title ?? ""}». Доступ даёт администратор.
        </p>
      );
    }
    switch (section) {
      case "contracts":
        return <Registry me={me} onGo={goFromRegistry} book="" />;
      case "contracts-sheet":
        return <SheetScreen me={me} />;
      case "contracts-import":
        return (
          <RegistryImport
            onDone={() => {
              if (me.company) void boot(me.company.id, me.user?.id ?? null, true);
              setSection(setupBack);
            }}
            onCancel={() => setSection(setupBack)}
          />
        );
      case "contracts-setup":
        return <SetupScreen me={me} onBack={() => setSection(setupBack)} backLabel={setupBackTitle} />;
      case "today":
        return <HomeScreen onGo={setSection} unbilledSection={unbilledSection} />;
      case "cash-calendar":
        return <CashCalendarScreen />;
      case "profit":
        return <RevenueSection me={me} section="profit" measure="accrued" />;
      case "group":
        return <GroupScreen />;
      case "start":
        return <StartScreen />;
      case "participants":
        return <ParticipantsScreen me={me} />;
      case "shadow":
        return <ShadowScreen me={me} />;
      case "vat":
        return <VatScreen me={me} />;
      default:
        break;
    }
    // Виды (`core/views.py`): книга листов - карточками или таблицей.
    if (section.startsWith("cards.")) return <BookCardsScreen me={me} onGo={goFromRegistry} book={section.slice(6)} />;
    if (section.startsWith("sheet.")) return <BookSheetScreen me={me} book={section.slice(6)} />;
    if (!dictionaries) return null;
    switch (section) {
      case "debts":
        return <DebtsSection me={me} />;
      case "import":
        return <ImportPanel onChanged={reload} accounts={dictionaries.accounts} onNext={() => setSection("today")} />;
      case "dictionaries":
        return <DictionariesPanel dictionaries={dictionaries} onChanged={reload} />;
      case "invoices":
        return <InvoicesPanel dictionaries={dictionaries} onChanged={reload} />;
      case "integrations":
        return (
          <IntegrationsPanel
            accounts={dictionaries.accounts}
            onGo={setSection}
            onChanged={reload}
            canEdit={can(me, "integrations", "edit")}
          />
        );
      default:
        break;
    }
    // «Долги» вида - его сторона, основание и группа, отбор вида на сервере;
    // «Не выставлены» вида - «Счета» с отбором вида на месте фильтров списка (`openNav`).
    if (section.startsWith("debts.")) {
      return (
        <DebtsSection me={me} view={sectionItem?.view} />
      );
    }
    if (section.startsWith("unbilled.")) return <InvoicesPanel dictionaries={dictionaries} onChanged={reload} />;
    return null;
  }, [
    section,
    sectionItem,
    allowed,
    dictionaries,
    reload,
    me,
    setSection,
    unbilledSection,
    goFromRegistry,
    setupBack,
    setupBackTitle,
  ]);

  if (loading) return <AuthLoading offline={offline} />;
  if (!me) {
    return (
      <AuthGate
        key={authNotice}
        notice={authNotice}
        onReady={(next) => {
          setAuthNotice("");
          setMe(next);
        }}
      />
    );
  }
  if (me.user?.must_change_password) {
    return (
      <PasswordChangeGate
        onDone={async () => {
          try {
            const next = await financeApi.me();
            setMe(next.authenticated ? next : null);
          } catch {
            setMe(null);
          }
        }}
        onLogout={() => void logout()}
      />
    );
  }

  return (
    <SessionScope scope={sessionScope}>
    <div className="fin-page">
      <DesktopBars />
      <DeviceApprovalBar devices={me.pending_devices ?? []} onDecided={() => void refreshMe()} />
      <header className="fin-head" ref={measureHead}>
        <button
          type="button"
          className="fin-brand"
          data-pulse={section === "me" ? "true" : undefined}
          onClick={goHome}
          title="На главную"
          aria-label="KORT - на главную"
        >
          <KortWordmark className="fin-brand-mark" />
        </button>
        {/* Компания в шапке, а не название раздела: человек ведёт несколько
            компаний, и первое, что ему надо знать, - в какой он сейчас. */}
        <div className="fin-head-company flex flex-col mr-auto min-w-0">
          <span
            className="fin-head-title text-sm font-semibold truncate"
            style={{ letterSpacing: "-0.01em" }}
          >
            {me.company?.title ?? "KORT"}
          </span>
          {(me.companies?.length ?? 0) > 1 ? (
            <select
              className="fin-head-sub text-xs bg-transparent cursor-pointer"
              style={{ border: "none", outline: "none", padding: 0 }}
              value={me.company?.id ?? ""}
              onChange={async (event) => {
                // Отказ («Эта компания вам не открыта») - словами над разделом,
                // а не молча: выбор в шапке просто откатывался бы назад.
                try {
                  const next = await financeApi.switchCompany(event.target.value);
                  setMe(next);
                  reload();
                } catch (exc) {
                  setError(exc instanceof Error ? exc.message : "Компания не открылась");
                }
              }}
              aria-label="Сменить компанию"
            >
              {(me.companies ?? []).map((company) => (
                <option key={company.id} value={company.id}>
                  {company.title}
                </option>
              ))}
            </select>
          ) : null}
        </div>

        {pending > 0 && can(me, "people", "edit") ? (
          <button type="button" className="fin-head-requests" onClick={openCabinet}>
            {pending} {plural(pending, "запрос", "запроса", "запросов")}
          </button>
        ) : null}

        {/* «+ Доход / − Расход / ⇄ Перевод» здесь больше нет (28.09.2026): шапку
            видят все отделы, а записывать деньги - дело финансов. Кнопки - у
            заголовка «Журнала», см. `operationActions` выше. */}
        {/* «Найти или сделать» - и кнопкой: на телефоне Ctrl+K нет. */}
        {seesContracts ? (
          <button
            type="button"
            className="fin-icon-btn fin-head-find"
            onClick={() => setFinding(true)}
            title="Найти или сделать · Ctrl+K"
            aria-label="Найти или сделать"
          >
            <SearchIcon size={16} />
          </button>
        ) : null}
        {/* Поддержка - у всех, кто вошёл, и без единого открытого раздела. */}
        <SupportButton unread={supportUnread} onOpen={openSupport} />
        {money ? (
          <button
            type="button"
            className="fin-icon-btn fin-head-person-icon only-desktop"
            onClick={reload}
            title="Перечитать данные"
            aria-label="Перечитать данные"
          >
            <RefreshIcon size={16} />
          </button>
        ) : null}
        {/* Тема - тем же тумблером, что на входе; строки «Тема» в кабинете нет. */}
        <ThemeSwitch className="fin-head-theme" />
        {/* Имя вместо «Выйти»: выход - редкое действие, он в кабинете. */}
        <button
          type="button"
          className="fin-head-person only-desktop"
          data-on={section === "me" ? "true" : undefined}
          onClick={openCabinet}
          title="Личный кабинет"
        >
          {shortName(nameOf(me)) || "Личный кабинет"}
        </button>
        <button
          type="button"
          className="fin-icon-btn fin-head-person-icon only-mobile"
          onClick={openCabinet}
          aria-label="Личный кабинет"
        >
          <PersonIcon size={18} />
        </button>
      </header>

      {error ? (
        <div
          className="mx-3 sm:mx-4 mt-3 px-3 py-2 text-xs card-inner flex items-start gap-2"
          style={{ borderColor: "var(--outflow-border)", background: "var(--outflow-bg)", color: "var(--text-primary)" }}
        >
          <span style={{ flex: 1 }}>{error}</span>
          <button type="button" onClick={() => setError("")} aria-label="Скрыть сообщение">
            <CloseIcon size={14} />
          </button>
        </div>
      ) : null}

      {section === "me" ? (
        <div className="fin-plate" data-cabinet="true">
          <main className="fin-body fin-body-cabinet min-w-0" data-measure="full">
            <Cabinet
              me={me}
              onMe={(next) => {
                setMe(next);
                reload();
              }}
              onBack={leaveCabinet}
              onLogout={logout}
              onOpenContract={openContract}
              onPending={setPending}
              hasSections={hasSections}
            />
          </main>
        </div>
      ) : (
      <div className="fin-plate">
        <div className="fin-places" ref={placesRef}>
          <nav className="fin-tabs" aria-label="Места KORT">
            {hasSections ? null : <span className="fin-tab">Разделы пока не открыты</span>}
            {strip.map((item) => (
              <button
                key={item.key}
                type="button"
                className="fin-tab"
                data-on={section ? navKey(section) === item.key : false}
                onClick={() => openNav(item.key)}
              >
                {item.title}
              </button>
            ))}
            {more.length ? (
              <button
                type="button"
                className="fin-tab"
                aria-expanded={moreOpen}
                aria-haspopup="menu"
                data-on={section ? more.some((item) => navKey(section) === item.key) : false}
                onClick={() => setMoreOpen((value) => !value)}
              >
                Ещё
              </button>
            ) : null}
          </nav>
          {moreOpen ? (
            <div className="fin-more" role="menu" aria-label="Ещё места">
              {more.map((item) => (
                <div key={item.key} className="fin-more-row">
                  <button
                    type="button"
                    role="menuitem"
                    className="fin-more-item"
                    data-on={section ? navKey(section) === item.key : false}
                    onClick={() => {
                      setMoreOpen(false);
                      openNav(item.key);
                    }}
                  >
                    {item.title}
                  </button>
                  <button type="button" className="fin-link-btn" onClick={() => togglePin(item.key)}>
                    {pins.has(item.key) ? "убрать из строки" : "в строку"}
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <main className="fin-body min-w-0" data-measure={section ? measureOf(section) : "data"}>
          {/* Заголовок раздела. Пока разделы были лентой вкладок, лента и была
              верхом страницы; когда она ушла в колонку, содержимое упёрлось в
              край плиты, и страница читалась обрезанной. */}
          {/* Смена раздела: заголовок поднимается буквами, содержимое
              проявляется. key обязателен у обоих - SplitText переписывает DOM
              надписи, и сменить её текст на месте React уже не сможет. Ключи
              у соседей разные: одинаковые (оба `section`) React в сборке не
              различал, и старые заголовки не удалялись - копились над новыми. */}
          {!section ? (
            <SplitReveal key="title-none" as="h1" className="fin-section-title" duration={0.9}>
              Нет доступа
            </SplitReveal>
          ) : registry ? (
            // Реестр - заголовком, его виды - рядом: «Карточки · Таблица».
            // Заголовок не пересобирается при смене вида (ключ - реестр и его
            // подпись): буквы поднимаются, только когда сменился сам реестр.
            // Подпись в ключе - та, что показана (из схемы реестра), а не
            // название пункта колонки: схема приходит позже видов, и по
            // прямому адресу листа («?s=contracts-oneoff») буквы оставались
            // от ключа - «oneoff» вместо «Разовые ЮО».
            // На узком окне заголовков нет - виды встают своим рядом под
            // лентой разделов (`fin-modes` ниже).
            <div className="fin-title-bar fin-reg-title">
              <SplitReveal
                key={`title-${registry.nav}-${bookTitle(registrySchema, registry.book)}`}
                as="h1"
                className="fin-section-title"
                duration={0.9}
              >
                {bookTitle(registrySchema, registry.book)}
              </SplitReveal>
              <nav className="fin-views" aria-label="Вид реестра">
                {formsOf(registry).map((mode) => (
                  <button
                    key={mode.key}
                    type="button"
                    className="fin-view"
                    aria-current={mode.key === section ? "page" : undefined}
                    onClick={() => pickView(mode.key)}
                  >
                    {mode.title}
                  </button>
                ))}
              </nav>
              <RegistryActions book={registry.book} onGo={goFromRegistry} />
            </div>
          ) : (
            <SplitReveal key={`title-${section}`} as="h1" className="fin-section-title" duration={0.9}>
              {sectionItem?.title ?? ""}
            </SplitReveal>
          )}
          {registry ? (
            <nav className="fin-modes" aria-label="Вид реестра">
              {formsOf(registry).map((mode) => (
                <button
                  key={mode.key}
                  type="button"
                  className="fin-mode"
                  aria-current={mode.key === section ? "page" : undefined}
                  onClick={() => pickView(mode.key)}
                >
                  {mode.title}
                </button>
              ))}
            </nav>
          ) : null}
          <FadeIn key={`body-${section}`}>{content}</FadeIn>
        </main>
      </div>
      )}

      <SupportLayer me={me} onRefresh={() => void refreshMe()} />
      {seesContracts ? (
        <FindLayer
          me={me}
          open={finding}
          sections={allowedItems.map((item) => ({ key: item.key, title: item.title }))}
          onClose={() => setFinding(false)}
          onSection={setSection}
          onContract={openContract}
          onParticipant={openParticipant}
        />
      ) : null}
    </div>
    </SessionScope>
  );
}
