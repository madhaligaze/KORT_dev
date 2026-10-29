/**
 * Клиент раздела «Финансы».
 *
 * `credentials: "include"` обязателен: маршруты закрыты правом «finance» за
 * логином дашборда, и без куки каждый запрос вернул бы 401.
 *
 * Ошибки разворачиваются в текст один раз здесь, а не в каждом экране. FastAPI
 * кладёт человеческое объяснение в `detail`, и оно бывает единственным, что
 * человек увидит: «счёт не найден», «операцию уже изменили». Показать вместо
 * него «Request failed with status 400» - значит потерять смысл отказа.
 */
const API = "/api/backend/api/v1/finance";

export type Money = string;

export type Account = {
  id: string;
  name: string;
  kind: string;
  currency: string;
  /** `null` - остатки человеку не открыты (право «Остатки и долги» или справочники). */
  starting_balance: Money | null;
  excluded_from_reports: boolean;
  /** Номер счёта в банке (IBAN). По нему выписка находит свой счёт. */
  number?: string;
};

export type AccountBalance = Account & {
  balance: Money;
  balance_with_plan: Money;
};

export type DictEntry = { id: string; name: string };
export type Category = DictEntry & {
  side: "income" | "expense";
  system_key: string;
  /** Природа статьи для показателей: себестоимость, операционный, капитал… */
  nature?: string;
};
export type Counterparty = DictEntry & { role: string };
export type Project = DictEntry & { closed: boolean };

export type Dictionaries = {
  accounts: Account[];
  categories: Category[];
  counterparties: Counterparty[];
  projects: Project[];
  tags: DictEntry[];
};

export type Company = { id: string; title: string; role: string };

export type AccessLevel = "none" | "view" | "edit";
export type MemberRole = "owner" | "admin" | "employee";

export type Me = {
  authenticated: boolean;
  user?: { id: string; email: string; phone?: string; full_name: string; must_change_password: boolean };
  company?: Company | null;
  companies?: Company[];
  /** Прежние способности: read | write | accounts | people | company.
   *  Для экранов, ещё не переведённых на `access`. */
  abilities?: string[];
  role?: MemberRole | null;
  /** Вид раздела по привычке учётки (`habits.ts`): группа → вид. */
  habits?: Record<string, string>;
  /** Раздел прав → уровень. Владельцу и администратору - всё «edit». */
  access?: Record<string, AccessLevel>;
  contracts_scope?: {
    rows: "all" | "department" | "own";
    entities: string[];
    /** Отделы, договоры которых видны вдобавок к своим, - только просмотр. */
    departments?: string[];
    fields: Record<string, AccessLevel>;
  };
  /**
   * Чьих сотрудников человек видит и меняет правом «Сотрудники и права»:
   * `department` - начальник отдела, только люди своего отдела.
   */
  people_scope?: { rows: "all" | "department"; department_id: string | null };
  /** Открытые просьбы к администраторам - «N запросов» в раме. */
  pending_requests?: number;
  /** Входы с новых устройств, ждущие решения этого человека (слабый пароль). */
  pending_devices?: PendingDevice[];
  employee?: {
    id: string;
    full_name: string;
    job_title: string;
    department: { id: string; code: string; title: string } | null;
  } | null;
  /** Переписка с поддержкой KORT: непрочитанные ответы и объявление дня. */
  support?: SupportState;
  /** Невыставленные счета книги-сводки - число у пункта «Счета». `null` - не подключено или не открыто. */
  bills?: { overdue: number; soon: number } | null;
};

/** Вход с нового устройства, ждущий подтверждения (слабый, но уже заданный пароль). */
export type PendingDevice = {
  id: string;
  user_agent: string;
  ip: string;
  created_at: string | null;
};

/** Ответ входа, когда пароль подошёл, но устройство новое: нужно подтверждение. */
export type DevicePending = { step: "approve_device" };

/** Вход вернул ожидание устройства, а не `me`. */
export function isDevicePending(value: Me | DevicePending): value is DevicePending {
  return (value as DevicePending).step === "approve_device";
}

export type SupportState = {
  /** Ответы поддержки, которые человек ещё не открыл. */
  unread: number;
  /** Самый свежий непрочитанный ответ - для напоминания внизу экрана. */
  last_reply: { id: string; preview: string; at: string } | null;
  /** «Больше не показывать» под объявлением о поддержке. */
  notice_off: boolean;
  /** День (по часам человека), когда объявление уже показано. */
  notice_seen_on: string | null;
};

export type MemberRow = {
  id: string;
  email: string;
  full_name: string;
  status: string;
  last_login_at: string | null;
  role: string;
};

export type SessionRow = {
  id: string;
  created_at: string | null;
  last_seen_at: string | null;
  user_agent: string;
  ip?: string;
  /** Сеанс, из которого смотрят. */
  current?: boolean;
};

export type Overview = {
  workspace: { id: string; title: string; currency: string };
  accounts: AccountBalance[];
  total: Money;
  total_with_plan: Money;
  receivable: Money;
  payable: Money;
  overdue_receivable: Money;
  planned_count: number;
  planned_preview: { id: string; kind: string; paid_at: string; amount: Money; comment: string }[];
};

export type OperationKind = "income" | "expense" | "transfer";

export type Operation = {
  id: string;
  version: number;
  kind: OperationKind;
  status: "fact" | "plan";
  paid_at: string;
  accrued_at: string | null;
  period_start: string | null;
  period_end: string | null;
  amount: Money;
  currency: string;
  amount_base: Money;
  account_from: string;
  account_to: string;
  account_from_id: string | null;
  account_to_id: string | null;
  category: string;
  category_id: string | null;
  counterparty: string;
  counterparty_id: string | null;
  projects: { id: string; name: string; amount: Money }[];
  split_state: string;
  tags: string[];
  comment: string;
  source: string;
  import_batch_id: string | null;
};

export type OperationPage = {
  total: number;
  limit: number;
  offset: number;
  sums: { income: Money; expense: Money };
  items: Operation[];
};

export type CashFlowRow = {
  month: string;
  start_balance: Money;
  income: Money;
  expense: Money;
  net: Money;
  end_balance: Money;
  income_plan: Money;
  expense_plan: Money;
  end_balance_with_plan: Money;
};

export type BreakdownItem = {
  name: string;
  /** Только факт. Ожидания живут отдельно - см. `planned` и `months_plan`. */
  total: Money;
  planned: Money;
  months: Record<string, Money>;
  months_plan: Record<string, Money>;
};

export type Check = { name: string; ok: boolean; left: string; right: string; hint?: string };

export type CashFlow = {
  months: string[];
  opening_balance: Money;
  closing_balance: Money;
  rows: CashFlowRow[];
  breakdown: { income: BreakdownItem[]; expense: BreakdownItem[] };
  checks: Check[];
};

export type ProfitRow = {
  month: string;
  income: Money;
  expense: Money;
  profit: Money;
  income_fact: Money;
  expense_fact: Money;
  margin: string;
};

export type Profit = {
  months: string[];
  rows: ProfitRow[];
  breakdown: { income: BreakdownItem[]; expense: BreakdownItem[] };
};

export type DebtItem = {
  id: string;
  due: string;
  accrued: string;
  amount: Money;
  counterparty: string;
  category: string;
  comment: string;
  overdue_days: number;
};

export type DebtSideReport = {
  total: Money;
  overdue: Money;
  by_counterparty: { name: string; amount: Money }[];
  items: DebtItem[];
};

export type Debts = { as_of: string; receivable: DebtSideReport; payable: DebtSideReport };

export type ProjectsReport = {
  items: { name: string; income: Money; expense: Money; profit: Money; margin: string }[];
  not_split: { income: Money; expense: Money; note: string };
};

export type CalendarDay = {
  date: string;
  income: Money;
  expense: Money;
  income_plan: Money;
  expense_plan: Money;
  balance: Money;
  negative: boolean;
};

export type CalendarMonth = {
  month: string;
  opening_balance: Money;
  days: CalendarDay[];
  cash_gaps: string[];
};

export type PlanCell = {
  month: string;
  fact: Money;
  plan: Money;
  deviation: Money;
  /** Пусто, когда плана нет: «∞%» на месте процента читается как сбой расчёта. */
  done_pct: string | null;
};

export type PlanItem = {
  side: "income" | "expense";
  key: string;
  name: string;
  cells: PlanCell[];
  fact_total: Money;
  plan_total: Money;
};

export type PlanActual = { months: string[]; method: string; items: PlanItem[] };

export type GridColumn = {
  key: string;
  title: string;
  kind: string;
  width: number;
  editable: boolean;
  source: string;
};

export type GridRow = {
  id: string;
  version: number;
  cells: Record<string, string>;
  kind: string;
  status: string;
  split_count: number;
};

export type GridPayload = {
  columns: GridColumn[];
  rows: GridRow[];
  options: Record<string, string[]>;
  total: number;
  /** Номер изменения журнала, с которого лист начинает опрос. */
  seq?: number;
};

export type RuleCondition = { field: string; op: string; value: string };

export type Rule = {
  id: string;
  name: string;
  active: boolean;
  match: string;
  conditions: RuleCondition[];
  actions: Record<string, string>;
  /** Сколько операций правило разметило. Ноль у включённого - условие не совпадает. */
  applied_count: number;
  position: number;
};

/** Группа авторазметки: статья, сколько операций в неё ляжет и на какую сумму. */
export type AutotagGroup = {
  category: string;
  side: "income" | "expense";
  /** Правдива, но почти ничего не говорит: «Покупки без уточнения». */
  broad: boolean;
  /** Чем доказано: тип операции банка, продавец, назначение платежа. */
  reason: string;
  count: number;
  amount: Money;
  examples: string[];
  /** Статья уже есть в справочнике; иначе заведётся. */
  exists: boolean;
};

export type AutotagPreview = { uncategorized: number; covered: number; groups: AutotagGroup[] };

export type RuleSuggestion = {
  keyword: string;
  kind: string;
  count: number;
  amount: Money;
  examples: string[];
};

export type ImportProblem = { field: string; text: string };

export type ImportRow = {
  line: number;
  state: "imported" | "skipped" | "failed" | "duplicate";
  problems: ImportProblem[];
  values: Record<string, unknown>;
  raw: Record<string, unknown>;
  operation_id?: string | null;
};

export type ImportQuestion = {
  kind: string;
  title: string;
  text: string;
  samples: string[];
  options: { value: string; label: string; example: string }[];
  /** Для вопроса о счёте: какой счёт завести, если нужного ещё нет. */
  create?: { name: string; number: string; currency: string };
};

/** Свой счёт из переводов выписки, которого нет в справочнике. */
export type SuggestedAccount = { name: string; number: string; currency: string; rows: number };

/** Ответ на вопросы разбора - копится, пока вопросов не останется. */
export type ImportAnswer = { date_order?: string; default_account?: string };

/** Книга Google, открытая сервисному аккаунту программы. */
export type SheetBook = { id: string; name: string; modified?: string };
export type SheetTab = { title: string; sheet_id: number; rows: number; cols: number; hidden?: boolean };

/**
 * Сверка выписки с банком: что банк напечатал и что получилось из строк.
 * Есть у выписок любого формата, где банк печатает реквизиты и остатки -
 * PDF, Excel, выгрузка 1С.
 */
export type BankCheck = {
  period_start: string | null;
  period_end: string | null;
  opening_balance: Money | null;
  closing_balance: Money | null;
  account_number: string;
  card_number: string;
  account: string | null;
  /** Как выбран счёт: «number» - узнан по номеру, «human» - выбран человеком. */
  account_by?: string;
  owner?: string;
  bank_name?: string;
  file_net: Money;
  expected_closing: Money | null;
  gap: Money | null;
  account_id: string | null;
  starting_balance: Money | null;
  ledger_opening: Money | null;
  earlier_operations: number;
  can_set_start: boolean;
};

export type ImportPreview = {
  batch_id: string;
  file_name: string;
  header_line: number;
  counts: { total: number; ready: number; failed: number; skipped: number; duplicate?: number };
  bank?: BankCheck | null;
  question: ImportQuestion | null;
  /** Что разметили правила: «название правила» → сколько строк. */
  rules_applied?: Record<string, number>;
  date_order: string;
  date_evidence: string;
  mapping: { columns: Record<string, { index: number; header: string; how: string }>; width: number };
  unused_columns: string[];
  accounts_missing: string[];
  /** Счёт, которого нет, → наше юрлицо, названное в нём целиком («Kaspi ТОО "BBC HR"»). */
  accounts_entities?: Record<string, string>;
  /** Наши юрлица - на выбор, чьим заводить счёт (только когда счетов не хватает). */
  entities?: { id: string; name: string; code: string }[];
  accounts_suggested?: SuggestedAccount[];
  rows: ImportRow[];
};

export type ImportBatch = {
  id: string;
  file_name: string;
  status: string;
  created_at: string | null;
  applied_at: string | null;
  rows_total: number;
  rows_imported: number;
  rows_failed: number;
  rows_skipped: number;
  rows_duplicate: number;
  decisions: Record<string, unknown>;
};

