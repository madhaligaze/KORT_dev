"use client";

/**
 * «Участники» - стороны договоров одним списком (ядро, фаза 1).
 *
 * Участник - это БИН, имя - одно из написаний: поиск находит клиента по
 * любому - как его пишут реестр, банк и 1С, - и по началу БИН. Плитки - что
 * требует рук: участники без БИН (вверху - номера, которые нашлись в 1С и в
 * строках банка) и двойники - один клиент, заведённый дважды. Досье - карточкой
 * по центру (`participant-card.tsx`); договор из досье - карточкой договора, и
 * её закрытие возвращает к досье: оба живут в адресе (`p`, `id`), «Назад»
 * проходит тот же путь.
 */
import { useCallback, useEffect, useState } from "react";

import {
  type BinProposal,
  type HarvestResult,
  type Me,
  type ParticipantHit,
  type ParticipantsOverview,
  type ParticipantsShow,
  type TwinGroup,
  contractsApi,
  coreApi,
} from "@/components/finance/api";
import { readParam, writeParams } from "@/components/finance/address";
import { ContractCard } from "@/components/finance/contracts/contract-card";
import { useRegistryBoot } from "@/components/finance/contracts/registry-cards";
import { PARTICIPANT_EVENT } from "@/components/finance/core/open";
import { type CoreAccess, type MergeDone, ParticipantCard, sourceOf } from "@/components/finance/core/participant-card";
import { binWord, contractsWord, regimeText } from "@/components/finance/core/words";
import { SearchIcon } from "@/components/icons";
import { useSessionState } from "@/components/session-state";

type View = ParticipantsShow | "twins";

const TILES: { key: View; title: string }[] = [
  { key: "all", title: "Все" },
  { key: "own", title: "Наши юрлица" },
  { key: "no_bin", title: "Без БИН" },
  { key: "twins", title: "Двойники" },
];

const NOBODY: CoreAccess = { edit: false, setup: false };

function messageOf(exc: unknown, fallback: string): string {
  return exc instanceof Error && exc.message ? exc.message : fallback;
}

function aborted(exc: unknown): boolean {
  return exc instanceof DOMException && exc.name === "AbortError";
}