export class FinanceApiError extends Error {
  status: number;
  /** Тело ответа. Реестр договоров кладёт туда смысл отказа: 422
   *  `mode_required` со списком полей, 409 `conflict` со свежим договором. */
  body: unknown;
  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

/**
 * Сигналы раме раздела: сеанс пропал (401) и право отобрано (403).
 *
 * Без них каждый экран разбирался сам: заблокированный сотрудник оставался в
 * кабинете со своим именем и красным «Войдите в «Финансы»» во вкладке, а
 * реестр после отзыва права минуту показывал все договоры с «Нет связи».
 * Рама на 401 уводит ко входу, на 403 - перечитывает права.
 */
export const AUTH_LOST_EVENT = "finance:auth-lost";
export const FORBIDDEN_EVENT = "finance:forbidden";
/**
 * Схема реестра сменилась - в том числе потому, что человеку поменяли право
 * на договоры (сервер двигает номер схемы). Рама перечитывает `me` сразу, а не
 * через 20 с: «Только мои» пропадает, как только область сузили до «где
 * ответственный».
 */
export const SCHEMA_EVENT = "finance:schema";
/** Двери входа отвечают 401 на неверный пароль, а подтверждение устройства -
 *  202/403/404: это не потеря сеанса и не отбор прав, их разбирает сам экран. */
const LOGIN_PATHS = /^\/auth\/(login|register|phone\/|device\/)/;

function signal(status: number, path: string): void {
  if (typeof window === "undefined") return;
  if (status === 401 && !LOGIN_PATHS.test(path)) window.dispatchEvent(new Event(AUTH_LOST_EVENT));
  if (status === 403) window.dispatchEvent(new Event(FORBIDDEN_EVENT));
}

/** Что человек видит, когда до сервера не дошло ни одного байта. */
export const OFFLINE_TEXT = "Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.";

/**
 * Текст отказа без `detail`: ответил не API, а то, что стоит перед ним, или
 * API упал, не успев объяснить. «Сервер ответил 502» человеку не говорит,
 * его ли это ошибка и что делать.
 */
export function statusText(status: number): string {
  if (status === 502 || status === 503 || status === 504) return "Сервер не отвечает. Попробуйте ещё раз через минуту.";
  if (status >= 500) return `Сбой на сервере (${status}). Попробуйте ещё раз через минуту.`;
  return `Сервер ответил ${status}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, {
      credentials: "include",
      headers: init?.body instanceof FormData ? undefined : { "Content-Type": "application/json" },
      ...init,
    });
  } catch (exc) {
    // Сеть упала или фронт перезапускается: fetch бросает TypeError с
    // английским «Failed to fetch», и до 01.10.2026 его текст стоял на входе,
    // в кабинете и в журнале. Код 0 - «нет связи»: хранилище реестра по нему
    // ставит правку в очередь, как и раньше.
    if (exc instanceof DOMException && exc.name === "AbortError") throw exc;
    throw new FinanceApiError(OFFLINE_TEXT, 0);
  }
  if (!response.ok) {
    signal(response.status, path);
    let message = statusText(response.status);
    let payload: unknown;
    try {
      const body = await response.json();
      payload = body;
      // `detail` у FastAPI бывает и строкой, и списком ошибок валидации.
      if (typeof body?.detail === "string") message = body.detail;
      else if (Array.isArray(body?.detail)) {
        message = body.detail.map((item: { msg?: string }) => item?.msg ?? "").filter(Boolean).join("; ") || message;
      }
    } catch {
      /* тело не JSON - оставляем код состояния */
    }
    throw new FinanceApiError(message, response.status, payload);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/**
 * Файл с сервера - с именем из `Content-Disposition` и отказом словами
 * сервера, как у `request`. Ссылка `<a download>` отказ сохранила бы файлом.
 */
async function requestFile(path: string): Promise<{ blob: Blob; name: string }> {
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, { credentials: "include" });
  } catch (exc) {
    if (exc instanceof DOMException && exc.name === "AbortError") throw exc;
    throw new FinanceApiError(OFFLINE_TEXT, 0);
  }
  if (!response.ok) {
    signal(response.status, path);
    let message = statusText(response.status);
    try {
      const body = await response.json();
      if (typeof body?.detail === "string") message = body.detail;
    } catch {
      /* тело не JSON - оставляем код состояния */
    }
    throw new FinanceApiError(message, response.status);
  }
  const header = response.headers.get("content-disposition") ?? "";
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header)?.[1];
  let name = "file";
  if (encoded) {
    try {
      name = decodeURIComponent(encoded);
    } catch {
      /* битое имя - остаётся «file» */
    }
  }
  return { blob: await response.blob(), name };
}

const qs = (params: Record<string, string | number | undefined | null>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
};

/** Счёт-фактура: обязательство до денег. */
export type Invoice = {
  id: string;
  kind: "out" | "in";
  number: string;
  status: string;
  issued_at: string;
  due_at: string;
  counterparty: string;
  project: string;
  amount_net: string;
  vat_rate: string;
  vat_amount: string;
  amount_gross: string;
  comment: string;
  paid: boolean;
  overdue_days: number;
  operation_id: string | null;
};

export type InvoiceSide = { total: string; open: string; overdue: string };

/** Группа невыставленного счёта - по словам книги в колонке «Счет». */
export type BillGroup = "overdue" | "soon" | "early" | "undated";

/** Строка книги-сводки: договор за месяц (`contracts/bills.py`); `issued` - «Счет» = TRUE. */
export type Bill = {
  /** Постоянный адрес карточки: ссылка из канала - `?s=invoices&bill=<id>`. */
  id: string;
  line: number;
  group: BillGroup | "issued";
  /** Что написано в «Счет» - как есть: «Просрочка более 5 дней». */
  text: string;
  own: string;
  customer: string;
  number: string;
  month: string;
  kind: string;
  staff: string;
  department: string;
  amount: string | null;
  period_from: string | null;
  period_to: string | null;
  /** «Факт Оплата»: деньги уже пришли - целиком или частью. */
  paid: "" | "paid" | "part";
  status: string;
  note: string;
  /** Поля счёта - как их показывает книга: «312», «22.10.2026». */
  bill_no: string;
  bill_date: string;
  bill_period: string;
  /** Как клиент назван в 1С - по этому названию выставляют счёт. */
  onec_name: string;
  /** «Дата заключения Договора» - как в книге. */
  signed_at: string;
  /** `kort` - счета юрлица ведёт KORT: состояние по начислениям договора; `line` 0 - строки в таблице нет. */
  source?: "" | "kort";
  contract_id?: string | null;
};

/** Что со строкой загруженного шаблона: записать, уже в книге, не заполнена, отказ. */
export type BillsTemplateStatus = "ready" | "same" | "empty" | "error";

/** Строка загруженного шаблона Excel (`contracts/bill_template.py`): какой это счёт и что с ним делать. */
export type BillsTemplateRow = {
  sheet: string;
  row: number;
  /** Адрес счёта - для записи `saveBill`; `null` - счёт не узнан. */
  id: string | null;
  own: string;
  customer: string;
  number: string;
  month: string;
  period_from: string | null;
  period_to: string | null;
  amount: string | null;
  status: BillsTemplateStatus;
  /** Почему строку не записать (`error`). */
  problem: string;
  /** Что уже стоит в книге (`same`). */
  note: string;
  /** Что записать: № и дата (ISO), если вписаны - «Счет за Период» и комментарий. */
  values: Partial<Record<BillField, string>>;
  /** Что дописать, только если в книге пусто: «Счет за Период», как подставляет карточка. */
  defaults: Partial<Record<BillField, string>>;
};

export type BillsTemplateRead = {
  rows: BillsTemplateRow[];
  counts: Record<BillsTemplateStatus, number>;
};

/** Поля карточки, которые KORT пишет в книгу юрлица. */
export type BillField = "bill_no" | "bill_date" | "bill_period" | "note";

/**
 * Строка книги юрлица, где счёт отмечают (`contracts/bill_book.py`). `kort` -
 * строки в таблице нет, счёт записывается в KORT (`core/billing.py`); `place`
 * тогда - заглушка для прежних версий десктопа.
 */
export type BillBook = {
  place: { book: string; tab: string; row: number; url: string };
  kort?: boolean;
  /** Как поля показывает книга сейчас - их же карточка шлёт назад в `expect`. */
  fields: Record<BillField, string>;
  /** «Счет» в книге: TRUE или слова формулы. */
  state: string;
  /** Поля, куда писать нельзя, - с причиной. */
  blocked: Partial<Record<BillField, string>>;
};

export type BillCard = {
  bill: Bill;
  book: BillBook | null;
  /** Почему книги юрлица нет - карточка открыта, записать нельзя. */
  problem: string;
  can_edit: boolean;
};

export type BillSaved = {
  book: BillBook;
  changed: BillField[];
  warning: string;
};

export type BillsBoard = {
  source: {
    title: string;
    worksheet: string;
    url: string;
    read_at: string | null;
    drift: string;
    error: string;
    /** Коды юрлиц, чьи счета ведёт KORT (`core/switch.py`), и отказ расчёта, если был. */
    kort?: string[];
    kort_error?: string;
  } | null;
  items: Bill[];
  /** Выставленные за прошлый и текущий месяц - свежие первыми. */
  issued: Bill[];
  counts: (Record<BillGroup, number> & { overdue_total: string; soon_total: string }) | null;
  /** Канал бота счетов, если он читает книгу этой компании; `hours` - часы напоминаний по Астане. */
  channel: { title: string; url: string; hours: number[] } | null;
  /** Право «Счета: правка» - загрузить шаблон и записать из него в книги. */
  can_edit?: boolean;
};

export type Recurrence = {
  id: string;
  title: string;
  active: boolean;
  kind: string;
  period: string;
  period_title: string;
  day: number;
  amount: string;
  next_at: string;
  until: string | null;
  category: string;
  counterparty: string;
  project: string;
  comment: string;
  waiting: number;
};

export type HistoryEntry = {
  id: string;
  at: string | null;
  actor: string;
  kind: string;
  entity: string;
  entity_id: string | null;
  title: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  undone_at: string | null;
  can_undo: boolean;
};

/** Подключение банка или другого источника операций. */
export type Integration = {
  id: string;
  slug: string;
  title: string;
  kind: "api" | "statement" | "sheets";
  state: string;
  logo: string;
  account: string;
  account_id: string | null;
  settings: Record<string, unknown>;
  received: number;
  last_seen_at: string | null;
  has_token: boolean;
  token?: string;
};

export type BankOption = {
  slug: string;
  title: string;
  logo: string;
  ways: string[];
  parser: string;
};

/** Вид документа 1С: счёт на оплату, реализация (АВР), счёт-фактура, ЭСФ, поступление. */
export type OnecKind = "invoice" | "sale" | "sf" | "esf" | "payment" | "refund";

/** База 1С компании - чтение через автоматический REST-сервис (OData). */
export type OnecBase = {
  id: string;
  title: string;
  url: string;
  login: string;
  state: "active" | "off";
  group_entity_id: string | null;
  group_entity: string;
  organization_ref: string;
  organization_name: string;
  organization_bin: string;
  organizations: Array<{ ref: string; name: string; bin: string }>;
  sync_from: string | null;
  last_sync_at: string | null;
  last_ok_at: string | null;
  last_error: string;
  warnings: string[];
  counts: Partial<Record<OnecKind, number>>;
};

export type OnecDoc = {
  id: string;
  kind: OnecKind;
  number: string;
  date: string;
  amount: string | null;
  posted: boolean;
  party: string;
  party_bin: string;
  contract_number: string;
  signed_at: string | null;
  status: string;
  reg_number: string;
  period_from: string | null;
  period_to: string | null;
  content: string;
  base_id: string;
  how: string;
  manual: string;
};

export type OnecContractBrief = {
  contract_id: string;
  number: string;
  customer: string;
  executor: string;
  amount: string | null;
  billing: string;
};

/** Договор за месяц: что о нём знает 1С - как колонки книг BBC. */
export type OnecRow = OnecContractBrief & {
  invoices: OnecDoc[];
  payments: OnecDoc[];
  paid: string | null;
  sales: OnecDoc[];
  signed_at: string | null;
  esf: OnecDoc[];
  esf_kind: "" | "esf" | "sf";
};

export type OnecLoose = OnecDoc & {
  state: "other_client" | "other_entity" | "ambiguous" | "missing" | "no_entity";
  candidates: string[];
};

export type OnecMonth = {
  month: string;
  rows: OnecRow[];
  unmatched: OnecLoose[];
  candidates: Record<string, OnecContractBrief>;
  totals: { contracts: number; invoices: number; paid: number; sales: number; signed: number; esf: number; unmatched: number };
  months: string[];
};

export type BalanceData = {
  as_of: string;
  assets: { total: string; rows: Array<{ name: string; amount: string; details?: Array<{ name: string; amount: string }> }> };
  liabilities: { total: string; rows: Array<{ name: string; amount: string }> };
  equity: string;
  not_counted: string[];
};

export type IndicatorsData = {
  period: { from: string; to: string };
  revenue: string;
  cogs: string;
  gross_profit: string;
  operating_costs: string;
  ebitda: string;
  depreciation: string;
  operating_profit: string;
  financial_costs: string;
  tax: string;
  net_profit: string;
  gross_margin: string | null;
  ebitda_margin: string | null;
  net_margin: string | null;
  not_counted: string[];
};

export type StatementData = {
  account: { id: string; name: string; kind: string };
  opening_balance: string;
  closing_balance: string;
  income: string;
  expense: string;
  rows: Array<{
    id: string;
    paid_at: string;
    kind: string;
    direction: "in" | "out";
    amount: string;
    balance: string;
    category: string;
    counterparty: string;
    comment: string;
  }>;
};

export const financeApi = {
  // ── Счета-фактуры ──
  invoices: (kind?: "out" | "in") =>
    request<{ items: Invoice[]; summary: { receivable: InvoiceSide; payable: InvoiceSide } }>(
      `/invoices${kind ? `?kind=${kind}` : ""}`,
    ),
  createInvoice: (body: unknown) =>
    request<{ id: string; number: string }>("/invoices", { method: "POST", body: JSON.stringify(body) }),
  voidInvoice: (id: string) => request<{ ok: boolean }>(`/invoices/${id}/void`, { method: "POST" }),
  /** «Не выставлены» - из книги-сводки; `refresh` - «Обновить». */
  bills: (refresh = false) => request<BillsBoard>(`/bills${refresh ? "?refresh=true" : ""}`),
  bill: (id: string) => request<BillCard>(`/bills/${encodeURIComponent(id)}`),
  /**
   * Записать поля счёта в книгу юрлица. `expect` - какими поля показала
   * карточка (иначе отказ, а не затёртая чужая правка); `defaults` - что
   * дописать, только если в книге пусто.
   */
  saveBill: (
    id: string,
    body: {
      values: Partial<Record<BillField, string>>;
      expect: Partial<Record<BillField, string>>;
      defaults?: Partial<Record<BillField, string>>;
    },
  ) => request<BillSaved>(`/bills/${encodeURIComponent(id)}`, { method: "POST", body: JSON.stringify(body) }),
  /** Шаблон счетов Excel - файлом: счета постов бота, «№ Счета» и дату заполнить. */
  billsTemplate: () => requestFile("/bills/template"),
  /** Заполненный шаблон - в строки: что с каждой делать. В книги не пишет. */
  readBillsTemplate: (file: File) => {
    const body = new FormData();
    body.append("file", file);
    return request<BillsTemplateRead>("/bills/template", { method: "POST", body });
  },

  // ── Повторяющиеся операции ──
  recurrences: () => request<{ items: Recurrence[]; horizon_days: number }>("/recurrences"),
  createRecurrence: (body: unknown) =>
    request<{ id: string; created: number }>("/recurrences", { method: "POST", body: JSON.stringify(body) }),
  materializeRecurrences: () =>
    request<{ created: number }>("/recurrences/materialize", { method: "POST" }),
  toggleRecurrence: (id: string, active: boolean) =>
    request<{ id: string; active: boolean }>(`/recurrences/${id}?active=${active}`, { method: "PATCH" }),
  deleteRecurrence: (id: string) =>
    request<{ removed: number }>(`/recurrences/${id}`, { method: "DELETE" }),

  setCategoryNature: (id: string, nature: string) =>
    request<{ id: string; nature: string }>(`/dictionaries/categories/${id}/nature`, {
      method: "PATCH",
      body: JSON.stringify({ nature }),
    }),

  // ── История ──
  history: () => request<{ items: HistoryEntry[] }>("/history"),
  undo: (id: string) => request<{ ok: boolean }>(`/history/${id}/undo`, { method: "POST" }),

  // ── Интеграции ──
  integrations: () => request<{ items: Integration[]; catalog: BankOption[] }>("/integrations"),
  createIntegration: (body: unknown) =>
    request<Integration & { token?: string; inbox_url?: string }>("/integrations", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  rotateIntegrationToken: (id: string) =>
    request<{ token: string }>(`/integrations/${id}/token`, { method: "POST" }),
  setIntegrationState: (id: string, state: "active" | "off") =>
    request<Integration>(`/integrations/${id}?state=${state}`, { method: "PATCH" }),
  deleteIntegration: (id: string) => request<{ ok: boolean }>(`/integrations/${id}`, { method: "DELETE" }),

  // ── Базы 1С ──
  onec: () =>
    request<{
      bases: OnecBase[];
      entities: Array<{ id: string; name: string; bin: string }>;
      secrets_ready: boolean;
      sync_minutes: number;
    }>("/onec"),
  connectOnec: (body: { url: string; login: string; password: string; title?: string; group_entity_id?: string | null }) =>
    request<OnecBase>("/onec/bases", { method: "POST", body: JSON.stringify(body) }),
  updateOnec: (
    id: string,
    body: Partial<{
      title: string;
      group_entity_id: string | null;
      clear_group_entity: boolean;
      organization_ref: string;
      state: "active" | "off";
      sync_from: string;
      login: string;
      password: string;
    }>,
  ) => request<OnecBase>(`/onec/bases/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteOnec: (id: string) => request<{ ok: boolean }>(`/onec/bases/${id}`, { method: "DELETE" }),
  syncOnec: (id: string) =>
    request<{ ok: boolean; error: string; base: OnecBase }>(`/onec/bases/${id}/sync`, { method: "POST" }),
  onecMonth: (month: string, base?: string | null) => request<OnecMonth>(`/onec/month${qs({ month, base })}`),
  onecChoices: (base: string, q: string) =>
    request<{ items: Array<{ contract_id: string; number: string; customer: string; amount: string | null }> }>(
      `/onec/choices${qs({ base, q })}`,
    ),
  onecDecide: (id: string, body: { action: "link" | "none" | "auto"; contract_id?: string | null }) =>
    request<OnecDoc>(`/onec/documents/${id}/decide`, { method: "POST", body: JSON.stringify(body) }),
  onecContract: (id: string) => request<{ items: Array<OnecDoc & { month: string }> }>(`/onec/contracts/${id}`),

  // ── Баланс, показатели, выписка ──
  balance: (asOf?: string) => request<BalanceData>(`/reports/balance${asOf ? `?as_of=${asOf}` : ""}`),
  indicators: (params: { date_from?: string; date_to?: string } = {}) =>
    request<IndicatorsData>(`/reports/indicators${qs(params)}`),
  accountStatement: (params: { account_id: string; date_from?: string; date_to?: string }) =>
    request<StatementData>(`/reports/statement${qs(params)}`),

  // ── Учётки ───────────────────────────────────────────────────────────────
  me: () => request<Me>("/auth/me"),
  login: (body: { email: string; password: string }) =>
    request<Me | DevicePending>("/auth/login", { method: "POST", body: JSON.stringify(body) }),
  register: (body: { email: string; password: string; company: string; full_name?: string }) =>
    request<Me>("/auth/register", { method: "POST", body: JSON.stringify(body) }),
  logout: () => request<{ ok: boolean }>("/auth/logout", { method: "POST" }),
  // Вход сотрудника по номеру: номер → «пароль», «задайте пароль» или
  // «время задать пароль прошло» (`expired`).
  phoneStart: (phone: string) =>
    request<{ step: "password" | "set_password" | "expired" }>("/auth/phone/start", {
      method: "POST",
      body: JSON.stringify({ phone }),
    }),
  /** «Забыли?» у входа по почте - просьба администраторам; ответ одинаковый всегда. */
  emailForgot: (email: string) =>
    request<{ ok: boolean }>("/auth/forgot", { method: "POST", body: JSON.stringify({ email }) }),
  phoneLogin: (body: { phone: string; password: string }) =>
    request<Me | DevicePending>("/auth/phone/login", { method: "POST", body: JSON.stringify(body) }),
  /**
   * Ждущий экран нового устройства опрашивает, подтвердили ли вход. 200 - `me`
   * (вошли), 202 `{step:"pending"}` - ещё ждём, 403 - отклонили, 404 - устарело.
   */
  claimDevice: () => request<Me | { step: "pending" }>("/auth/device/claim", { method: "POST" }),
  /** Подтвердить или отклонить вход с нового устройства - с того, где уже вошли. */
  approveDevice: (id: string) => request<{ ok: boolean }>(`/auth/device/${id}/approve`, { method: "POST" }),
  denyDevice: (id: string) => request<{ ok: boolean }>(`/auth/device/${id}/deny`, { method: "POST" }),
  /** Задать пароль и сразу войти - ответ как у `me`. */
  phoneSetPassword: (body: { phone: string; password: string }) =>
    request<Me>("/auth/phone/set-password", { method: "POST", body: JSON.stringify(body) }),
  phoneForgot: (phone: string) =>
    request<{ ok: boolean }>("/auth/phone/forgot", { method: "POST", body: JSON.stringify({ phone }) }),
  switchCompany: (companyId: string) =>
    request<Me>("/auth/switch", { method: "POST", body: JSON.stringify({ company_id: companyId }) }),
  addCompany: (title: string) =>
    request<Company>("/auth/companies", { method: "POST", body: JSON.stringify({ title }) }),
  renameCompany: (title: string) =>
    request<{ id: string; title: string }>("/auth/company", {
      method: "PATCH",
      body: JSON.stringify({ title }),
    }),
  members: () => request<{ items: MemberRow[] }>("/auth/members"),
  invite: (body: { email: string; password: string; role: string; full_name?: string }) =>
    request<{ id: string; email: string; role: string }>("/auth/members", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  changeRole: (userId: string, role: string) =>
    request<{ ok: boolean }>(`/auth/members/${userId}`, {
      method: "PATCH",
      body: JSON.stringify({ role }),
    }),
  removeMember: (userId: string) =>
    request<{ ok: boolean }>(`/auth/members/${userId}`, { method: "DELETE" }),
  changePassword: (body: { old_password: string; new_password: string }) =>
    request<{ ok: boolean }>("/auth/password", { method: "POST", body: JSON.stringify(body) }),
  /** Передать владение компанией - только владелец, с паролем; сам остаётся `keep`. */
  transferOwner: (body: { user_id: string; password: string; keep: "admin" | "employee" }) =>
    request<{ ok: boolean }>("/auth/owner", { method: "POST", body: JSON.stringify(body) }),
  /** Своя почта для входа - с текущим паролем. Сеансы остаются. */
  changeEmail: (body: { email: string; password: string }) =>
    request<{ id: string; email: string }>("/auth/email", { method: "POST", body: JSON.stringify(body) }),
  sessions: () => request<{ items: SessionRow[] }>("/auth/sessions"),
  revokeSession: (id: string) =>
    request<{ ok: boolean }>(`/auth/sessions/${id}`, { method: "DELETE" }),

  overview: () => request<Overview>("/overview"),
  dictionaries: () => request<Dictionaries>("/dictionaries"),

  operations: (params: Record<string, string | number | undefined>) =>
    request<OperationPage>(`/operations${qs(params)}`),
  createOperation: (body: unknown) =>
    request<Operation>("/operations", { method: "POST", body: JSON.stringify(body) }),
  patchOperation: (id: string, body: unknown) =>
    request<Operation>(`/operations/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  /** Удалить операцию; `undo` - запись истории, по ней «Вернуть» (`undo`). */
  deleteOperation: (id: string) => request<{ ok: boolean; undo?: string }>(`/operations/${id}`, { method: "DELETE" }),

  grid: (params: Record<string, string | number | undefined>) =>
    request<GridPayload>(`/grid${qs(params)}`),
  /** Живой режим листа «Таблица»: строки, изменённые после номера, и снятые. */
  gridChanges: (since: number) =>
    request<{ rows: GridRow[]; removed: string[]; seq: number }>(`/grid/changes${qs({ since })}`),
  autotagPreview: () => request<AutotagPreview>("/autotag"),
  autotagApply: (groups: { side: string; category: string }[]) =>
    request<{ updated: number; by_category: Record<string, number> }>("/autotag", {
      method: "POST",
      body: JSON.stringify({ groups }),
    }),
  setStartingBalance: (accountId: string, value: string) =>
    request<{ id: string; name: string; starting_balance: Money }>(`/accounts/${accountId}`, {
      method: "PATCH",
      body: JSON.stringify({ starting_balance: value }),
    }),
  /**
   * Адрес выгрузки журнала в Excel с теми же фильтрами, что на экране.
   *
   * Ссылка, а не запрос из кода: файл скачивает браузер, со своим окном
   * сохранения и своим именем файла из заголовка ответа.
   */
  exportJournalUrl: (params: Record<string, string | number | undefined>) =>
    `${API}/export/journal.xlsx${qs(params)}`,
  patchCell: (body: { operation_id: string; column: string; value: unknown; version?: number }) =>
    request<Operation & { row: GridRow }>("/grid/cell", { method: "PATCH", body: JSON.stringify(body) }),
  addGridRow: (cells: Record<string, unknown>) =>
    request<Operation & { row: GridRow }>("/grid/row", { method: "POST", body: JSON.stringify({ cells }) }),

  cashFlow: (params: Record<string, string | undefined>) =>
    request<CashFlow>(`/reports/cash-flow${qs(params)}`),
  profit: (params: Record<string, string | undefined>) =>
    request<Profit>(`/reports/profit${qs(params)}`),
  debts: (params: Record<string, string | undefined> = {}) =>
    request<Debts>(`/reports/debts${qs(params)}`),
  projects: (params: Record<string, string | undefined> = {}) =>
    request<ProjectsReport>(`/reports/projects${qs(params)}`),
  calendar: (year: number, month: number) =>
    request<CalendarMonth>(`/reports/calendar${qs({ year, month })}`),
  planActual: (params: Record<string, string | undefined> = {}) =>
    request<PlanActual>(`/reports/plan-actual${qs(params)}`),
  upsertPlan: (body: {
    month: string;
    side: string;
    method: string;
    amount: string;
    category_id?: string | null;
    project_id?: string | null;
  }) => request<{ id: string; month: string; amount: Money }>("/plans", {
    method: "POST",
    body: JSON.stringify(body),
  }),

  createEntry: (kind: "categories" | "counterparties" | "projects" | "tags", body: unknown) =>
    request<DictEntry>(`/dictionaries/${kind}`, { method: "POST", body: JSON.stringify(body) }),
  createAccount: (body: unknown) =>
    request<DictEntry>("/accounts", { method: "POST", body: JSON.stringify(body) }),
  setAccountNumber: (accountId: string, number: string) =>
    request<{ id: string; name: string; number: string }>(`/accounts/${accountId}/number`, {
      method: "PUT",
      body: JSON.stringify({ number }),
    }),
  archiveEntry: (kind: string, id: string) =>
    request<{ ok: boolean }>(`/dictionaries/${kind}/${id}`, { method: "DELETE" }),

  rules: () => request<{ items: Rule[] }>("/rules"),
  createRule: (body: {
    name: string;
    conditions: RuleCondition[];
    actions: Record<string, string>;
    match?: string;
  }) => request<{ id: string; name: string }>("/rules", { method: "POST", body: JSON.stringify(body) }),
  toggleRule: (id: string, active: boolean) =>
    request<{ id: string; active: boolean }>(`/rules/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ active }),
    }),
  deleteRule: (id: string) => request<{ ok: boolean }>(`/rules/${id}`, { method: "DELETE" }),
  applyRules: (body: { only_uncategorized?: boolean } = {}) =>
    request<{ rules: number; updated: number; by_rule: Record<string, number> }>("/rules/apply", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  ruleSuggestions: () => request<{ items: RuleSuggestion[] }>("/rules/suggest"),

  importPreview: (file: File, params: { date_order?: string; default_account?: string } = {}) => {
    const form = new FormData();
    form.append("file", file);
    return request<ImportPreview>(`/import/preview${qs(params)}`, { method: "POST", body: form });
  },
  sheetBooks: () => request<{ configured: boolean; items: SheetBook[] }>("/sheets/books"),
  sheetBook: (id: string) =>
    request<{ id: string; title: string; url: string; tabs: SheetTab[] }>(`/sheets/books/${id}`),
  /** Вкладка книги разбирается тем же разбором, что и загруженный файл. */
  sheetPreview: (body: { book_id: string; tab: string; date_order?: string; default_account?: string }) =>
    request<ImportPreview>("/sheets/preview", { method: "POST", body: JSON.stringify(body) }),
  importBatches: () => request<{ items: ImportBatch[] }>("/import/batches"),
  importBatch: (id: string) =>
    request<{
      id: string;
      file_name: string;
      status: string;
      counts: Record<string, number>;
      rows: ImportRow[];
      decisions: Record<string, unknown>;
      mapping: ImportPreview["mapping"];
    }>(
      `/import/batches/${id}`,
    ),
  applyBatch: (id: string, body: { lines?: number[]; create_dictionaries?: boolean } = {}) =>
    request<{
      imported: number;
      failed: number;
      skipped: number;
      duplicate: number;
      total: number;
      /** Номер счёта из выписки, записанный счёту при заводке. */
      remembered?: { account: string; number: string } | null;
    }>(
      `/import/batches/${id}/apply`,
      { method: "POST", body: JSON.stringify(body) },
    ),
  fixImportRow: (id: string, line: number, patch: Record<string, unknown>) =>
    request<{ line: number; state: string; problems: ImportProblem[]; values: Record<string, unknown> }>(
      `/import/batches/${id}/rows/${line}`,
      { method: "PATCH", body: JSON.stringify({ patch }) },
    ),
};