export function ParticipantsScreen({ me }: { me: Me }) {
  // Договор из досье открывается карточкой договора - ей нужен реестр.
  useRegistryBoot(me);
  const [view, setView] = useSessionState<View>("core.parties.view", "all");
  const [query, setQuery] = useSessionState("core.parties.q", "");
  const text = query.trim();
  const [revision, setRevision] = useState(0);
  const changed = useCallback(() => setRevision((value) => value + 1), []);
  const [overview, setOverview] = useState<ParticipantsOverview | null>(null);
  const [error, setError] = useState("");
  const access = overview?.access ?? NOBODY;

  const [partyId, setPartyId] = useState<string | null>(() => readParam("p"));
  const [contractId, setContractId] = useState<string | null>(() => readParam("id"));
  const openParty = useCallback((id: string | null) => {
    setPartyId(id);
    setContractId(null);
    writeParams({ p: id, id: null }, id !== null);
  }, []);
  const openContract = useCallback((id: string | null) => {
    setContractId(id);
    writeParams({ id }, id !== null);
  }, []);
  useEffect(() => {
    const onPop = () => {
      setPartyId(readParam("p"));
      setContractId(readParam("id"));
    };
    // Сторона в карточке договора, открытой отсюда же: адрес пишет рама.
    const onParty = (event: Event) => {
      setPartyId((event as CustomEvent<string>).detail);
      setContractId(null);
    };
    window.addEventListener("popstate", onPop);
    window.addEventListener(PARTICIPANT_EVENT, onParty);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener(PARTICIPANT_EVENT, onParty);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    coreApi
      .overview()
      .then((next) => {
        if (!alive) return;
        setOverview(next);
        setError("");
      })
      .catch((exc) => {
        if (alive) setError(messageOf(exc, "Участники не прочитались"));
      });
    return () => {
      alive = false;
    };
  }, [revision]);

  // Поиск идёт по всем участникам и из «Двойников»: набранное имя ищут, а не двойника.
  const listShow: ParticipantsShow = view === "twins" ? "all" : view;
  const showsList = view !== "twins" || Boolean(text);
  const listKey = `${listShow}|${text}|${revision}`;
  const [list, setList] = useState<{ key: string; items: ParticipantHit[]; total: number; error: string } | null>(null);
  useEffect(() => {
    if (!showsList) return;
    const controller = new AbortController();
    const timer = window.setTimeout(
      () => {
        coreApi
          .list(text, listShow, { signal: controller.signal })
          .then((result) => setList({ key: listKey, items: result.items, total: result.total, error: "" }))
          .catch((exc) => {
            if (!aborted(exc)) setList({ key: listKey, items: [], total: 0, error: messageOf(exc, "Список не прочитался") });
          });
      },
      text ? 220 : 0,
    );
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [listKey, showsList, text, listShow]);

  const [twins, setTwins] = useState<{ revision: number; groups: TwinGroup[] } | null>(null);
  useEffect(() => {
    if (view !== "twins") return;
    let alive = true;
    coreApi
      .duplicates()
      .then((result) => alive && setTwins({ revision, groups: result.groups }))
      .catch((exc) => alive && setError(messageOf(exc, "Двойники не прочитались")));
    return () => {
      alive = false;
    };
  }, [view, revision]);

  const [proposals, setProposals] = useState<{ items: BinProposal[]; book: boolean } | null>(null);
  useEffect(() => {
    if (view !== "no_bin") return;
    let alive = true;
    let timer = 0;
    const load = (left: number) =>
      coreApi
        .proposals()
        .then((result) => {
          if (!alive) return;
          setProposals(result);
          // Сводку только начали читать (первое чтение после запуска сервера) -
          // номера из строк банка придут, когда она прочтётся.
          if (!result.book && left > 0) timer = window.setTimeout(() => void load(left - 1), 8000);
        })
        .catch(() => undefined);
    void load(2);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [view, revision]);

  const [merged, setMerged] = useState<MergeDone[]>([]);
  const onMerged = useCallback(
    (done: MergeDone) => {
      setMerged((items) => [done, ...items]);
      changed();
    },
    [changed],
  );

  // Пока читается новый список, стоит прежний (тише): поиск не мигает пустотой на каждой букве.
  const shown = showsList ? list : null;
  return (
    <div className="party-screen">
      <div className="party-bar">
        <label className="creg-search party-search">
          <span className="creg-search-ico">
            <SearchIcon size={15} />
          </span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Имя, любое написание или БИН"
            aria-label="Найти участника"
          />
        </label>
        {access.setup ? <Harvest onDone={changed} /> : null}
      </div>

      <div className="fin-kpis party-kpis">
        {TILES.map((tile) => (
          <button
            key={tile.key}
            type="button"
            className="fin-kpi fin-kpi-pick"
            data-on={view === tile.key ? "" : undefined}
            onClick={() => setView(tile.key)}
          >
            <span className="fin-kpi-label">{tile.title}</span>
            <span className="fin-kpi-value">{overview ? overview[tile.key] : "-"}</span>
            {tile.key === "no_bin" && overview?.proposals ? (
              <span className="fin-kpi-label">нашлись в источниках: {overview.proposals}</span>
            ) : null}
          </button>
        ))}
      </div>

      {error ? <p className="party-error">{error}</p> : null}

      <MergedLines items={merged} onUndone={(done) => {
        setMerged((items) => items.filter((item) => item !== done));
        changed();
      }} />

      {view === "no_bin" && !text && proposals?.items.length ? (
        <Proposals items={proposals.items} canEdit={access.edit} onOpen={openParty} onChanged={changed} />
      ) : null}

      {showsList ? (
        <PartyList
          items={shown?.items ?? null}
          total={shown?.total ?? 0}
          error={shown?.error ?? ""}
          busy={!shown || shown.key !== listKey}
          searching={Boolean(text)}
          onOpen={openParty}
        />
      ) : (
        <Twins
          groups={twins?.groups ?? null}
          access={access}
          onOpen={openParty}
          onChanged={changed}
          onMerged={onMerged}
        />
      )}

      <ParticipantCard
        id={partyId}
        open={Boolean(partyId) && !contractId}
        access={access}
        onClose={() => openParty(null)}
        onOpen={openParty}
        onOpenContract={openContract}
        onChanged={changed}
        onMerged={onMerged}
      />
      <ContractCard
        id={contractId}
        open={Boolean(contractId)}
        book=""
        onClose={() => openContract(null)}
        onCreated={(id) => openContract(id)}
      />
    </div>
  );
}

function PartyList({
  items,
  total,
  error,
  busy,
  searching,
  onOpen,
}: {
  items: ParticipantHit[] | null;
  total: number;
  error: string;
  busy: boolean;
  searching: boolean;
  onOpen: (id: string) => void;
}) {
  if (error) return <p className="party-error">{error}</p>;
  if (!items) return <p className="creg-empty">Читаем участников…</p>;
  if (!items.length) return <p className="creg-empty">{busy ? "Ищем…" : searching ? "Никого не нашлось" : "Здесь пусто"}</p>;
  return (
    <>
      <ul className="party-list" aria-busy={busy || undefined}>
        {items.map((item) => (
          <li key={item.id}>
            <button type="button" className="party-row" onClick={() => onOpen(item.id)}>
              <span className="party-main">
                <span className="party-name">
                  {item.name}
                  {item.own && item.own !== item.name ? <span className="annot">{item.own}</span> : null}
                </span>
                {item.full_name && item.full_name !== item.name ? <span className="party-sub">{item.full_name}</span> : null}
                {item.own !== null ? (
                  <span className="party-sub" data-empty={item.regime ? undefined : "true"}>
                    {regimeText(item.regime)}
                  </span>
                ) : null}
              </span>
              <span className="party-bin">
                {item.bin ? (
                  <>
                    <small>{binWord(item.kind)}</small> {item.bin}
                  </>
                ) : (
                  <span className="fin-muted">-</span>
                )}
              </span>
              <span className="party-count">{item.contracts ? contractsWord(item.contracts) : "-"}</span>
            </button>
          </li>
        ))}
      </ul>
      {total > items.length ? (
        <p className="party-more">
          ещё {total - items.length} - {searching ? "уточните поиск" : "найдутся поиском"}
        </p>
      ) : null}
    </>
  );
}

/**
 * Номера из источников - для участников без БИН. Записать - одним щелчком;
 * «Не тот» запоминается, и номер больше не предлагается. Номер, уже записанный
 * у другого участника, не записывается: это двойник, его сводят.
 */
function Proposals({
  items,
  canEdit,
  onOpen,
  onChanged,
}: {
  items: BinProposal[];
  canEdit: boolean;
  onOpen: (id: string) => void;
  onChanged: () => void;
}) {
  return (
    <section className="party-proposals">
      <div className="card-section">
        <span>
          БИН нашёлся в источниках
          <span className="fin-muted" style={{ fontWeight: 400 }}>
            {" "}
            {items.length}
          </span>
        </span>
        <span className="card-section-line" />
      </div>
      {items.map((item) => (
        <ProposalRow key={item.party_id} item={item} canEdit={canEdit} onOpen={onOpen} onChanged={onChanged} />
      ))}
    </section>
  );
}

function ProposalRow({
  item,
  canEdit,
  onOpen,
  onChanged,
}: {
  item: BinProposal;
  canEdit: boolean;
  onOpen: (id: string) => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const act = async (bin: string, write: boolean, evidence: string[]) => {
    setBusy(bin);
    setError("");
    try {
      if (write) await coreApi.setBin(item.party_id, bin, sourceOf(evidence));
      else await coreApi.rejectBin(item.party_id, bin);
      onChanged();
    } catch (exc) {
      setError(messageOf(exc, "Не записалось"));
    } finally {
      setBusy("");
    }
  };
  return (
    <div className="party-proposal">
      <button type="button" className="fin-link-btn party-proposal-name" onClick={() => onOpen(item.party_id)}>
        {item.name}
      </button>
      {item.numbers.map((number) => (
        <div key={number.bin} className="party-proposal-number">
          <span className="party-bin">
            <small>{binWord(number.kind)}</small> {number.bin}
          </span>
          <span className="party-evidence">
            {number.evidence.join("; ")}
            {number.taken_by ? <span className="fin-fail"> - уже у «{number.taken_by.name}»</span> : null}
          </span>
          {canEdit ? (
            <span className="party-row-acts">
              {number.taken_by ? null : (
                <>
                  <button
                    type="button"
                    className="fin-link-btn"
                    disabled={!!busy}
                    onClick={() => act(number.bin, true, number.evidence)}
                  >
                    Записать
                  </button>
                  {" · "}
                </>
              )}
              <button
                type="button"
                className="fin-link-btn"
                disabled={!!busy}
                onClick={() => act(number.bin, false, number.evidence)}
              >
                Не тот
              </button>
            </span>
          ) : null}
        </div>
      ))}
      {error ? <p className="ifield-error">{error}</p> : null}
    </div>
  );
}

/**
 * Двойники: один участник, заведённый дважды. Остаётся тот, у кого БИН, кто
 * наше юрлицо или у кого больше договоров, - выбор можно сменить. Сводит
 * владелец или администратор: договоры, операции, счета и написания второго
 * переходят к оставшемуся, а «Вернуть» (и «Восстановление» в кабинете)
 * разносит всё обратно.
 */
function Twins({
  groups,
  access,
  onOpen,
  onChanged,
  onMerged,
}: {
  groups: TwinGroup[] | null;
  access: CoreAccess;
  onOpen: (id: string) => void;
  onChanged: () => void;
  onMerged: (done: MergeDone) => void;
}) {
  if (!groups) return <p className="creg-empty">Ищем двойников…</p>;
  if (!groups.length) return <p className="creg-empty">Двойников нет</p>;
  return (
    <div className="party-twins">
      {groups.map((group) => (
        <TwinCard key={group.key} group={group} access={access} onOpen={onOpen} onChanged={onChanged} onMerged={onMerged} />
      ))}
    </div>
  );
}

function TwinCard({
  group,
  access,
  onOpen,
  onChanged,
  onMerged,
}: {
  group: TwinGroup;
  access: CoreAccess;
  onOpen: (id: string) => void;
  onChanged: () => void;
  onMerged: (done: MergeDone) => void;
}) {
  const [keep, setKeep] = useState(group.keep);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const kept = group.members.find((member) => member.id === keep) ?? group.members[0];
  const others = group.members.filter((member) => member.id !== kept.id);
  const merge = async () => {
    setBusy(true);
    setError("");
    const points: string[] = [];
    const titles: string[] = [];
    try {
      for (const other of others) {
        const result = await coreApi.merge(kept.id, other.id);
        points.push(result.point);
        titles.push(result.title);
      }
    } catch (exc) {
      setError(messageOf(exc, "Не свелось"));
    } finally {
      setBusy(false);
      if (points.length) onMerged({ text: titles.join("; "), points });
    }
  };
  const distinct = async () => {
    setBusy(true);
    setError("");
    try {
      await coreApi.distinct(group.members.map((member) => member.id));
      onChanged();
    } catch (exc) {
      setError(messageOf(exc, "Отметка не записалась"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="party-twin">
      <p className="party-twin-why">{group.why.join(", ")}</p>
      {group.members.map((member) => (
        <div key={member.id} className="party-twin-row" data-keep={member.id === kept.id ? "true" : undefined}>
          <button type="button" className="fin-link-btn party-twin-name" onClick={() => onOpen(member.id)}>
            {member.name}
          </button>
          <span className="party-bin">{member.bin || <span className="fin-muted">-</span>}</span>
          <span className="party-count">
            {member.contracts ? contractsWord(member.contracts) : "без договоров"}
            {member.own ? <span className="annot"> наше юрлицо</span> : null}
          </span>
          <button
            type="button"
            className="party-keep"
            aria-pressed={member.id === kept.id}
            disabled={busy}
            onClick={() => setKeep(member.id)}
          >
            {member.id === kept.id ? "остаётся" : "оставить это"}
          </button>
        </div>
      ))}
      <div className="party-twin-acts">
        <button
          type="button"
          className="btn-ghost btn-sm"
          disabled={!access.setup || busy}
          title={access.setup ? undefined : "Сводит владелец или администратор"}
          onClick={merge}
        >
          {busy ? "Сводим…" : `Свести в «${kept.name}»`}
        </button>
        <button type="button" className="btn-ghost btn-sm" disabled={!access.edit || busy} onClick={distinct}>
          Это разные
        </button>
      </div>
      {error ? <p className="ifield-error">{error}</p> : null}
    </section>
  );
}

/**
 * Что сведено за этот заход - со словом «Вернуть»: точка восстановления
 * разносит договоры и написания обратно (то же, что «Восстановление» в
 * кабинете).
 */
function MergedLines({ items, onUndone }: { items: MergeDone[]; onUndone: (done: MergeDone) => void }) {
  const [busy, setBusy] = useState<MergeDone | null>(null);
  const [error, setError] = useState("");
  if (!items.length) return null;
  const undo = async (done: MergeDone) => {
    setBusy(done);
    setError("");
    try {
      for (const point of [...done.points].reverse()) await contractsApi.restorePoints.restore(point);
      onUndone(done);
    } catch (exc) {
      setError(messageOf(exc, "Не вернулось"));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="party-done" role="status">
      {items.map((done) => (
        <p key={done.points.join("-")}>
          {done.text}
          {" · "}
          <button type="button" className="fin-link-btn" disabled={busy === done} onClick={() => undo(done)}>
            Вернуть
          </button>
        </p>
      ))}
      {error ? <p className="ifield-error">{error}</p> : null}
    </div>
  );
}

/**
 * «Собрать из сводки» - написания клиентов («Заказчик», «По Выписке Банка»,
 * «По 1C») и коды наших юрлиц («Наша Фирма») из книги-сводки. Сначала - что
 * запишется, числами; записывается только однозначное: строка нашла договор
 * по номеру и клиенту, код - у одного юрлица.
 */
function Harvest({ onDone }: { onDone: () => void }) {
  const [state, setState] = useState<"idle" | "reading" | "ready" | "writing" | "done">("idle");
  const [result, setResult] = useState<HarvestResult | null>(null);
  const [error, setError] = useState("");
  const preview = async () => {
    setState("reading");
    setError("");
    try {
      setResult(await coreApi.harvestPreview());
      setState("ready");
    } catch (exc) {
      setError(messageOf(exc, "Сводка не прочиталась"));
      setState("idle");
    }
  };
  const apply = async () => {
    setState("writing");
    setError("");
    try {
      setResult(await coreApi.harvestApply());
      setState("done");
      onDone();
    } catch (exc) {
      setError(messageOf(exc, "Не записалось"));
      setState("ready");
    }
  };
  const close = () => {
    setState("idle");
    setResult(null);
    setError("");
  };
  const aliases = result ? Object.values(result.aliases).reduce((sum, value) => sum + (value ?? 0), 0) : 0;
  const nothing = Boolean(result) && !aliases && !result?.codes.length;
  return (
    <>
      <button
        type="button"
        className="btn-ghost btn-sm"
        disabled={state === "reading" || state === "writing"}
        onClick={state === "idle" ? preview : close}
      >
        {state === "reading" ? "Читаем сводку…" : state === "idle" ? "Собрать из сводки" : "Закрыть сбор"}
      </button>
      {error && state === "idle" ? <p className="party-error party-bar-error">{error}</p> : null}
      {result && state !== "idle" ? (
        <section className="fin-card party-harvest" aria-label="Сбор из сводки">
          <dl className="fin-bill-facts">
            <dt>Строки сводки</dt>
            <dd>
              {result.rows}, нашли договор - {result.matched}
            </dd>
            <dt>{state === "done" ? "Записано написаний" : "Написания клиентов"}</dt>
            <dd>
              {aliases
                ? (["bank", "1c", "registry"] as const)
                    .filter((key) => result.aliases[key])
                    .map((key) => `${{ bank: "банк", "1c": "1С", registry: "реестр" }[key]} - ${result.aliases[key]}`)
                    .join(", ")
                : "нового нет"}
            </dd>
            <dt>{state === "done" ? "Записано кодов" : "Коды юрлиц"}</dt>
            <dd>
              {result.codes.length
                ? result.codes.map((item) => (item.code === item.name ? item.code : `${item.code} → ${item.name}`)).join("; ")
                : "нового нет"}
            </dd>
            {result.conflicts.length ? (
              <>
                <dt>Код у нескольких юрлиц</dt>
                <dd className="fin-fail">
                  {result.conflicts
                    .map((item) => `${item.code}: ${item.entities.map((entity) => `${entity.name} (${entity.rows})`).join(", ")}`)
                    .join("; ")}
                </dd>
              </>
            ) : null}
          </dl>
          {error ? <p className="ifield-error">{error}</p> : null}
          <div className="party-harvest-acts">
            {state === "done" ? (
              <button type="button" className="btn-ghost btn-sm" onClick={close}>
                Готово
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="btn-primary btn-sm"
                  disabled={nothing || state === "writing"}
                  onClick={apply}
                >
                  {state === "writing" ? "Записываем…" : "Записать"}
                </button>
                <button type="button" className="btn-ghost btn-sm" onClick={close}>
                  Отмена
                </button>
              </>
            )}
          </div>
        </section>
      ) : null}
    </>
  );
}