/**
 * Деньги на экране: разряды пробелами, две цифры после запятой только когда
 * они есть.
 *
 * Копейки прячутся не для красоты. В управленческом отчёте суммы семизначные,
 * и «1 680 000,00» против «1 680 000» - это шум в каждой строке таблицы,
 * который мешает сравнивать порядки величин глазом. Там, где копейки есть, они
 * показываются: это не округление, а отсутствие ложной точности.
 */
export function formatMoney(
  value: Money | number,
  options: { sign?: boolean; whole?: boolean } = {},
): string {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return String(value);
  /**
   * Копейки показываем всегда.
   *
   * Раньше целая сумма печаталась без них, и в одной колонке отчёта стояли
   * «2 084 872» и «915 207,42». Колонку денег читают по разрядам сверху вниз;
   * когда у части чисел запятой нет, разряды перестают стоять друг под
   * другом, и взгляд спотыкается там, где должен скользить. Это не украшение:
   * ровно так глазами ловят лишний ноль.
   *
   * `whole` оставлен для мест, где копейки заведомо не нужны и место дорого.
   */
  const fraction = options.whole ? 0 : 2;
  const text = new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: fraction,
    maximumFractionDigits: fraction,
  }).format(Math.abs(number));
  const prefix = options.sign ? (number < 0 ? "−" : "+") : number < 0 ? "−" : "";
  return `${prefix}${text}`;
}

/**
 * Сумма для узкой полосы: «3,05 млн» вместо «3 050 000».
 *
 * Полоса шириной в палец, и полное число в ней либо обрезается, либо
 * набирается таким кеглем, что не читается. Точность здесь не нужна: это
 * взгляд «сколько всего», а точная цифра - в раскрытой панели.
 */
export function compactMoney(value: Money | number | null | undefined): string {
  if (value === null || value === undefined) return "-";
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return "-";
  const sign = number < 0 ? "−" : "";
  const abs = Math.abs(number);
  const round = (n: number) => n.toFixed(n < 10 ? 2 : n < 100 ? 1 : 0).replace(".", ",").replace(/,0+$/, "");
  if (abs >= 1_000_000_000) return `${sign}${round(abs / 1_000_000_000)} млрд`;
  if (abs >= 1_000_000) return `${sign}${round(abs / 1_000_000)} млн`;
  if (abs >= 10_000) return `${sign}${round(abs / 1_000)} тыс`;
  return `${sign}${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(abs)}`;
}

/** «2026-09» → «сентябрь 2026»; для шапок таблиц - «сен 26». */
export function formatMonth(month: string, short = false): string {
  const [year, index] = month.split("-").map(Number);
  const full = [
    "январь", "февраль", "март", "апрель", "май", "июнь",
    "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь",
  ];
  const brief = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
  if (!index || index < 1 || index > 12) return month;
  return short ? `${brief[index - 1]} ${String(year).slice(2)}` : `${full[index - 1]} ${year}`;
}

/** «2026-09-17» → «17 сен 2026». */
export function formatDate(iso: string): string {
  if (!iso) return "";
  const [year, month, day] = iso.split("-").map(Number);
  const brief = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
  if (!month || month < 1 || month > 12) return iso;
  return `${day} ${brief[month - 1]} ${year}`;
}

/** Первое и последнее число месяца, сдвинутого на `shift` от текущего. */
export function monthEdges(shift = 0): { from: string; to: string } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() + shift, 1);
  const end = new Date(now.getFullYear(), now.getMonth() + shift + 1, 0);
  const iso = (value: Date) =>
    `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  return { from: iso(start), to: iso(end) };
}

export function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

// ── Реестр договоров ─────────────────────────────────────────────────────────
//
// Контракт - раздел «Контракт API для экранов» плана. Экраны не зовут fetch и
// не держат копий договоров: всё через `contractsApi` и хранилище
// `finance/contracts/store.ts`.

export type FieldType =
  | "text" | "number" | "money" | "date" | "bool" | "list" | "multi_list"
  | "url" | "person" | "party" | "department" | "choice";

export type RegistryField = {
  key: string;
  type: FieldType;
  title: string;
  system: boolean;
  /** Сервер уже урезал поля по правам: скрытых здесь нет, у видимых - можно ли править. */
  editable: boolean;
  required: boolean;
  hidden: boolean;
  position: number;
  choices?: { value: string; label: string }[];
  /**
   * Как поле заполняют руками - только у полей со списком: `list` - только из
   * списка, `hint` - из списка или своё, `own` - сторона только из наших
   * юрлиц. Нет ключа - поле пишется как есть.
   */
  fill?: FieldFill;
  /** Какие способы можно выбрать у этого поля в настройке. */
  fills?: FieldFill[];
};

export type FieldFill = "list" | "hint" | "own";

/** Оплаты договора по журналу: суммы строками, как все деньги API. */
export type PaymentSummary = {
  paid: string | null;
  /** Только у договора на всю сумму: сумма минус оплачено. */
  remaining: string | null;
  count: number;
  last_at: string | null;
  /** Спорные платежи: подходят и к этому договору, и к другому. */
  open: number;
};

export type PaymentItem = {
  operation_id: string;
  paid_at: string;
  amount: string;
  kind: "income" | "expense";
  counterparty: string;
  account: string;
  comment: string;
  /** Номер договора, как его написал источник («№ЮО/84» в журнале). */
  contract_ref?: string;
  /** `auto` - по стороне, `number` - по номеру договора из источника, `purpose` - по номеру из
   * назначения платежа, `manual` - человек, `open` - спорный. */
  how: "auto" | "number" | "purpose" | "manual" | "open";
};

export type ContractPayments = { summary: PaymentSummary | null; items: PaymentItem[] };

export type ListValue = {
  id: string;
  value: string;
  meaning: {
    phase?: string;
    handover?: string;
    billing?: string;
    economic_role?: string;
    system?: string;
    roles?: { executor?: string; customer?: string };
    kind?: string;
    /** «Это разные»: значения, которые не двойники этого. */
    distinct?: string[];
  };
  position: number;
  /** Более раннее похожее значение того же списка - возможный двойник. */
  similar?: string;
};

export type FilterCondition = { field: string; op: string; value: unknown };
export type ViewFilter = { any: { all: FilterCondition[] }[] };

/** Тон подсветки строки: `done` - «сделано» (строка «исполнен» в «Разовых»). */
export type RowTone = "done";

export type ViewBlock = {
  title: string;
  filter: ViewFilter;
  roles: { executor?: string; customer?: string; order?: ("executor" | "customer")[] };
  columns: { key: string; label: string; width?: number | null }[];
  defaults: Record<string, string>;
  /** Что предлагает выбор списка в этом блоке: поле → значения. Нет ключа - весь список. */
  choices?: Record<string, string[]>;
  /** Подсветка строки по правилу - условное форматирование листа. */
  paint?: { filter: ViewFilter; tone: RowTone }[];
};

export type RegistryView = {
  id: string;
  key: string;
  title: string;
  main: boolean;
  /** Книга листа - ключ вида договоров (`core/views.py`): `""` - реестр. */
  book?: string;
  position: number;
  blocks: ViewBlock[];
  sort: unknown[];
};

export type OwnEntity = {
  id: string;
  code: string;
  name: string;
  full_name: string;
  bin: string;
  vat_payer: boolean;
  accounts: { id: string; name: string; number: string }[];
};

/** Владелец вида: компания, отдел (код - в подписи «Разовые ЮО») или сам человек. */
export type ViewOwner =
  | { kind: "company" }
  | { kind: "department"; id: string; code: string; title: string }
  | { kind: "user"; id: string };

/** Вид договоров в схеме реестра - книга листов (`core/views.book_out`). */
export type RegistryBook = {
  key: string;
  title: string;
  owner: ViewOwner;
  filter: ViewFilter;
  measures: string[];
  groups: string[];
  forms: string[];
  /** Отдел, долей которого вид показывает сумму договора («Разовые ЮО» - доля ЮО). */
  share_department: string | null;
};

/** Мера вида колонкой листа: «Оплачено», «Остаток», «Срок, мес». */
export type MeasureDef = { key: string; title: string; type: string };

export type RegistrySchema = {
  schema_rev: number;
  fields: RegistryField[];
  /** Виды договоров - книги листов. У старого сервера - строки ключей. */
  books?: RegistryBook[] | string[];
  /** Меры видов - колонки и условия листов, но не поля договора. */
  measures?: MeasureDef[];
  /** Действующие значения - их предлагают выборы. */
  lists: Record<string, ListValue[]>;
  /** Значения в архиве - только чтобы подписать договоры, где они стоят. */
  archived_values?: Record<string, ListValue[]>;
  departments: { id: string; code: string; title: string; position: number }[];
  views: RegistryView[];
  /** Откуда «Оплачено (сводка)»; `null` - сводка не подключена. */
  summary?: SummarySource | null;
  own_entities: OwnEntity[];
  mode_fields: string[];
  virtual_fields: Record<string, string>;
  billing_kinds: string[];
  economic_roles: string[];
  status_phases: string[];
  today: string;
  /** `payments` - открыты ли оплаты по выписке (нужен журнал); нет поля - старый сервер, спросить.
   *  `admin` - владелец или администратор: только он убирает отдел из договора. */
  access: { edit: boolean; setup: boolean; admin?: boolean; payments?: boolean };
};

/** Книга-сводка компании: откуда «Оплачено (сводка)» (`contracts/summary.py`). */
export type SummarySource = {
  spreadsheet_id: string;
  worksheet: string;
  title: string;
  url: string;
  read_at: string | null;
  rows: number;
  rev: string;
  drift: string;
  error: string;
};

/**
 * Что сводка знает о договоре. `found` - строки нашлись; `missing` - номера
 * в сводке нет; `other_client` - номер есть, клиент другой; `ambiguous` -
 * подходят разные клиенты, и выбрать нельзя.
 */
export type SummaryEntry = {
  state: "found" | "missing" | "other_client" | "ambiguous";
  paid?: string;
  remaining?: string | null;
  months?: string[];
  rows?: number;
  customer?: string;
  candidates?: string[];
  /** `kort` - оплаты юрлица ведёт KORT («Сверка → Переход»): оплачено - из разнесённых оплат. */
  source?: "kort";
};

export type ContractIssue = {
  code: string;
  field: string;
  text: string;
  ref: string;
  acknowledged: boolean;
  /** Договоры, о которых замечание («номер уже есть у …»). */
  others?: string[];
};

export type Contract = {
  id: string;
  seq: number;
  /** Значения по ключу поля. Пустые сервер не отдаёт: нет ключа - пусто. */
  values: Record<string, unknown>;
  provenance: Record<string, string>;
  issues: ContractIssue[];
  /** Листы и блоки договора; `tone` - подсветка строки в блоке (считает сервер). */
  views: { view: string; block: number; tone?: RowTone }[];
  roles?: { executor?: string; customer?: string };
  /** Договор «другого отдела»: виден, но не правится. */
  readonly?: boolean;
  /** Кто вписал отдел договора: отдел → учётка. Сотрудник убирает только
   *  вписанный им самим (и пока без доли); нет ключа - вписал не он. */
  departments_by?: Record<string, string>;
  /** Доля отдела книги («Разовые ЮО» - доля ЮО): отдел → сумма и процент.
   *  Только отделы, которыми отобрана книга, и только заданные (`shares.py`). */
  department_share?: Record<string, { amount: string | null; percent: string | null }>;
  file_snapshot: { paid?: string; remaining?: string; as_of?: string; file?: string };
  position: number;
  source: string;
  created_by: string | null;
  created_at: string | null;
  updated_by: { id: string; short_name: string } | null;
  updated_at: string | null;
  deleted: boolean;
};

export type Party = { id: string; name: string; own: boolean; code: string; bin: string };
export type PersonRef = { id: string; name: string; department_id: string | null };

export type ContractsAll = {
  contracts: Contract[];
  parties: Record<string, Party>;
  people: Record<string, PersonRef>;
  seq: number;
  schema_rev: number;
  /** По какой сводке посчитаны листы вроде «Остатки» (`""` - без сводки). */
  summary_rev?: string;
};

export type ChangesBatch = ContractsAll & { removed: string[] };

export type ChangeMode =
  | { kind: "fix" }
  | { kind: "from_date"; effective_from: string; number?: string; signed_at?: string; summary?: string };

export type OneContract = {
  contract: Contract;
  parties: Record<string, Party>;
  people: Record<string, PersonRef>;
};

export type Amendment = {
  id: string;
  number: string;
  signed_at: string | null;
  summary: string;
  effect: string;
  effective_from: string | null;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  before_label: string;
  after_label: string;
  origin: "change" | "parsed";
  piece: string;
  ahead: boolean;
  applied_at: string | null;
};

export type ParsedPiece = {
  index: number;
  text: string;
  start: number;
  end: number;
  number: string;
  signed_at: string | null;
  summary: string;
  summary_start: number | null;
  summary_end: number | null;
  effect: string;
  effective_from: string | null;
  value_hint: string;
  confirmed: string[] | null;
};

export type HistoryItem = {
  id: string;
  at: string | null;
  actor: string;
  kind: string;
  title: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
};

export type ContractImportSection = {
  key: string;
  title: string;
  blocking: boolean;
  done: boolean;
  summary: string;
  items: any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  [extra: string]: unknown;
};

export type ContractImportBatch = {
  id: string;
  status: "preview" | "applied" | "cancelled";
  file_name: string;
  decisions: Record<string, unknown>;
  report: {
    file: string;
    main_sheet: string;
    sheets: string[];
    sections: ContractImportSection[];
    blocking: string[];
    totals: { create: number; update: number; main_rows: number };
    result?: { created: number; updated?: number; failed: { ref: string; error: string }[] };
  };
};

const C = "/contracts";

/** Доля - суммой (тенге) или процентом от суммы договора. */
export type ShareUnit = "amount" | "percent";

export type ShareSummary = {
  given: number;
  allocated_amount: string | null;
  allocated_percent: string | null;
  rest_amount: string | null;
  rest_percent: string | null;
  over: boolean;
};

export type PersonShare = {
  employee_id: string;
  name: string;
  department: string;
  amount: string | null;
  percent: string | null;
  entered: ShareUnit | null;
  mine: boolean;
};

export type DepartmentShare = {
  department_id: string;
  code: string;
  title: string;
  amount: string | null;
  percent: string | null;
  entered: ShareUnit | null;
};

export type ContractShares = {
  contract_id: string;
  amount: string | null;
  billing: string;
  seq: number;
  people: {
    /** `all` - доли всех; `own` - только своя; `none` - ни одной. */
    scope: "all" | "own" | "none";
    can_edit: boolean;
    count: number;
    unit: ShareUnit | null;
    rows: PersonShare[];
    summary?: ShareSummary;
  };
  /** `null` - доли отделов этому человеку не открыты. Строки - это и поле
   *  «Отдел» договора: главного отдела нет (30.09.2026). */
  departments: {
    can_edit: boolean;
    /** Убрать отдел из договора - только владелец или администратор. */
    can_remove: boolean;
    unit: ShareUnit | null;
    rows: DepartmentShare[];
    summary: ShareSummary;
    choices: { id: string; code: string; title: string }[];
  } | null;
};

/** Доли людей одного договора: сотрудник → сумма и процент. */
export type ShareMap = {
  scope: "all" | "own";
  people: Record<string, { amount: string | null; percent: string | null }>;
};

export type SheetChange = {
  action:
    | "delete_contracts"
    | "add_column"
    | "remove_column"
    | "rename_column"
    | "rename_block"
    | "move_column"
    | "rename_view"
    | "archive_view"
    | "order_views"
    | "move_rows"
    | "values_point"
    | "created_point";
  view?: string;
  book?: string;
  ids?: string[];
  title?: string;
  type?: string;
  block?: number;
  key?: string;
  label?: string;
  keys?: (string | null)[];
  after?: (string | null)[];
  before?: string | null;
  items?: { id: string; keys: string[] }[];
};

export type PointRef = { id: string; title: string; kind: string };

export type SheetChangeResult = {
  point?: PointRef | null;
  done?: string[];
  failed?: { id: string; error: string }[];
  key?: string;
  removed?: string[];
};

export type RestorePointItem = {
  id: string;
  kind: string;
  title: string;
  /** Что вернётся словами: «договоры вернутся из корзины». */
  returns: string;
  book: string;
  view: string;
  created_at: string | null;
  by: string;
  mine: boolean;
  restored_at: string | null;
  restored_by: string;
  can_restore: boolean;
};

export type RestoreResult = { title: string; done: string[]; skipped: string[]; kind: string };

export const contractsApi = {
  schema: () => request<RegistrySchema>(`${C}/schema`),
  all: () => request<ContractsAll>(C),
  changes: (since: number) => request<ChangesBatch>(`${C}/changes${qs({ since })}`),
  one: (id: string) => request<OneContract>(`${C}/${id}`),
  create: (
    values: Record<string, unknown>,
    ctx?: { view?: string; block?: number; source?: string; before?: string | null; id?: string },
  ) =>
    request<OneContract>(C, {
      method: "POST",
      body: JSON.stringify({
        values,
        view: ctx?.view,
        block: ctx?.block,
        source: ctx?.source ?? "app",
        before: ctx?.before ?? null,
        id: ctx?.id ?? null,
      }),
    }),
  patch: (id: string, values: Record<string, unknown>, knownSeq: number | null, mode?: ChangeMode | null) =>
    request<OneContract>(`${C}/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ values, known_seq: knownSeq, mode: mode ?? null }),
    }),
  remove: (id: string) => request<{ ok: boolean }>(`${C}/${id}`, { method: "DELETE" }),
  acknowledge: (id: string, code: string, on: boolean) =>
    request<OneContract>(`${C}/${id}/acknowledge`, { method: "POST", body: JSON.stringify({ code, on }) }),
  history: (id: string, before?: string) =>
    request<{ items: HistoryItem[] }>(`${C}/${id}/history${qs({ before })}`),
  amendments: {
    list: (id: string) => request<{ items: Amendment[] }>(`${C}/${id}/amendments`),
    parse: (id: string) => request<{ pieces: ParsedPiece[] }>(`${C}/${id}/amendments/parse`, { method: "POST" }),
    confirm: (id: string, piece: Record<string, unknown>) =>
      request<OneContract>(`${C}/${id}/amendments/confirm`, { method: "POST", body: JSON.stringify({ piece }) }),
    remove: (id: string, amendmentId: string) =>
      request<{ ok: boolean }>(`${C}/${id}/amendments/${amendmentId}`, { method: "DELETE" }),
  },
  parties: {
    search: (q: string, limit = 20) =>
      request<{ parties: Party[] }>(`${C}/parties${qs({ q, limit })}`),
    similar: (name: string, bin = "") =>
      request<{ parties: Party[] }>(`${C}/parties/similar${qs({ name, bin })}`),
  },
  people: () => request<{ people: PersonRef[] }>(`${C}/people`),
  payments: {
    /** «Оплачено/Остаток по выписке» видимых договоров; 403 - журнал не открыт. */
    all: () => request<{ contracts: Record<string, PaymentSummary> }>(`${C}/payments`),
    of: (id: string) => request<ContractPayments>(`${C}/${id}/payments`),
    decide: (id: string, operationId: string, action: "link" | "unlink" | "auto") =>
      request<ContractPayments>(`${C}/${id}/payments`, {
        method: "POST",
        body: JSON.stringify({ operation_id: operationId, action }),
      }),
  },
  /** «Оплачено/Остаток (сводка)» видимых договоров; `force` - перечитать книгу. */
  summary: (force = false) =>
    request<{ source: SummarySource | null; contracts: Record<string, SummaryEntry> }>(
      `${C}/summary${qs({ force: force ? "true" : undefined })}`,
    ),
  exportUrl: (views?: string[]) => `${API}${C}/export.xlsx${qs({ views: views?.join(",") })}`,
  shares: {
    /** Доли договора - только открытые этому человеку (`shares.py`). */
    of: (id: string) => request<ContractShares>(`${C}/${id}/shares`),
    /** Доли всех видимых договоров - для «По сотрудникам». */
    all: () => request<{ contracts: Record<string, ShareMap> }>(`${C}/shares`),
    setPeople: (id: string, unit: ShareUnit, items: { employee_id: string; value: string | null }[]) =>
      request<ContractShares>(`${C}/${id}/shares/people`, { method: "PUT", body: JSON.stringify({ unit, items }) }),
    setDepartments: (id: string, unit: ShareUnit, items: { department_id: string; value: string | null }[]) =>
      request<ContractShares>(`${C}/${id}/shares/departments`, { method: "PUT", body: JSON.stringify({ unit, items }) }),
  },
  /** Изменение таблицы, о котором лист предупредил (`contracts/restore.py`). */
  sheetChange: (body: SheetChange) =>
    request<SheetChangeResult>(`${C}/sheet/change`, { method: "POST", body: JSON.stringify(body) }),
  restorePoints: {
    list: () => request<{ items: RestorePointItem[] }>(`${C}/restore-points`),
    restore: (id: string) =>
      request<RestoreResult>(`${C}/restore-points/${id}/restore`, { method: "POST" }),
  },
  imports: {
    upload: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return request<ContractImportBatch>(`${C}/imports`, { method: "POST", body: form });
    },
    get: (id: string) => request<ContractImportBatch>(`${C}/imports/${id}`),
    decide: (id: string, decisions: Record<string, unknown>) =>
      request<ContractImportBatch>(`${C}/imports/${id}/decide`, { method: "POST", body: JSON.stringify({ decisions }) }),
    apply: (id: string) =>
      request<{ result: { created: number; updated?: number; failed: { ref: string; error: string }[] } }>(
        `${C}/imports/${id}/apply`,
        { method: "POST" },
      ),
    cancel: (id: string) => request<{ ok: boolean }>(`${C}/imports/${id}/cancel`, { method: "POST" }),
  },
  setup: {
    addField: (title: string, type: string, after?: string | null) =>
      request<{ key: string }>(`${C}/setup/fields`, { method: "POST", body: JSON.stringify({ title, type, after }) }),
    updateField: (key: string, data: Record<string, unknown>) =>
      request<{ key: string }>(`${C}/setup/fields/${encodeURIComponent(key)}`, { method: "PATCH", body: JSON.stringify(data) }),
    addValue: (field: string, value: string, meaning?: ListValue["meaning"]) =>
      request<{ id: string }>(`${C}/setup/lists/${encodeURIComponent(field)}`, {
        method: "POST",
        body: JSON.stringify({ value, meaning }),
      }),
    updateValue: (id: string, data: Record<string, unknown>) =>
      request<{ id: string }>(`${C}/setup/values/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    mergeValues: (keep: string, drop: string) =>
      request<{ ok: boolean }>(`${C}/setup/values/merge`, { method: "POST", body: JSON.stringify({ keep, drop }) }),
    addEntity: (data: Record<string, unknown>) =>
      request<{ id: string }>(`${C}/setup/entities`, { method: "POST", body: JSON.stringify(data) }),
    updateEntity: (id: string, data: Record<string, unknown>) =>
      request<{ id: string }>(`${C}/setup/entities/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    mergeParties: (keep: string, drop: string) =>
      request<{ ok: boolean }>(`${C}/setup/parties/merge`, { method: "POST", body: JSON.stringify({ keep, drop }) }),
    addDepartment: (data: Record<string, unknown>) =>
      request<{ id: string }>(`${C}/setup/departments`, { method: "POST", body: JSON.stringify(data) }),
    updateDepartment: (id: string, data: Record<string, unknown>) =>
      request<{ id: string }>(`${C}/setup/departments/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    addView: (data: Record<string, unknown>) =>
      request<RegistryView>(`${C}/setup/views`, { method: "POST", body: JSON.stringify(data) }),
    updateView: (id: string, data: Record<string, unknown>) =>
      request<RegistryView>(`${C}/setup/views/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    /** `problem` - таблица подключена, но нужные колонки названы по-своему: их называют в «Колонках для ядра». */
    connectSummary: (link: string, worksheet: string) =>
      request<{ title: string; worksheet: string; rows: number; drift: string; problem?: string }>(`${C}/setup/summary`, {
        method: "POST",
        body: JSON.stringify({ link, worksheet }),
      }),
    disconnectSummary: () => request<{ ok: boolean }>(`${C}/setup/summary`, { method: "DELETE" }),
    preview: (filter: ViewFilter) =>
      request<{ count: number; sample: string[] }>(`${C}/setup/views/preview`, {
        method: "POST",
        body: JSON.stringify({ filter }),
      }),
  },
};

// ── Люди, права, журнал действий (личный кабинет) ────────────────────────────

export type Department = {
  id: string;
  code: string;
  title: string;
  position: number;
  archived: boolean;
  employees: number;
};

/** `no_access` - человек в справочнике без входа (например, ответственный). */
export type AccountStatus = "no_access" | "blocked" | "pending" | "pending_expired" | "active";

export type EmployeeRequest = {
  id: string;
  kind: "password_reset_requested" | "login_locked";
  created_at: string | null;
};

export type EmployeeRow = {
  id: string;
  full_name: string;
  short_name: string;
  job_title: string;
  department_id: string | null;
  position: number;
  archived: boolean;
  phone: string;
  status: AccountStatus;
  account: {
    user_id: string;
    email: string;
    phone: string;
    role: MemberRole;
    status: AccountStatus;
    pending_until: string | null;
    last_seen_at: string | null;
    last_login_at: string | null;
    blocked_at: string | null;
  } | null;
  requests: EmployeeRequest[];
};

export type NotificationItem = {
  id: string;
  kind: "password_reset_requested" | "login_locked" | "password_set" | string;
  actionable: boolean;
  created_at: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  payload: { ip?: string; user_agent?: string; repeats?: number; [key: string]: unknown };
  subject: { user_id: string; employee_id: string | null; name: string; phone: string } | null;
};

export type AccessResource = {
  key: string;
  title: string;
  group: string;
  levels: AccessLevel[];
  note?: string;
};

export type AccessCatalog = {
  resources: AccessResource[];
  fields: { key: string; field: string; title: string; levels: AccessLevel[] }[];
  row_scopes: ("all" | "department" | "own")[];
  /** «Сотрудники и права»: всех или своего отдела (начальник отдела). */
  people_scopes?: ("all" | "department")[];
};

export type ContractScope = {
  rows?: "all" | "department" | "own";
  entities?: string[];
  /** Отделы «только просмотр» вдобавок к своим договорам. */
  departments?: string[];
  /** Личная запись «шире отдела» - пометка администратора, потолок отдела её не режет. */
  beyond?: boolean;
  /** У начальника («Сотрудники и права» своего отдела): `false` - доли отделов ему не показывать. */
  shares?: boolean;
};
export type Grant = { level: AccessLevel; scope?: ContractScope };

/** Права субъекта. У человека ещё права отдела и итог - для колонок «Отдел» и «Итог». */
export type SubjectAccess = {
  subject: {
    kind: "department" | "employee";
    id: string;
    title: string;
    code?: string;
    role?: MemberRole | null;
    /** Владелец и администратор: матрицы нет, «видит и правит всё». */
    admin?: boolean;
    department?: { id: string; code: string; title: string } | null;
  };
  grants: Record<string, Grant>;
  department_grants?: Record<string, Grant>;
  effective: Record<string, AccessLevel>;
  contracts_scope?: { rows: "all" | "department" | "own"; entities: string[] };
  /** У отдела: люди со входом и кто из них начальник («Сотрудники и права» своего отдела). */
  members?: { id: string; name: string; admin: boolean }[];
  heads?: string[];
  /** Начальники, которым администратор снял «видит доли отделов» (по умолчанию видят). */
  heads_without_shares?: string[];
};

export type GrantChange = AccessLevel | { level: AccessLevel; scope?: ContractScope } | null;

export type AuditActor = { user_id: string; employee_id: string | null; name: string; short_name: string };

export type AuditItem = {
  id: string;
  at: string | null;
  category: "data" | "auth" | "admin" | "view" | "export" | "import" | string;
  kind: string;
  title: string;
  entity: string;
  entity_id: string | null;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  actor: AuditActor | null;
  actor_text: string;
  ip: string;
  user_agent: string;
  session_id: string | null;
  undone_at: string | null;
  can_undo: boolean;
};

export type AuditQuery = {
  q?: string;
  user_id?: string;
  employee_id?: string;
  department_id?: string;
  /** Через запятую: data,auth,admin,view,export,import. */
  category?: string;
  /** `contract.*` - все события договоров. */
  kind?: string;
  entity_id?: string;
  since?: string;
  until?: string;
  cursor?: string;
  limit?: number;
};

const P = "/people";

export const peopleApi = {
  list: () => request<{ departments: Department[]; employees: EmployeeRow[] }>(P),
  departments: {
    create: (data: { code: string; title?: string }) =>
      request<Department>(`${P}/departments`, { method: "POST", body: JSON.stringify(data) }),
    update: (id: string, data: { code?: string; title?: string; archived?: boolean }) =>
      request<Department>(`${P}/departments/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  },
  employees: {
    create: (data: {
      full_name: string;
      phone?: string;
      department_id?: string | null;
      job_title?: string;
      access?: boolean;
      role?: MemberRole;
    }) => request<EmployeeRow>(`${P}/employees`, { method: "POST", body: JSON.stringify(data) }),
    update: (id: string, data: Record<string, unknown>) =>
      request<EmployeeRow>(`${P}/employees/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    archive: (id: string) => request<EmployeeRow>(`${P}/employees/${id}`, { method: "DELETE" }),
    /** Открыть вход человеку из справочника: учётка по номеру ждёт пароль 72 часа. */
    openAccount: (id: string, data: { phone?: string; role?: MemberRole }) =>
      request<EmployeeRow>(`${P}/employees/${id}/account`, { method: "POST", body: JSON.stringify(data) }),
    /** Сброс пароля. У учётки по почте - `temporary_password`: передать лично, при входе его сменят. */
    reset: (id: string) =>
      request<EmployeeRow & { temporary_password?: string }>(`${P}/employees/${id}/reset`, { method: "POST" }),
    block: (id: string) => request<EmployeeRow>(`${P}/employees/${id}/block`, { method: "POST" }),
    unblock: (id: string) => request<EmployeeRow>(`${P}/employees/${id}/unblock`, { method: "POST" }),
    endSessions: (id: string) =>
      request<EmployeeRow & { sessions_closed?: number }>(`${P}/employees/${id}/end-sessions`, { method: "POST" }),
    /** Закрыть один сеанс сотрудника - «Завершить» в строке его «Сеансов». */
    endSession: (id: string, sessionId: string) =>
      request<EmployeeRow>(`${P}/employees/${id}/sessions/${sessionId}`, { method: "DELETE" }),
    sessions: (id: string) => request<{ items: SessionRow[] }>(`${P}/employees/${id}/sessions`),
  },
  access: {
    catalog: () => request<AccessCatalog>("/access/catalog"),
    get: (kind: "department" | "employee", id: string) => request<SubjectAccess>(`/access/${kind}/${id}`),
    put: (kind: "department" | "employee", id: string, changes: Record<string, GrantChange>) =>
      request<SubjectAccess>(`/access/${kind}/${id}`, { method: "PUT", body: JSON.stringify({ changes }) }),
  },
  audit: {
    list: (query: AuditQuery = {}) =>
      request<{ items: AuditItem[]; next_cursor: string | null }>(`/audit${qs(query)}`),
    view: (section: string, contractId?: string) =>
      request<{ recorded: boolean }>("/audit/view", {
        method: "POST",
        body: JSON.stringify({ section, contract_id: contractId ?? null }),
      }),
    undo: (id: string) => request<{ ok: boolean }>(`/audit/${id}/undo`, { method: "POST" }),
  },
  notifications: {
    list: () => request<{ items: NotificationItem[]; pending: number }>("/notifications"),
    resolve: (id: string) =>
      request<{ ok: boolean; id: string; pending: number }>(`/notifications/${id}/resolve`, { method: "POST" }),
  },
  self: {
    endOtherSessions: () => request<{ closed: number }>("/auth/sessions/end-others", { method: "POST" }),
    changePassword: (body: { old_password: string; new_password: string }) =>
      request<{ ok: boolean; sessions_closed: number }>("/auth/password", { method: "POST", body: JSON.stringify(body) }),
    /** Свои ФИО и телефон - только владельцу и администратору. Ответ - не
     *  `Me`: после правки `me` перечитывают через `financeApi.me()`. */
    profile: (data: { full_name?: string; phone?: string }) =>
      request<{ id: string; full_name: string; phone: string }>("/auth/profile", {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
  },
};

// ── Корзина ──────────────────────────────────────────────────────────────────

/** Удалённое: договор, операция, юрлицо, поле, значение, лист, отдел, сотрудник, запись справочника. */
export type TrashItem = {
  kind: string;
  kind_title: string;
  /** Где это жило: «Реестр», «Журнал», «Настройка реестра», «Кабинет», «Справочники». */
  where: string;
  id: string;
  title: string;
  deleted_at: string | null;
  /** Кто удалил - из журнала действий; пусто, если там нет записи о записи. */
  by: string;
};

export const trashApi = {
  list: () => request<{ items: TrashItem[] }>("/trash"),
  restore: (kind: string, id: string) =>
    request<{ kind: string; id: string; title: string; where: string }>(`/trash/${kind}/${id}/restore`, { method: "POST" }),
  purge: (kind: string, id: string) =>
    request<{ kind: string; id: string; title: string }>(`/trash/${kind}/${id}`, { method: "DELETE" }),
};

// ── Личный вид листов ────────────────────────────────────────────────────────

/** Вид листа - как его собирает `univer/look.ts`; сервер держит как есть. */
export const looksApi = {
  get: (key: string) => request<{ look: Record<string, unknown> }>(`/looks/${key}`),
  put: (key: string, look: unknown) =>
    request<{ ok: boolean }>(`/looks/${key}`, { method: "PUT", body: JSON.stringify({ look }) }),
  reset: (key: string) => request<{ ok: boolean }>(`/looks/${key}`, { method: "DELETE" }),
};

// ── Поддержка KORT ───────────────────────────────────────────────────────────

export type SupportFile = {
  id: string;
  kind: "image" | "voice" | "file";
  name: string;
  mime: string;
  size: number;
  /** Длительность голосового, секунды. */
  duration: number | null;
};

export type SupportItem = {
  id: string;
  author: "user" | "support";
  body: string;
  created_at: string;
  files: SupportFile[];
  /** Ответ поддержки уже открыт. */
  read?: boolean;
  /** Сообщение человека дошло до канала поддержки. */
  delivered?: boolean;
  /** Не дошло дольше пары минут - сказать об этом словами. */
  late?: boolean;
};

export type SupportLimits = {
  max_body: number;
  max_files: number;
  max_file_bytes: number;
  max_total_bytes: number;
  max_voice_seconds: number;
};

/**
 * Переписка с поддержкой (`app/finance/support.py`). Отправка - своей
 * функцией на XHR (`support/send.ts`): у `fetch` нет хода загрузки, а
 * голосовое с десятком скриншотов на медленной сети грузится заметно.
 */
export const supportApi = {
  thread: () => request<{ items: SupportItem[]; state: SupportState; limits: SupportLimits }>("/support"),
  read: () => request<SupportState>("/support/read", { method: "POST" }),
  notice: (body: { seen_on?: string; off?: boolean }) =>
    request<SupportState>("/support/notice", { method: "POST", body: JSON.stringify(body) }),
  fileUrl: (id: string) => `${API}/support/files/${id}`,
  sendUrl: `${API}/support/messages`,
};

// ── Ядро: участники, наши юрлица, налоговые годы ────────────────────────────

export type ParticipantKind = "org" | "person" | "ip" | "";
export type AliasSource = "registry" | "bank" | "1c" | "manual";

export type ParticipantHit = {
  id: string;
  name: string;
  full_name: string;
  bin: string;
  kind: ParticipantKind;
  /** Код нашего юрлица, если участник - наше юрлицо. */
  own: string | null;
  contracts: number;
  /** У нашего юрлица - режим на сегодня; `null` - режим не записан. */
  regime?: TaxPeriod | null;
};

export type ParticipantsShow = "all" | "own" | "no_bin";

export type ParticipantsOverview = {
  all: number;
  own: number;
  no_bin: number;
  twins: number;
  proposals: number;
  /** Прочитана ли книга-сводка: без неё БИН из строк банка ещё не предложены. */
  book: boolean;
  access: { edit: boolean; setup: boolean };
};

export type ParticipantAlias = { id: string; name: string; source: AliasSource; source_title: string };

export type DossierContract = {
  id: string;
  number: string;
  signed_at: string | null;
  role: "customer" | "executor";
  type: { id: string; value: string; meaning: Record<string, unknown> } | null;
  subject: { id: string; value: string; meaning: Record<string, unknown> } | null;
  status: { id: string; value: string; meaning: { phase?: string } & Record<string, unknown> } | null;
  billing: string;
  amount: string | null;
  end_date: string | null;
  departments: string[];
};

export type DossierGroup = {
  party_id: string | null;
  name: string;
  full_name: string;
  own: boolean;
  contracts: DossierContract[];
};

export type TaxPeriod = {
  id: string;
  valid_from: string;
  regime: "general" | "simplified" | "other";
  regime_title?: string;
  vat_payer: boolean;
  note: string;
};

export type BinProposal = {
  party_id: string;
  name: string;
  numbers: { bin: string; kind: ParticipantKind; evidence: string[]; taken_by: { id: string; name: string } | null }[];
  clear: boolean;
};

export type TwinGroup = {
  key: string;
  why: string[];
  keep: string;
  members: { id: string; name: string; bin: string; own: boolean; contracts: number; aliases: number }[];
};

export type Dossier = {
  id: string;
  name: string;
  full_name: string;
  bin: string;
  kind: ParticipantKind;
  role: string;
  aliases: ParticipantAlias[];
  groups: DossierGroup[];
  contracts: number;
  issues: { code: string; text: string; group?: TwinGroup }[];
  proposals: BinProposal[];
  own: {
    code: string;
    full_name: string;
    archived: boolean;
    tax: TaxPeriod[];
    accounts: { id: string; name: string; number: string }[];
    bases: { id: string; title: string; url: string; state: string }[];
  } | null;
  /** Участник сведён в другого - досье того. */
  merged_into?: string;
};

export type HarvestResult = {
  rows: number;
  matched: number;
  aliases: Partial<Record<AliasSource, number>>;
  codes: { entity_id: string; name: string; code: string; rows: number; how: "name" | "rows" | "majority" }[];
  conflicts: { code: string; entities: { id: string; name: string; rows: number }[] }[];
  applied: boolean;
};

export type TaxYear = {
  year: number;
  mrp: string;
  threshold_mrp: number;
  threshold: string;
  vat_rate: string;
  forecast: boolean;
  source: string;
};

/** Начисление месяца (`core/accruals.py`): считается из условий договора, не хранится. */
export type AccrualOut = {
  month: string;
  period_from: string;
  period_to: string | null;
  /** По условиям договора; `null` - доначисление поправкой или сумма не задана. */
  base: string | null;
  /** С поправкой; `null` - «не начислять» или суммы нет. */
  amount: string | null;
  executor_id: string | null;
  skipped: boolean;
  adjustment: { id: string; amount: string | null; skip: boolean; reason: string } | null;
};

/** Строки книги-сводки договора за месяц. Деньги (`paid`, `act_sum`) - только с правом на них. */
export type BookMonthOut = {
  rows: number;
  line: number;
  amount: string | null;
  period_from: string | null;
  period_to: string | null;
  code: string;
  entity_id: string | null;
  bill_no: string;
  bill_date: string | null;
  act_no: string;
  act_date: string | null;
  accepted: string;
  esf_date: string | null;
  status: string;
  paid?: string | null;
  act_sum?: string | null;
  closing?: string | null;
};

export type ShadowCode = "amount" | "period" | "executor" | "no_kort" | "no_book";

/** Решение «верно у KORT» (`core/changes.py`): действует, пока KORT и таблица считают месяц так же. */
export type ShadowDecision = { id: string; at: string | null; batch: string | null };

export type ShadowLine = {
  contract_id: string;
  month: string;
  codes: ShadowCode[];
  kort: AccrualOut | null;
  book: BookMonthOut | null;
  /** Почему расходится, если это видно из данных: ошибка периода таблицы, день периода у KORT. */
  hint: string;
  /** Таблица пропустила день периода, посчитала его дважды или идёт со сдвигом после этого. */
  slip: "gap" | "overlap" | "shift" | "";
  verified: ShadowDecision | null;
  /** Решение было, но с тех пор изменились условия договора, таблица или обе стороны. */
  stale: (ShadowDecision & { side: "kort" | "book" | "both" }) | null;
};

export type ShadowProposalKind =
  | "billing"
  | "period_day"
  | "billing_from"
  | "amount_from"
  | "amount_before"
  | "amount_fix"
  | "executor_from"
  | "executor_before"
  | "adjust"
  | "pause"
  | "stop"
  | "end"
  | "status";

export type ShadowProposal = {
  key: string;
  contract_id: string;
  kind: ShadowProposalKind;
  value: Record<string, unknown>;
  text: string;
  months: string[];
  /** Вопрос: «from»/«month» - с этого месяца или только этот; «end»/«pause» - закончился или стоит. */
  options: string[];
  /** Подписи ответов, которых нет в интерфейсе заранее: статусы компании. */
  labels?: Record<string, string>;
};

export type ShadowContract = {
  id: string;
  number: string;
  customer: string;
  executor: string;
  billing: string;
  period_day: number | null;
  start: string | null;
  why: string;
  paused: string[];
  clean: boolean;
};

export type ShadowUnknown = {
  key: string;
  own: string;
  customer: string;
  number: string;
  state: "missing" | "other_client" | "ambiguous";
  months: string[];
  amount: string | null;
  lines: number[];
  candidates: { id: string; number: string; customer: string }[];
};

export type ShadowView = {
  book: { title: string; worksheet: string; read_at: string; url: string; drift: string } | null;
  error: string;
  window: string[];
  counts: Partial<Record<"contracts" | "clean" | "months" | "same" | "verified" | ShadowCode | "unknown" | "proposals", number>>;
  contracts: Record<string, ShadowContract>;
  lines: ShadowLine[];
  proposals: ShadowProposal[];
  unknown: ShadowUnknown[];
};

export type BillsShadowCode = "group" | "no_kort" | "no_book" | "kort_issued";
export type BillGroupKey = "overdue" | "soon" | "early" | "undated";

/** «Не выставлены» KORT против книги (`core/billing.py`), по договору и месяцу. */
export type BillsShadow = {
  book: ShadowView["book"];
  error: string;
  window: string[];
  counts: Partial<Record<"same" | "kort_waits" | "book_waits" | BillsShadowCode, number>>;
  lines: {
    contract_id: string;
    month: string;
    code: BillsShadowCode;
    kort: { group: BillGroupKey | null; due: string; amount: string | null; bill: { source: string; number: string } | null } | null;
    book: { group: BillGroupKey | null; text: string; due: string | null; amount: string | null } | null;
  }[];
  contracts: Record<string, { id: string; number: string; customer: string; executor: string }>;
  codes: Record<BillsShadowCode, string>;
  groups: Record<BillGroupKey, string>;
};

/** Оборот нашего юрлица к порогу НДС за год (`core/vat.py`). Суммы - без НДС. */
/** Юрлицо в году: плательщик НДС с начала года, станет с даты, не плательщик (к порогу), режим не записан. */
export type VatStatus = "payer" | "becomes" | "racing" | "unknown";

/** НДС в назначениях поступлений юрлица за год - довод записать режим, а не режим. */
export type VatHint = { total: number; with: number; without: number; first: string | null; sample: string };

export type VatEntity = {
  entity_id: string;
  code: string;
  name: string;
  regime: string;
  status: VatStatus;
  /** С какого дня плательщик НДС в этом году. */
  payer_from: string | null;
  payer_now: boolean;
  payer_since: string | null;
  /** НДС с начала года по текущий месяц. */
  vat_fact: string;
  hint: VatHint | null;
  /** Начислено с начала года по текущий месяц включительно. */
  fact: string;
  /** Весь год: начислено и прогноз по условиям договоров до декабря. */
  forecast: string;
  vat: string;
  /** До порога: оборот к нему - до даты постановки на НДС; плательщику с начала года - `null`. */
  remaining: string | null;
  /** Месяц, в котором оборот с начала года превысит порог; `null` - не превысит (или плательщик). */
  crossing: string | null;
  months: { month: string; net: string; vat: string; acts: string | null; forecast: boolean; contracts: number }[];
};

export type VatYearView = { year: TaxYear; today: string; entities: VatEntity[] };

export type VatClient = {
  contract_id: string;
  number: string;
  customer_id: string | null;
  customer: string;
  monthly: string;
  rest: string;
  next: string;
};

export type VatMove = { contract_id: string; target: string; since: string };

export type VatPreview = {
  entities: {
    entity_id: string;
    code: string;
    name: string;
    before: string;
    after: string;
    status: VatStatus;
    /** НДС к концу года до и после перевода - то, что важно плательщику. */
    vat_before: string;
    vat_after: string;
    crossing_before: string | null;
    crossing_after: string | null;
  }[];
  /** Чей это предпросмотр - выбор, для которого считали (клиент). */
  key?: string;
};

/** Оплата договора из источника (`core/payments.py`): операция журнала или поступление 1С. */
export type CorePayment = {
  key: string;
  source: "journal" | "1c";
  paid_at: string;
  amount: string;
  /** «За какие месяцы» по источнику: первый и последний. */
  hint: [string, string] | null;
  how: string;
  payer: string;
  comment: string;
  contract_ref: string;
  account: string;
};

/** Долг, который гасят оплаты: входящее сальдо (`month: "opening"`) или начисление месяца. */
export type MoneyBucket = {
  month: string;
  accrued: string;
  paid: string;
  debt: string;
  /** `hint` - по «за какой месяц», `order` - старейшему долгу, `date` - по месяцу платежа. */
  parts: { key: string; paid_at: string; amount: string; by: "hint" | "order" | "date" }[];
};

export type ContractMoney = {
  /** С какого дня KORT ведёт оплаты; `null` - оплат ещё нет. */
  since: string | null;
  /** День компании, на который считан долг. */
  today: string;
  opening: MoneyBucket | null;
  months: MoneyBucket[];
  over: { key: string; paid_at: string; amount: string }[];
  over_total: string;
  payments: CorePayment[];
  paid: string;
  /** Считает ли KORT начисления договора; нет - долг неизвестен. */
  accrues: boolean;
  /** Долг на сегодня: сальдо и начисления к сегодня минус оплаты; минус - аванс; `null` - неизвестен. */
  debt: string | null;
};

/** АВР месяца договора в одном источнике (`core/acts.py`). Сумма - только с правом на деньги. */
export type ActOut = {
  source: "kort" | "1c" | "book";
  month: string;
  number: string;
  date: string | null;
  amount: string | null;
  signed: string | null;
  accepted: boolean;
  esf: string | null;
  esf_sent: boolean;
  esf_state: string;
  ref: string;
};

export type ActCode = "act_no_book" | "act_no_1c" | "act_amount" | "act_signed" | "esf";

/** АВР месяца: выбранный по приоритету (KORT, 1С, книга), где ещё есть и чем 1С и книга расходятся. */
export type MonthAct = { act: ActOut | null; sources: ActOut["source"][]; codes: ActCode[] };

export type ContractMonths = {
  schedule: { kind: "month" | "total" | ""; start: string | null; period_day: number | null; why: string; paused: string[] };
  months: {
    month: string;
    kort: AccrualOut | null;
    book: BookMonthOut | null;
    codes: ShadowCode[];
    paused: boolean;
    hint?: string;
    verified?: ShadowDecision | null;
    /** НДС счёта и АВР месяца - у исполнителя-плательщика на день «Периода с»; иначе пусто. */
    vat?: { mode: "included" | "on_top" | "none"; rate: string; net: string; vat: string; gross: string } | null;
  }[];
  book: boolean;
  window: string[];
  proposals: ShadowProposal[];
  /** Оплаты KORT по месяцам - тем, кому открыты оплаты по выписке. */
  money?: ContractMoney;
  /** АВР по месяцам. */
  acts?: Record<string, MonthAct>;
  /** День компании, на который построена лента. */
  today?: string;
};

export type ActsView = {
  book: ShadowView["book"];
  error: string;
  window: string[];
  /** Юрлица с подключённой 1С - у них 1С сверяется с книгой. */
  onec: { id: string; code: string; name: string }[];
  counts: Partial<Record<"months" | "same" | ActCode, number>>;
  lines: { contract_id: string; month: string; codes: ActCode[]; onec: ActOut | null; book: ActOut | null }[];
  unsigned: { contract_id: string; act: ActOut; days: number }[];
  no_esf: { contract_id: string; act: ActOut; days: number }[];
  missing: { contract_id: string; month: string }[];
  contracts: Record<string, { id: string; number: string; customer: string; executor: string }>;
  codes: Record<ActCode, string>;
  esf_days: number;
};

export type PaidShadowCode = "paid" | "paid_no_kort" | "paid_no_book";

/** Поступление журнала без договора - с кандидатами. */
export type PaymentWithout = {
  operation_id: string;
  paid_at: string;
  amount: string;
  payer: string;
  account: string;
  entity_id: string | null;
  category: string;
  comment: string;
  contract_ref: string;
  hint: [string, string] | null;
  disputed: boolean;
  /** `out` - возврат клиенту, к которому KORT предлагает договор (О6). */
  direction?: "in" | "out";
  candidates: {
    id: string;
    number: string;
    customer: string;
    executor_id: string | null;
    why: "спор" | "за другого" | "возврат" | "номер" | "клиент" | "сумма";
  }[];
  /** Части, как бухгалтер разделил ту же оплату в 1С (О2). */
  split?: { id: string; number: string; amount: string }[];
};

/** Основание долга и сальдо: по начислениям (что должен по договору) или по АВР (по выставленным актам). */
export type DebtBasis = "accruals" | "acts";

export type OpeningPlan = {
  since: string;
  items: {
    contract_id: string;
    number: string;
    basis: DebtBasis;
    amount: string;
    was: string | null;
    line: number;
    state: "new" | "changed" | "remove";
  }[];
  counts: Record<"new" | "changed" | "remove" | "same" | "manual", number>;
  /** По начислениям: долг и аванс на начало учёта. */
  debt: string;
  advance: string;
  /** По АВР. */
  acts_debt: string;
  acts_advance: string;
};

/** Возраст неоплаченного: остаток сальдо «до учёта» и дни от начала периода (даты акта). */
export type DebtAge = "opening" | "d30" | "d60" | "d90" | "d90plus";
/** Вторая сторона (клиент, у покупки - поставщик), наше юрлицо, отдел, сотрудник. */
export type DebtGroup = "client" | "entity" | "department" | "person";
/** Нам должны; мы должны (покупки); между своими (обе стороны - наши юрлица). */
export type DebtDirection = "receivable" | "payable" | "intra";

export type DebtContract = {
  id: string;
  number: string;
  /** Вторая сторона: клиент, у покупки - поставщик. */
  party: string;
  /** Наше юрлицо договора. */
  entity: string;
  /** Доля в процентах, когда в группе не весь договор. */
  fraction: string | null;
  /** Долг договора целиком, когда в группе - его доля. */
  whole: string | null;
  /** Долг за вычетом аванса; минус - аванс. */
  debt: string;
  /** Неоплаченное: долг = неоплаченное минус аванс. */
  owed: string;
  aging: Partial<Record<DebtAge, string>>;
  advance: string | null;
  paid: string;
};

export type DebtRow = {
  key: string;
  title: string;
  /** «Не распределено», «доли закрыты», «без отдела» - не отдел и не человек. */
  special: boolean;
  debt: string;
  owed: string;
  advance: string | null;
  aging: Partial<Record<DebtAge, string>>;
  contracts: DebtContract[];
};

/** Долги по договорам на день (`core/debts.py`). */
export type DebtsView = {
  as_of: string;
  basis: DebtBasis;
  side: DebtDirection;
  group: DebtGroup;
  since: string | null;
  ages: { key: DebtAge; title: string }[];
  /** Итог каждой стороны - для переключателя сторон. */
  sides: Record<DebtDirection, { owed: string; advance: string; contracts: number; unknown: number }>;
  totals: {
    /** Долг за вычетом авансов. */
    debt: string;
    /** Неоплаченное - сумма корзин возраста. */
    owed: string;
    advance: string;
    aging: Partial<Record<DebtAge, string>>;
    contracts: number;
    /** Договоры, долг которых KORT не знает. */
    unknown: number;
  };
  rows: DebtRow[];
  book: ShadowView["book"];
  error: string;
};

/** Колонка ядра в шапке сводной таблицы (`core/book.py`, `layout.inspect_layout`). */
export type BookColumn = {
  key: string;
  title: string;
  required: boolean;
  strict: boolean;
  index: number | null;
  header: string;
  /** exact | squashed | loose | missing - как нашлась. */
  how: string;
  /** Почему не нашлась: «нет в таблице», несколько похожих, та же колонка у другой. */
  problem: string;
  /** Названия ядра. */
  names: string[];
  /** Названия компании из словаря. */
  extra: string[];
};

export type BookColumnsView = { connected: boolean; header: string[]; columns: BookColumn[]; error: string };

/** Колонка таблицы со словами компании: «Счет» (состояние счёта) или «Вид Услуги» (пост бота). */
export type TableWordPart = "bill" | "kind";

/** Значение колонки, встреченное в таблице: строк, смысл и откуда он (`core/settings.table_words`). */
export type TableWordSeen = {
  text: string;
  rows: number;
  /** Смысл: у «Счет» - issued / overdue / soon / early / undated; у «Вида Услуги» - abon / rent / skip; пусто - не знаю. */
  meaning: string;
  /** `kort` - KORT понимает сам, `company` - смысл дала компания, `unknown` - KORT не знает этого слова. */
  how: "kort" | "company" | "unknown";
};

export type TableWordsView = {
  titles: Record<string, string>;
  meanings: Record<TableWordPart, string[]>;
  seen: Record<TableWordPart, TableWordSeen[]>;
  error: string;
};

/** «Первые шаги» (`core/onboarding.py`): что KORT заведёт по сводной таблице - по шагам. */
export type StartStep = "entities" | "contracts" | "since";

/** Приёмник: форма строки листа (`intake/forms.py`). */
export type IntakeForm = "participant" | "contract" | "contract_month" | "payment" | "document" | "balance";
export type IntakeQuestion = {
  kind: "form" | "hidden" | "column" | "date_order";
  text: string;
  options?: { value: string; label: string; example?: string }[];
  lines?: number[];
  columns?: number[];
};
/** Разметка листа человеком (`intake/layout.py`): форма, колонки, порядок даты, чьи договоры. */
export type IntakeLayout = {
  form: string;
  columns?: Record<string, string>;
  date_order?: string;
  executor?: string;
  department?: string;
  billing?: string;
  as_of?: string;
  month?: string;
  hidden?: string;
  skip?: boolean;
  sheet?: string;
};
export type IntakeAnswers = { sheets: Record<string, IntakeLayout>; questions: Record<string, string> };
export type IntakeFormInfo = { key: IntakeForm; title: string; fields: { key: string; title: string }[] };
/** Вопрос предложения: разметка листа (`setup`) или данные (`questions`). */
export type IntakeAsk = {
  kind: string;
  key?: string;
  text: string;
  sheet?: string;
  line?: number;
  layout?: boolean;
  options?: { value: string; label: string; example?: string }[];
};
/** Что лист положит в модель (`core/excel.py`, `Proposal.to_dict`) - и где расходится с KORT. */
export type IntakeProposal = {
  sheet: string;
  form: IntakeForm | "";
  form_title: string | null;
  rows: number;
  setup: IntakeAsk[];
  questions: IntakeAsk[];
  refusals: { kind: string; text: string }[];
  ready: boolean;
  contracts: {
    new: number;
    same: number;
    fill: number;
    waiting: number;
    items: { action: string; line?: number; name?: string; number?: string | null; known?: string; why?: string }[];
  };
  parties: Record<string, number>;
  openings: {
    as_of: string | null;
    count: number;
    debt: string | null;
    items: { line: number; number: string | null; name: string; amount: string; kort: string | null; state: string; take: boolean }[];
  };
  ends: { line: number; number: string | null; name: string; end: string; kort: string | null; state: string }[];
  compare: { kind: string; line?: number; sheet?: string; name?: string; number?: string | null; month?: string; file?: string | null; kort?: string | null; text?: string }[];
  missing: string[];
};
export type IntakePlan = { file: string; sheets: IntakeProposal[] };
export type IntakeApplied = IntakePlan & {
  created: number;
  filled: number;
  aliases: number;
  ended: number;
  openings: number;
  blocked: string[];
  point: { id: string; title: string; kind: string } | null;
};
export type IntakeSheet = {
  sheet: string;
  form: IntakeForm | null;
  form_title: string | null;
  title?: string;
  header_line?: number | null;
  rows: number | null;
  columns: { index: number; header: string; key: string | null; title: string | null; how: string }[];
  service?: Record<string, number>;
  hidden?: number[];
  alternatives?: { form: IntakeForm; title: string; score: number }[];
  questions: IntakeQuestion[];
  refusals: { kind: string; text: string }[];
  note?: string;
  /** Шапка листа - для разметки; `layout` - разметка, запомненная компанией. */
  header?: string[];
  layout?: IntakeLayout;
  /** Форма, которую кладёт в модель путь таблиц отделов (договор, договор за месяц, остаток на дату). */
  excel?: boolean;
};
export type IntakeFile = { file: string; pdf?: boolean; error?: string; sheets: IntakeSheet[]; forms?: IntakeFormInfo[] };

/** Вход из 1С (`core/onec_start.py`): что заведём из базы - по шагам. */
export type OnecStartDraft = {
  key: string;
  label: string;
  number: string;
  customer: string;
  signed: string | null;
  /** `documents` - сумма месяца по счетам и актам 1С (аренда с коммунальными по счётчикам). */
  billing: "month" | "total" | "documents" | "";
  amount: string | null;
  billing_from: string | null;
  changes: { from: string; amount: string | null }[];
  pauses: { from: string; to: string }[];
  last_day: string | null;
  outliers: string[];
  acts: number;
  contract_id: string | null;
  /** Договор другого нашего ТОО, клиента которого перевели на юрлицо базы: с какого числа. */
  moved_from: string | null;
  since: string | null;
};
export type OnecStartPlan = {
  /** `files` - база из выгрузок 1С файлами, без поступлений: оплаты - из выписок банка. */
  base: { id: string; title: string; organization: string; bin: string; files: boolean };
  entity: { id: string | null; name: string; bin: string };
  participants: { counts: Partial<Record<"same" | "alias" | "bin" | "create" | "dispute", number>>; items: unknown[] };
  contracts: {
    known: number;
    new: number;
    /** Заведутся без суммы: в 1С по ним только оплаты. */
    no_amount?: number;
    questions: OnecStartDraft[];
    items: OnecStartDraft[];
    moves: OnecStartDraft[];
  };
  since: { current: string | null; proposed: string | null };
  openings: { since: string | null; contracts: number; debt: string | null; missing: { party: string; contract: string; opening: string | null; why: string }[]; problems: string[] } | null;
  payments: { source: "journal" | "1c" | null };
};
export type OnecStartStep = "entity" | "participants" | "contracts" | "since" | "payments";
export type OnecStartAnswer = { end?: string; active?: boolean; pause?: boolean; move?: boolean };
/** Выгрузка 1С файлами (`onec/files.py`): базы организаций и что в файлах. */
export type OnecFilesResult = {
  bases: Record<string, { organization: string; title: string; counts: Partial<Record<"sale" | "invoice", number>> }>;
  without_bin: string[];
  upload: {
    journals: { file: string; sheet: string; kind: "sale" | "invoice"; documents: number; organizations: string[]; problems: string[] }[];
    parties: number;
    with_bin: number;
    osv: { start: string | null; contracts: number; organizations: string[] } | null;
    organizations: string[];
    skipped: string[];
    problems: string[];
  };
};

export type StartPlan = {
  /** Сводная таблица подключена; `book` пуст - ещё читается или отказ (`error`). */
  connected: boolean;
  error: string;
  book: { title: string; worksheet: string; rows: number; matched: number } | null;
  entities?: { items: { code: string; rows: number; id: string | null }[]; missing: number };
  contracts?: {
    total: number;
    missing: number;
    missing_rows: number;
    disputed: number;
    groups: { key: string; own: string; customer: string; number: string; months: string[]; amount: string | null }[];
  };
  since?: { current: string | null; proposed: string };
  openings?: { since: string; new: number; same: number; debt: string | null };
  debts?: { owed: string; contracts: number; advance: string } | null;
};

export type StartDone = {
  done?: number;
  codes?: string[];
  since?: string;
  point?: { id: string; title: string } | null;
};

/** Звенья перехода с таблицы на KORT (`core/switch.py`). */
export type SwitchLinkKey = "accruals" | "bills" | "payments" | "acts" | "saldo";
/** Откуда звено юрлица: `book` - таблица, `kort` - KORT. */
export type SwitchSource = "book" | "kort";

export type SwitchSources = {
  links: { key: SwitchLinkKey; title: string; switchable: boolean }[];
  /** Звено → наше юрлицо → `kort`; нет в словаре - таблица. */
  sources: Partial<Record<SwitchLinkKey, Record<string, SwitchSource>>>;
};

/** Звено у одного нашего юрлица: месяцев договоров сверено и совпало, строк таблицы без договора в KORT. */
export type SwitchEntity = {
  id: string;
  code: string;
  months: number;
  same: number;
  unknown: number;
  /** Доля совпавших от сверенного вместе со строками без договора, «0.9876»; `null` - сверять нечего. */
  share: string | null;
  contracts: number;
  contracts_same: number;
  /** Всё совпало и строк без договора нет. */
  clean: boolean;
  /** Последние закрытые месяцы окна: сверено (вместе со строками без договора) и совпало. */
  closed: { month: string; checked: number; same: number }[];
  /** Готово к переходу: последние закрытые месяцы - без единого расхождения. */
  ready: boolean;
  source: SwitchSource;
};

export type SwitchTally = {
  link: SwitchLinkKey;
  title: string;
  switchable: boolean;
  window: string[];
  entities: SwitchEntity[];
  error: string;
};

export type SwitchPreview = {
  entity: { id: string; code: string };
  source: SwitchSource;
  counts: {
    before: number;
    after: number;
    appear: number;
    vanish: number;
    regroup: number;
    overdue_before: number;
    overdue_after: number;
  };
  appear: Bill[];
  vanish: Bill[];
  regroup: { bill: Bill; before: BillGroup; before_text: string }[];
};

/** Что станет с «Оплачено» договоров юрлица после перехода оплат (`core/switch.preview_payments`). */
export type SwitchPaymentsPreview = {
  entity: { id: string; code: string };
  source: SwitchSource;
  counts: { contracts: number; same: number; differ: number; table_only: number; kort_only: number };
  totals: { table: string; kort: string };
  items: { id: string; number: string; customer: string; table: string | null; kort: string; code: "differ" | "table_only" | "kort_only" }[];
};

/** Карта группы (`core/group_map.py`): наши ТОО и что между ними. */
export type GroupNode = {
  id: string;
  code: string;
  name: string;
  status: VatStatus;
  payer_from: string | null;
  fact: string;
  forecast: string;
  vat: string;
  crossing: string | null;
};

export type GroupEdge = {
  kind: "intra" | "transfer";
  from: string;
  to: string;
  contracts: number;
  /** Договоры между своими - начислено за год к сегодня; перевод - месячная сумма переведённых. */
  amount: string;
  numbers?: string[];
  /** Перевод - с какого месяца. */
  month?: string;
};

export type GroupView = {
  year: number;
  threshold: string;
  nodes: GroupNode[];
  edges: GroupEdge[];
  people: { id: string; name: string; entities: { code: string; amount: string }[]; total: string }[];
  people_total: number;
};

/** Карточка «Сегодня» (`core/today.py`): дело числом и переход в список. */
export type TodayCardKey = "debts" | "payments" | "acts" | "vat" | "shadow" | "participants";

export type TodayLine = {
  label: string;
  amount?: string | null;
  count?: number;
  /** «из N» - всего, к чему относится число. */
  of?: number;
  /** Месяц события (переход порога НДС). */
  month?: string;
  names?: string[];
  /** Что выбрать в разделе по щелчку на строку - сверх выбора карточки. */
  go?: Record<string, string>;
};

export type TodayCard = {
  key: TodayCardKey;
  title: string;
  amount: string | null;
  count: number | null;
  unit: string;
  /** Делать нечего - словами. */
  empty: string;
  note: string;
  lines: TodayLine[];
  /** Раздел и состояние его экрана (ключи `useSessionState`). */
  go: { section: string; session: Record<string, string> };
};

/** Выручка по договорам (`core/revenue.py`): начислено, АВР, оплачено за месяц, поступило. */
export type RevenueMeasure = "accrued" | "acts" | "paid" | "received";
export type RevenueGroup = "entity" | "client" | "department" | "person";
/** Сумма меры за месяц; `null` - KORT этого не знает (оплаты до начала учёта). */
export type RevenueCell = Record<RevenueMeasure, string | null>;

export type RevenueView = {
  year: number;
  months: string[];
  side: "receivable" | "intra";
  group: RevenueGroup;
  since: string | null;
  /** С какого месяца начисления - прогноз по условиям договоров. */
  forecast_from: string | null;
  rows: { key: string; title: string; special: boolean; contracts: number; months: Record<string, RevenueCell>; total: RevenueCell }[];
  totals: { months: Record<string, RevenueCell>; total: RevenueCell };
  book: ShadowView["book"];
  error: string;
};

/** Сальдо KORT на конец месяца против «Сальдо Конец» сводной таблицы. */
export type SaldoShadow = {
  book: ShadowView["book"];
  error: string;
  basis: DebtBasis;
  window: string[];
  counts: Partial<Record<"contracts" | "same" | "months" | "months_same", number>>;
  contracts: Record<string, { id: string; number: string; customer: string; executor: string }>;
  lines: { contract_id: string; diff: string; first: string; months: { month: string; kort: string; book: string; same: boolean }[] }[];
};

export type PaymentsView = {
  settings: {
    since: string | null;
    since_used: string | null;
    sources: Record<string, "journal" | "1c">;
    /** Статьи и плательщики, целиком отмеченные «не оплаты по договорам». */
    ignore: { categories: string[]; payers: string[] };
  };
  entities: { id: string; code: string; name: string; source: "journal" | "1c"; journal: number; onec: number }[];
  without: PaymentWithout[];
  /** Сколько поступлений скрыто: переводы своих юрлиц, отмеченное «не оплаты», решённое «не по договору». */
  without_hidden: { own: number; ignored: number; decided: number; returned?: number; deposit?: number };
  book: ShadowView["book"];
  error: string;
  shadow: {
    window: string[];
    since: string | null;
    counts: Partial<Record<"contracts" | "same" | "months" | "months_same" | PaidShadowCode, number>>;
    contracts: Record<
      string,
      { id: string; number: string; customer: string; executor: string; kort: string; book: string; same: boolean; opening_paid: string | null; over: string | null }
    >;
    lines: { contract_id: string; diff: string; months: { month: string; kort: string | null; book: string | null; code: PaidShadowCode | "" }[] }[];
  } | null;
  opening: OpeningPlan | null;
};

/** Адрес сверки с фильтром «по ТОО»; без юрлица - как был. */
function withEntity(path: string, entity?: string): string {
  if (!entity) return path;
  return `${path}${path.includes("?") ? "&" : "?"}entity=${encodeURIComponent(entity)}`;
}

/** Источник вида: договоры листами, «Долги», «Не выставлены». */
export type ViewSource = "contracts" | "debts" | "unbilled";

/** Вид - сохранённый вопрос к ядру (`core/views.py`). */
export type CoreView = {
  id: string;
  key: string;
  title: string;
  source: ViewSource;
  owner: ViewOwner;
  filter: ViewFilter | Record<string, never>;
  measures: string[];
  groups: string[];
  forms: string[];
  params: Record<string, string>;
  /** Кому в колонке: всем, владельцу, никому. */
  pin: "all" | "owner" | "";
  position: number;
  template: string;
  /** Стоит ли в колонке у этого человека. */
  pinned: boolean;
  editable: boolean;
};

export type ViewTemplate = { key: string; title: string; source: ViewSource; note: string; department: boolean };

export type ViewsList = {
  views: CoreView[];
  templates: ViewTemplate[];
  measures: { key: string; title: string; type: string; note: string }[];
  sources: Record<ViewSource, { title: string; forms: { key: string; title: string }[]; groups: { key: string; title: string }[] }>;
};

export type ViewChange = {
  template?: string;
  title?: string;
  source?: ViewSource;
  owner?: "company" | "me" | { department: string };
  filter?: ViewFilter;
  measures?: string[];
  groups?: string[];
  forms?: string[];
  params?: Record<string, string>;
  pin?: "all" | "owner" | "";
  position?: number;
};

export const coreApi = {
  /** Виды компании, которые человек видит, с отметкой «в колонке» (`core/views.py`). */
  views: () => request<ViewsList>("/core/views"),
  viewCreate: (change: ViewChange) => request<CoreView>("/core/views", { method: "POST", body: JSON.stringify(change) }),
  viewUpdate: (id: string, change: ViewChange) =>
    request<CoreView>(`/core/views/${id}`, { method: "PATCH", body: JSON.stringify(change) }),
  viewRemove: (id: string) => request<{ ok: boolean }>(`/core/views/${id}`, { method: "DELETE" }),
  onecStart: (baseId: string) => request<OnecStartPlan>(`/core/onec-start/${baseId}`),
  onecStartOsv: (baseId: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<{ start: string | null; contracts: number; opening: string; problems: string[] }>(
      `/core/onec-start/${baseId}/osv`,
      { method: "POST", body: form },
    );
  },
  /** Сальдо 1210 на первое число прямо из базы 1С по REST - вместо ОСВ файлом. */
  onecStartBalances: (baseId: string, day: string) =>
    request<{ start: string | null; contracts: number; opening: string; problems: string[] }>(
      `/core/onec-start/${baseId}/balances`,
      { method: "POST", body: JSON.stringify({ day }) },
    ),
  /** 1С без интернета: журналы, контрагенты и ОСВ одной выгрузкой - в базы организаций. */
  onecFiles: (files: File[]) => {
    const form = new FormData();
    for (const file of files) form.append("files", file);
    return request<OnecFilesResult>("/core/onec-files", { method: "POST", body: form });
  },
  onecStartStep: (baseId: string, step: OnecStartStep, answers: Record<string, OnecStartAnswer> = {}) =>
    request<{ done: number; waiting?: string[]; moved?: string[]; point?: { id: string; title: string; kind: string } | null; missing?: unknown[] }>(
      `/core/onec-start/${baseId}/${step}`,
      { method: "POST", body: JSON.stringify({ answers }) },
    ),
  /** Приёмник: что KORT видит в каждом листе файла - ничего не пишет. */
  intake: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<IntakeFile>("/core/intake", { method: "POST", body: form });
  },
  /** Что таблица положит в модель по разметке - и где расходится с KORT. Ничего не пишет. */
  intakePlan: (file: File, answers: IntakeAnswers) => {
    const form = new FormData();
    form.append("file", file);
    form.append("answers", JSON.stringify(answers));
    return request<IntakePlan>("/core/intake/plan", { method: "POST", body: form });
  },
  /** Завести из таблицы пачкой с точкой восстановления; разметка запоминается словарём компании. */
  intakeApply: (file: File, answers: IntakeAnswers) => {
    const form = new FormData();
    form.append("file", file);
    form.append("answers", JSON.stringify(answers));
    return request<IntakeApplied>("/core/intake/apply", { method: "POST", body: form });
  },
  list: (q: string, show: ParticipantsShow = "all", init?: RequestInit) =>
    request<{ items: ParticipantHit[]; total: number }>(
      `/core/participants?q=${encodeURIComponent(q)}&show=${show}`,
      init,
    ),
  overview: () => request<ParticipantsOverview>("/core/participants-overview"),
  duplicates: () => request<{ groups: TwinGroup[] }>("/core/participants/duplicates"),
  proposals: () => request<{ items: BinProposal[]; book: boolean }>("/core/participants/proposals"),
  dossier: (id: string) => request<Dossier>(`/core/participants/${id}`),
  setBin: (id: string, bin: string, source: AliasSource = "manual") =>
    request<{ id: string; bin: string; kind: ParticipantKind }>(`/core/participants/${id}/bin`, {
      method: "PUT",
      body: JSON.stringify({ bin, source }),
    }),
  rejectBin: (id: string, bin: string) =>
    request<{ ok: boolean }>(`/core/participants/${id}/bin/reject`, { method: "POST", body: JSON.stringify({ bin }) }),
  update: (id: string, body: { full_name?: string }) =>
    request<{ id: string; full_name: string }>(`/core/participants/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  addAlias: (id: string, name: string, source: AliasSource = "manual") =>
    request<{ aliases: ParticipantAlias[] }>(`/core/participants/${id}/aliases`, {
      method: "POST",
      body: JSON.stringify({ name, source }),
    }),
  removeAlias: (id: string, aliasId: string) =>
    request<{ aliases: ParticipantAlias[] }>(`/core/participants/${id}/aliases/${aliasId}`, { method: "DELETE" }),
  merge: (keep: string, drop: string) =>
    request<{ keep: string; moved: Record<string, number>; point: string; title: string }>("/core/participants/merge", {
      method: "POST",
      body: JSON.stringify({ keep, drop }),
    }),
  distinct: (ids: string[]) =>
    request<{ ok: boolean }>("/core/participants/distinct", { method: "POST", body: JSON.stringify({ ids }) }),
  harvestPreview: () => request<HarvestResult>("/core/participants-harvest"),
  harvestApply: () => request<HarvestResult>("/core/participants-harvest", { method: "POST" }),
  addTaxPeriod: (entityId: string, body: { valid_from: string; regime: TaxPeriod["regime"]; vat_payer: boolean; note?: string }) =>
    request<{ periods: TaxPeriod[] }>(`/core/entities/${entityId}/tax`, { method: "POST", body: JSON.stringify(body) }),
  removeTaxPeriod: (entityId: string, periodId: string) =>
    request<{ periods: TaxPeriod[] }>(`/core/entities/${entityId}/tax/${periodId}`, { method: "DELETE" }),
  taxYears: () => request<{ items: TaxYear[] }>("/core/tax-years"),
  setTaxYear: (year: number, body: { mrp: string; threshold_mrp: number; vat_rate: string; forecast?: boolean; note?: string }) =>
    request<TaxYear>(`/core/tax-years/${year}`, { method: "PUT", body: JSON.stringify(body) }),
  /** Сверки звеньев; `entity` - одно наше юрлицо, как его считает «Переход». */
  shadow: (entity?: string) => request<ShadowView>(withEntity("/core/shadow", entity)),
  shadowBills: (entity?: string) => request<BillsShadow>(withEntity("/core/shadow/bills", entity)),
  vat: (year: number) => request<VatYearView>(`/core/vat?year=${year}`),
  vatClients: (year: number, entity: string) =>
    request<{ items: VatClient[] }>(`/core/vat/clients?year=${year}&entity=${encodeURIComponent(entity)}`),
  vatPreview: (year: number, moves: VatMove[]) =>
    request<VatPreview>("/core/vat/preview", { method: "POST", body: JSON.stringify({ year, moves }) }),
  vatTransfer: (year: number, moves: VatMove[]) =>
    request<{ done: number; skipped: string[]; point: { id: string; title: string; kind: string } | null }>(
      "/core/vat/transfer",
      { method: "POST", body: JSON.stringify({ year, moves }) },
    ),
  apply: (body: { contract_id: string; kind: ShadowProposalKind; value: Record<string, unknown>; option?: string }) =>
    request<{ ok: boolean; text: string }>("/core/shadow/apply", { method: "POST", body: JSON.stringify(body) }),
  applyAll: (kind: "billing" | "period_day" | "billing_from") =>
    request<{ done: number; skipped: string[]; point: { id: string; title: string; kind: string } | null }>(
      "/core/shadow/apply-all",
      { method: "POST", body: JSON.stringify({ kind }) },
    ),
  createFromBook: (key: string) =>
    request<{ id: string; number: string }>("/core/shadow/create", { method: "POST", body: JSON.stringify({ key }) }),
  verify: (contractId: string, month: string) =>
    request<{ ok: boolean; id: string; text: string }>("/core/shadow/verify", {
      method: "POST",
      body: JSON.stringify({ contract_id: contractId, month }),
    }),
  /** «Верно у KORT» вместо предложения: его расходящиеся месяцы без решения. */
  verifyProposal: (contractId: string, months: string[]) =>
    request<{ ok: boolean; text: string; batch: string; done: number }>("/core/shadow/verify-proposal", {
      method: "POST",
      body: JSON.stringify({ contract_id: contractId, months }),
    }),
  unverify: (documentId: string) =>
    request<{ ok: boolean; text: string }>(`/core/shadow/verify/${documentId}`, { method: "DELETE" }),
  /** «Верно у KORT» разом - месяцы, где таблица ошиблась в периоде; `entity` - как у сверки. */
  verifySlips: (entity?: string) =>
    request<{ done: number; contracts: number; batch: string | null; skipped: string[] }>("/core/shadow/verify-slips", {
      method: "POST",
      body: JSON.stringify({ entity: entity || null }),
    }),
  unverifyBatch: (batch: string) =>
    request<{ done: number; skipped: string[] }>(`/core/shadow/verify-batch/${batch}`, { method: "DELETE" }),
  months: (contractId: string) => request<ContractMonths>(`/core/contracts/${contractId}/months`),
  setAdjustment: (contractId: string, body: { month: string; amount?: string | null; skip?: boolean; reason: string }) =>
    request<{ id: string }>(`/core/contracts/${contractId}/adjustments`, { method: "POST", body: JSON.stringify(body) }),
  removeAdjustment: (contractId: string, documentId: string) =>
    request<{ ok: boolean }>(`/core/contracts/${contractId}/adjustments/${documentId}`, { method: "DELETE" }),
  statusFrom: (contractId: string, body: { status_id: string; effective_from: string; summary?: string }) =>
    request<{ id: string }>(`/core/contracts/${contractId}/status-from`, { method: "POST", body: JSON.stringify(body) }),
  payments: (entity?: string) => request<PaymentsView>(withEntity("/core/payments", entity)),
  acts: (entity?: string) => request<ActsView>(withEntity("/core/acts", entity)),
  paymentSettings: (body: { since?: string | null; entity_id?: string; source?: "journal" | "1c" }) =>
    request<PaymentsView["settings"]>("/core/payments/settings", { method: "PUT", body: JSON.stringify(body) }),
  paymentsOpening: () =>
    request<{ done: number; documents: number; point: { id: string; title: string; kind: string } | null }>(
      "/core/payments/opening",
      { method: "POST" },
    ),
  paymentIgnore: (kind: "categories" | "payers", name: string, on: boolean) =>
    request<PaymentsView["settings"]>("/core/payments/ignore", { method: "PUT", body: JSON.stringify({ kind, name, on }) }),
  paymentDecide: (operationId: string, body: { action: "link" | "none" | "auto"; contract_id?: string }) =>
    request<{ operation_id: string; action: string; contract_id: string | null }>(`/core/payments/${operationId}/decide`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  paymentSplit: (operationId: string, parts: { contract_id: string; amount: string }[]) =>
    request<{ operation_id: string; parts: { contract_id: string; amount: string }[] }>(`/core/payments/${operationId}/split`, {
      method: "POST",
      body: JSON.stringify({ parts }),
    }),
  setOpening: (contractId: string, amount: string | null, basis: DebtBasis = "accruals") =>
    request<{ ok: boolean }>(`/core/contracts/${contractId}/opening`, { method: "PUT", body: JSON.stringify({ amount, basis }) }),
  /** `view` - вид «Долги» (`core/views.py`): долги только договоров под его отбором. */
  debts: (params: { as_of?: string; group: DebtGroup; basis: DebtBasis; side: DebtDirection; view?: string }, init?: RequestInit) => {
    const query = new URLSearchParams({ group: params.group, basis: params.basis, side: params.side });
    if (params.as_of) query.set("as_of", params.as_of);
    if (params.view) query.set("view", params.view);
    return request<DebtsView>(`/core/debts?${query.toString()}`, init);
  },
  debtsShadow: (basis: DebtBasis, entity?: string) => request<SaldoShadow>(withEntity(`/core/debts/shadow?basis=${basis}`, entity)),
  revenue: (params: { year: number; group: RevenueGroup; side: RevenueView["side"] }, init?: RequestInit) =>
    request<RevenueView>(`/core/revenue?year=${params.year}&group=${params.group}&side=${params.side}`, init),
  today: (key: TodayCardKey, init?: RequestInit) => request<TodayCard>(`/core/today/${key}`, init),
  /** Разделы колонки, где у компании нет ни одной строки (`core/usage.py`). */
  usage: () => request<{ empty: string[] }>("/core/usage"),
  group: (year: number) => request<GroupView>(`/core/group?year=${year}`),
  /** Слова компании в колонках «Счет» и «Вид Услуги» (фаза 9, R12-R13). */
  tableWords: () => request<TableWordsView>("/core/table-words"),
  setTableWord: (part: TableWordPart, word: string, meaning: string) =>
    request<TableWordsView>("/core/table-words", { method: "PUT", body: JSON.stringify({ part, word, meaning }) }),
  /** «Первые шаги» (фаза 9): план по сводной таблице и шаги записи. */
  start: () => request<StartPlan>("/core/start"),
  startStep: (step: StartStep, since?: string) =>
    request<StartDone>(`/core/start/${step}`, { method: "POST", body: JSON.stringify(since ? { since } : {}) }),
  /** «Переход» (фаза 10): звенья и какое звено какого юрлица уже ведётся в KORT. */
  switchSources: () => request<SwitchSources>("/core/switch"),
  /** Одно звено по нашим юрлицам - своим запросом: сверка читает всю таблицу. */
  switchLink: (link: SwitchLinkKey, init?: RequestInit) => request<SwitchTally>(`/core/switch/${link}`, init),
  /** Что станет после перехода: «Счета → Не выставлены» юрлица или «Оплачено» его договоров. */
  switchPreview: (entityId: string, source: SwitchSource) =>
    request<SwitchPreview>(`/core/switch/bills/${entityId}/preview?source=${source}`),
  switchPaymentsPreview: (entityId: string, source: SwitchSource) =>
    request<SwitchPaymentsPreview>(`/core/switch/payments/${entityId}/preview?source=${source}`),
  setSwitch: (link: SwitchLinkKey, entityId: string, source: SwitchSource) =>
    request<{ sources: SwitchSources["sources"] }>(`/core/switch/${link}/${entityId}`, {
      method: "PUT",
      body: JSON.stringify({ source }),
    }),
  /** Словарь колонок сводной таблицы (фаза 9): шапка и как нашлась каждая колонка ядра. */
  bookColumns: () => request<BookColumnsView>("/core/book/columns"),
  setBookColumn: (key: string, name: string, on: boolean) =>
    request<BookColumnsView>("/core/book/columns", { method: "PUT", body: JSON.stringify({ key, name, on }) }),
  /** Досье нашего ТОО «в цифрах»: НДС и оборот за год, кто ему должен (`core/group_map.py`). */
  entityNumbers: (entityId: string) =>
    request<{
      year: number;
      vat: {
        status: VatStatus;
        payer_from: string | null;
        fact: string;
        forecast: string;
        vat: string;
        vat_fact: string;
        remaining: string | null;
        crossing: string | null;
      } | null;
      debts: { owed: string; d90plus: string; advance: string; contracts: number };
    }>(`/core/entities/${entityId}/numbers`),
  searchContracts: (q: string, init?: RequestInit) =>
    request<{
      items: { id: string; number: string; customer: string; executor: string; status: string; by: "number" | "client" }[];
    }>(`/core/search/contracts?q=${encodeURIComponent(q)}`, init),
};

/**
 * Привычки учётки (`app/finance/habits.py`): какой вид раздела у человека по
 * умолчанию. `keepalive` - отчёт при закрытии вкладки долетает и после неё.
 */
export const habitsApi = {
  prefer: () => request<{ prefer: Record<string, string> }>("/looks/habits/prefer"),
  report: (group: string, body: { mode: string; minutes?: number; pick?: boolean }, keepalive = false) =>
    request<{ prefer: Record<string, string> }>(`/looks/habits/${encodeURIComponent(group)}`, {
      method: "POST",
      body: JSON.stringify(body),
      keepalive,
    }),
};