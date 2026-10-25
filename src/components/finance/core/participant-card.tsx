"use client";

/**
 * Досье участника - карточка по центру, как карточка договора (ядро, фаза 1).
 *
 * Участник - это БИН, имя - одно из написаний. Под именем - БИН и полное
 * наименование, оба правятся по клику. Замечания - то, что мешает узнавать
 * участника: нет БИН (и номер, который нашёлся в 1С или в строке банка), он
 * похож на другого. Договоры - у всех наших юрлиц сразу, по второй стороне:
 * клиента, которого переводили между ТОО, видно целиком. У нашего юрлица -
 * режим по датам, от которого считаются НДС и оборот к порогу, его счета и
 * базы 1С.
 */
import { useEffect, useRef, useState } from "react";

import { ChoiceSelect } from "@/components/choice-select";
import {
  type AliasSource,
  type Dossier,
  type DossierContract,
  type DossierGroup,
  type TaxPeriod,
  type TwinGroup,
  coreApi,
} from "@/components/finance/api";
import { Section } from "@/components/finance/contracts/section";
import { openSection } from "@/components/finance/core/open";
import { REGIMES, binWord, kindWord } from "@/components/finance/core/words";
import { bareNumber, contractMoney, formatDay, parseDay, plural } from "@/components/finance/format";
import { CardLayer } from "@/components/finance/ui/card-layer";
import { DateInput } from "@/components/finance/ui/date-picker";
import { MenuPopover } from "@/components/finance/ui/menu-popover";
import { CloseIcon } from "@/components/icons";

export type CoreAccess = { edit: boolean; setup: boolean };

/** Что сведено из досье или списка: «Вернуть» снимает это точкой восстановления. */
export type MergeDone = { text: string; points: string[] };

type Props = {
  id: string | null;
  open: boolean;
  access: CoreAccess;
  onClose: () => void;
  /** Другой участник: вторая сторона договоров, двойник, тот, в кого свели. */
  onOpen: (id: string) => void;
  onOpenContract: (id: string) => void;
  /** Записали - список и плитки перечитываются. */
  onChanged: () => void;
  onMerged: (done: MergeDone) => void;
};

/**
 * Прочитанные досье. Досье уходит с экрана, пока открыт договор из него, - и
 * вернувшись, стоит сразу, а не «Читаем досье…», пока идёт свежее чтение.
 */
const read = new Map<string, Dossier>();

function messageOf(exc: unknown, fallback: string): string {
  return exc instanceof Error && exc.message ? exc.message : fallback;
}

function localToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function ParticipantCard({ id, open, access, onClose, onOpen, onOpenContract, onChanged, onMerged }: Props) {
  const [loaded, setLoaded] = useState<{ id: string; value: Dossier } | null>(null);
  const [failed, setFailed] = useState<{ id: string; text: string } | null>(null);
  const [revision, setRevision] = useState(0);
  // По ссылке, а не зависимостью: раздел передаёт новые стрелки на каждой перерисовке.
  const openRef = useRef(onOpen);
  useEffect(() => {
    openRef.current = onOpen;
  });
  useEffect(() => {
    if (!open || !id) return;
    let alive = true;
    coreApi
      .dossier(id)
      .then((value) => {
        if (!alive) return;
        // Старая ссылка на сведённого участника - досье того, в кого свели.
        if (value.merged_into) {
          openRef.current(value.merged_into);
          return;
        }
        read.set(id, value);
        setLoaded({ id, value });
        setFailed(null);
      })
      .catch((exc) => {
        if (alive) setFailed({ id, text: messageOf(exc, "Досье не прочиталось") });
      });
    return () => {
      alive = false;
    };
  }, [open, id, revision]);
  const dossier = id ? (loaded?.id === id ? loaded.value : (read.get(id) ?? null)) : null;
  const error = failed?.id === id ? failed.text : "";
  const changed = () => {
    setRevision((value) => value + 1);
    onChanged();
  };

  return (
    <CardLayer open={open} onClose={onClose} label={dossier ? `Участник ${dossier.name}` : "Участник"}>
      <div className="card-top">
        <span className="card-top-num">
          {dossier ? `${binWord(dossier.kind)} ${dossier.bin || "не указан"}` : "Участник"}
        </span>
        <span className="card-top-state">
          {dossier?.own ? ["наше юрлицо", dossier.own.code].filter(Boolean).join(" · ") : ""}
        </span>
        <MenuPopover
          items={[
            {
              label: "Скопировать ссылку",
              hidden: !dossier,
              onSelect: () => {
                if (!dossier) return;
                const url = new URL(window.location.href);
                url.searchParams.set("s", "participants");
                url.searchParams.set("p", dossier.id);
                url.searchParams.delete("id");
                void navigator.clipboard?.writeText(url.toString());
              },
            },
          ]}
        />
        <button type="button" className="fin-icon-btn" aria-label="Закрыть" onClick={onClose}>
          <CloseIcon size={16} />
        </button>
      </div>

      <div className="card-body" key={id ?? "none"}>
        {!dossier ? (
          <h2 className="card-title" tabIndex={-1} data-empty="true">
            {error || "Читаем досье…"}
          </h2>
        ) : (
          <>
            <h2 className="card-title" tabIndex={-1}>
              {dossier.name}
            </h2>
            {dossier.full_name && dossier.full_name !== dossier.name ? (
              <p className="party-card-full">{dossier.full_name}</p>
            ) : null}
            {error ? <p className="ifield-error">{error}</p> : null}
            <Issues
              dossier={dossier}
              access={access}
              onOpen={onOpen}
              onChanged={changed}
              onMerged={(done) => {
                onMerged(done);
                changed();
              }}
            />
            <div className="card-grid">
              <PlainField
                label="БИН / ИИН"
                note={kindWord(dossier.kind)}
                value={dossier.bin}
                mono
                numeric
                canEdit={access.edit}
                onSave={async (next) => {
                  await coreApi.setBin(dossier.id, next);
                  changed();
                }}
              />
              <PlainField
                label="Полное наименование"
                value={dossier.full_name}
                canEdit={access.edit}
                onSave={async (next) => {
                  await coreApi.update(dossier.id, { full_name: next });
                  changed();
                }}
              />
            </div>
            {/* У нашего ТОО главное - его НДС и кто ему должен: сразу под реквизитами, а не под сотней договоров. */}
            {dossier.own && access.setup ? <OwnNumbers entityId={dossier.id} /> : null}
            <Aliases dossier={dossier} canEdit={access.edit} onChanged={changed} />
            <Contracts dossier={dossier} onOpen={onOpen} onOpenContract={onOpenContract} />
            {dossier.own ? <Own dossier={dossier} canSetup={access.setup} onChanged={changed} /> : null}
          </>
        )}
      </div>
    </CardLayer>
  );
}

/**
 * Поле досье: читается текстом, правится по клику, Enter и уход фокуса -
 * записать, Esc - оставить как было. Отказ сервера («контрольная цифра не
 * сходится», «уже записан у …») - словами под полем, правка остаётся открытой.
 */
function PlainField({
  label,
  note,
  value,
  mono,
  numeric,
  canEdit,
  onSave,
}: {
  label: string;
  note?: string;
  value: string;
  mono?: boolean;
  numeric?: boolean;
  canEdit: boolean;
  onSave: (next: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Отказанное не отправляется второй раз уходом фокуса - только исправленное.
  const refused = useRef<string | null>(null);
  const save = async () => {
    const next = draft.trim();
    if (busy || next === refused.current) return;
    if (next === value) {
      setEditing(false);
      setError("");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onSave(next);
      refused.current = null;
      setEditing(false);
    } catch (exc) {
      refused.current = next;
      setError(messageOf(exc, "Не записалось"));
    } finally {
      setBusy(false);
    }
  };
  const valueClass = mono ? "ifield-value party-mono" : "ifield-value";
  return (
    <div className="ifield">
      <div className="ifield-label">
        <span className="eyebrow">{label}</span>
        {note ? <span className="annot">{note}</span> : null}
      </div>
      {editing ? (
        <input
          className={mono ? "ifield-input party-mono" : "ifield-input"}
          autoFocus
          value={draft}
          // Не `disabled`: отключённое поле теряет фокус, и после отказа Esc
          // уходил в карточку и закрывал её целиком, а не правку.
          readOnly={busy}
          inputMode={numeric ? "numeric" : undefined}
          aria-label={label}
          onChange={(event) => {
            setDraft(event.target.value);
            setError("");
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") void save();
            if (event.key === "Escape") {
              // Esc закрывает правку, а не всю карточку.
              event.preventDefault();
              setEditing(false);
              setDraft(value);
              setError("");
              refused.current = null;
            }
          }}
          onBlur={() => void save()}
        />
      ) : (
        <button
          type="button"
          className={valueClass}
          data-empty={value ? undefined : "true"}
          data-readonly={canEdit ? undefined : "true"}
          onClick={() => {
            if (!canEdit) return;
            setDraft(value);
            setEditing(true);
          }}
        >
          {value || "-"}
        </button>
      )}
      {error ? (
        <p className="ifield-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function Issues({
  dossier,
  access,
  onOpen,
  onChanged,
  onMerged,
}: {
  dossier: Dossier;
  access: CoreAccess;
  onOpen: (id: string) => void;
  onChanged: () => void;
  onMerged: (done: MergeDone) => void;
}) {
  if (!dossier.issues.length) return null;
  return (
    <div className="card-issues" role="list">
      {dossier.issues.map((issue) => (
        <div key={issue.group?.key ?? issue.code} className="card-issue" role="listitem">
          {issue.code === "twin" && issue.group ? (
            <TwinIssue group={issue.group} self={dossier.id} access={access} onOpen={onOpen} onChanged={onChanged} onMerged={onMerged} />
          ) : issue.code === "no_bin" ? (
            <NoBin dossier={dossier} text={issue.text} canEdit={access.edit} onChanged={onChanged} />
          ) : (
            <span>{issue.text}</span>
          )}
        </div>
      ))}
    </div>
  );
}

/** «Похож на «Х»»: открыть двойника, свести его сюда или отметить «это разные». */
function TwinIssue({
  group,
  self,
  access,
  onOpen,
  onChanged,
  onMerged,
}: {
  group: TwinGroup;
  self: string;
  access: CoreAccess;
  onOpen: (id: string) => void;
  onChanged: () => void;
  onMerged: (done: MergeDone) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const others = group.members.filter((member) => member.id !== self);
  const merge = async () => {
    setBusy(true);
    setError("");
    const done: MergeDone = { text: "", points: [] };
    const titles: string[] = [];
    try {
      for (const other of others) {
        const result = await coreApi.merge(self, other.id);
        done.points.push(result.point);
        titles.push(result.title);
      }
    } catch (exc) {
      setError(messageOf(exc, "Не свелось"));
    } finally {
      setBusy(false);
      if (done.points.length) onMerged({ ...done, text: titles.join("; ") });
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
    <>
      <span>
        Похож на{" "}
        {others.map((member, index) => (
          <span key={member.id}>
            {index ? ", " : ""}
            <button type="button" className="fin-link-btn" onClick={() => onOpen(member.id)}>
              «{member.name}»
            </button>
          </span>
        ))}
        <span className="fin-soft"> - {group.why.join(", ")}</span>
      </span>
      {access.setup ? (
        <button type="button" className="fin-link-btn" disabled={busy} onClick={merge}>
          Свести сюда
        </button>
      ) : null}
      {access.edit ? (
        <button type="button" className="fin-link-btn" disabled={busy} onClick={distinct}>
          Это разные
        </button>
      ) : null}
      {error ? <span className="party-issue-error">{error}</span> : null}
    </>
  );
}

/** «БИН не указан» - и номер, который нашёлся в 1С или в строке банка: записать или «не тот». */
function NoBin({
  dossier,
  text,
  canEdit,
  onChanged,
}: {
  dossier: Dossier;
  text: string;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const numbers = dossier.proposals.flatMap((proposal) => proposal.numbers);
  const act = async (bin: string, write: boolean, evidence: string[]) => {
    setBusy(bin);
    setError("");
    try {
      if (write) await coreApi.setBin(dossier.id, bin, sourceOf(evidence));
      else await coreApi.rejectBin(dossier.id, bin);
      onChanged();
    } catch (exc) {
      setError(messageOf(exc, "Не записалось"));
    } finally {
      setBusy("");
    }
  };
  return (
    <>
      <span>{text}</span>
      {numbers.map((number) => (
        <span key={number.bin} className="party-found">
          <span>
            нашёлся <span className="fin-mono">{number.bin}</span>
            {number.taken_by ? ` - уже у «${number.taken_by.name}»` : ""}
          </span>
          {canEdit ? (
            <span>
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
          <span className="party-evidence">{number.evidence.join("; ")}</span>
        </span>
      ))}
      {error ? <span className="party-issue-error">{error}</span> : null}
    </>
  );
}

/** Откуда номер - для журнала: «из 1С» или «из банка». */
export function sourceOf(evidence: string[]): AliasSource {
  return evidence.some((item) => item.startsWith("1С")) ? "1c" : "bank";
}

const SOURCE_ORDER: AliasSource[] = ["registry", "bank", "1c", "manual"];

/**
 * Написания - как участника пишут реестр, банк и 1С. По ним его находит поиск,
 * а сводка и выписки - его договоры.
 */
function Aliases({ dossier, canEdit, onChanged }: { dossier: Dossier; canEdit: boolean; onChanged: () => void }) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  if (!dossier.aliases.length && !canEdit) return null;
  const sorted = [...dossier.aliases].sort(
    (a, b) => SOURCE_ORDER.indexOf(a.source) - SOURCE_ORDER.indexOf(b.source) || a.name.localeCompare(b.name, "ru"),
  );
  const add = async () => {
    const name = draft.trim();
    if (!name) return;
    setBusy("add");
    setError("");
    try {
      await coreApi.addAlias(dossier.id, name);
      setDraft("");
      setAdding(false);
      onChanged();
    } catch (exc) {
      setError(messageOf(exc, "Написание не записалось"));
    } finally {
      setBusy("");
    }
  };
  const remove = async (aliasId: string) => {
    setBusy(aliasId);
    setError("");
    try {
      await coreApi.removeAlias(dossier.id, aliasId);
      onChanged();
    } catch (exc) {
      setError(messageOf(exc, "Написание не убралось"));
    } finally {
      setBusy("");
    }
  };
  return (
    <Section
      title="Написания"
      count={dossier.aliases.length}
      end={
        canEdit && !adding ? (
          <button type="button" className="fin-link-btn" onClick={() => setAdding(true)}>
            Добавить
          </button>
        ) : null
      }
    >
      {sorted.map((alias) => (
        <div key={alias.id} className="amend-row">
          <span className="amend-when">{alias.source_title}</span>
          <span className="party-alias">{alias.name}</span>
          <span>
            {canEdit ? (
              <button type="button" className="fin-link-btn" disabled={busy === alias.id} onClick={() => remove(alias.id)}>
                Убрать
              </button>
            ) : null}
          </span>
        </div>
      ))}
      {!sorted.length && !adding ? <p className="party-none">Других написаний нет</p> : null}
      {adding ? (
        <form
          className="party-form"
          onSubmit={(event) => {
            event.preventDefault();
            void add();
          }}
        >
          <input
            className="input-field"
            autoFocus
            value={draft}
            placeholder="как пишут в банке или 1С"
            aria-label="Новое написание"
            onChange={(event) => {
              setDraft(event.target.value);
              setError("");
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setAdding(false);
                setDraft("");
              }
            }}
          />
          <span className="party-form-acts">
            <button type="submit" className="btn-ghost btn-sm" disabled={!draft.trim() || busy === "add"}>
              Добавить
            </button>
            <button
              type="button"
              className="fin-link-btn"
              onClick={() => {
                setAdding(false);
                setDraft("");
                setError("");
              }}
            >
              Отмена
            </button>
          </span>
        </form>
      ) : null}
      {error ? <p className="ifield-error">{error}</p> : null}
    </Section>
  );
}

/**
 * Договоры участника. У клиента - по нашим юрлицам: клиента, которого
 * переводили между ТОО, видно целиком, и юрлиц всего несколько. У нашего
 * юрлица клиентов сотни, почти у каждого один договор - там список одной
 * лентой по дате, клиент - в строке.
 *
 * Роль («заказчик», «исполнитель») подписана только у договоров, где она не
 * такая, как в остальных: у юрлица это покупки, у клиента - то, что он сам
 * продаёт группе. В каждой строке она была бы шумом (досье BBC legal support -
 * 122 раза «исполнитель»).
 */
function Contracts({
  dossier,
  onOpen,
  onOpenContract,
}: {
  dossier: Dossier;
  onOpen: (id: string) => void;
  onOpenContract: (id: string) => void;
}) {
  const all = dossier.groups.flatMap((group) => group.contracts);
  const customer = all.filter((contract) => contract.role === "customer").length;
  const usual: DossierContract["role"] = customer * 2 >= all.length ? "customer" : "executor";
  const row = (contract: DossierContract, who?: DossierGroup) => (
    <button key={contract.id} type="button" className="party-contract" onClick={() => onOpenContract(contract.id)}>
      <span className="creg-num">{bareNumber(contract.number) || "без номера"}</span>
      <span className="party-contract-what">
        {who ? <span className="party-contract-who">{who.name || "-"}</span> : null}
        <span>
          {[contract.subject?.value || contract.type?.value, contract.signed_at ? `от ${formatDay(contract.signed_at)}` : ""]
            .filter(Boolean)
            .join(" · ") || "-"}
          {contract.role !== usual ? (
            <span className="annot"> {contract.role === "customer" ? "заказчик" : "исполнитель"}</span>
          ) : null}
        </span>
      </span>
      <span className="creg-status" data-phase={contract.status?.meaning.phase}>
        {contract.status?.value ?? ""}
      </span>
      <span className="creg-money">
        {contract.amount ? (
          <>
            {contractMoney(contract.amount)}
            {contract.billing === "month" ? <small> /мес</small> : null}
          </>
        ) : (
          "-"
        )}
      </span>
    </button>
  );
  if (dossier.own) {
    const flat = dossier.groups
      .flatMap((group) => group.contracts.map((contract) => ({ contract, group })))
      .sort((a, b) => (b.contract.signed_at ?? "").localeCompare(a.contract.signed_at ?? ""));
    return (
      <Section title="Договоры" count={dossier.contracts}>
        {flat.map(({ contract, group }) => row(contract, group))}
        {!flat.length ? <p className="party-none">Договоров, открытых вам, нет</p> : null}
      </Section>
    );
  }
  return (
    <Section title="Договоры" count={dossier.contracts}>
      {dossier.groups.map((group) => (
        <div key={group.party_id ?? "none"} className="party-group">
          <div className="party-group-head">
            {group.party_id ? (
              <button type="button" className="fin-link-btn" onClick={() => onOpen(group.party_id as string)}>
                {group.name || "-"}
              </button>
            ) : (
              <span className="fin-muted">вторая сторона не указана</span>
            )}
            {group.full_name && group.full_name !== group.name ? (
              <span className="party-group-full">{group.full_name}</span>
            ) : null}
            <span className="party-group-count">{group.contracts.length}</span>
          </div>
          {group.contracts.map((contract) => row(contract))}
        </div>
      ))}
      {!dossier.groups.length ? <p className="party-none">Договоров, открытых вам, нет</p> : null}
    </Section>
  );
}

function Own({ dossier, canSetup, onChanged }: { dossier: Dossier; canSetup: boolean; onChanged: () => void }) {
  const own = dossier.own;
  if (!own) return null;
  return (
    <>
      <TaxPeriods entityId={dossier.id} periods={own.tax} canSetup={canSetup} onChanged={onChanged} />
      {own.accounts.length ? (
        <Section title="Счета" count={own.accounts.length}>
          {own.accounts.map((account) => (
            <div key={account.id} className="party-line">
              <span>{account.name}</span>
              <span className="fin-mono fin-soft">{account.number || "-"}</span>
            </div>
          ))}
        </Section>
      ) : null}
      {own.bases.length ? (
        <Section title="Базы 1С" count={own.bases.length}>
          {own.bases.map((base) => (
            <div key={base.id} className="party-line">
              <span>{base.title || base.url}</span>
              <span className="fin-soft">{base.state === "off" ? "не читается" : "читается"}</span>
            </div>
          ))}
        </Section>
      ) : null}
    </>
  );
}

const MONTHS_IN = [
  "январе", "феврале", "марте", "апреле", "мае", "июне",
  "июле", "августе", "сентябре", "октябре", "ноябре", "декабре",
];

/**
 * Досье нашего ТОО «в цифрах» (ядро, фаза 8): оборот и НДС за год, кто ему
 * должен - те же числа, что в «НДС» и «Долгах», и переход туда. Долг - по
 * месяцам этого ТОО: переведённый клиент остаётся должен прежнему за старые.
 */
function OwnNumbers({ entityId }: { entityId: string }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof coreApi.entityNumbers>> | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    coreApi
      .entityNumbers(entityId)
      .then((next) => alive && setData(next))
      .catch((exc) => alive && setError(messageOf(exc, "Числа не посчитались")));
    return () => {
      alive = false;
    };
  }, [entityId]);
  const vat = data?.vat;
  const money = (value: string | null | undefined) => (value && Math.round(Number(value)) ? contractMoney(Math.round(Number(value))) : "-");
  const vatLine = !vat
    ? ""
    : vat.status === "payer"
      ? `плательщик НДС${vat.payer_from ? ` с ${formatDay(vat.payer_from)}` : ""} · НДС с начала года ${money(vat.vat_fact)}, к концу года ${money(vat.vat)}`
      : vat.status === "becomes"
        ? `на НДС с ${formatDay(vat.payer_from)} · НДС к концу года ${money(vat.vat)}`
        : `${vat.status === "unknown" ? "режим не записан · " : ""}${
            vat.crossing ? `порог ${vat.crossing <= new Date().toISOString().slice(0, 7) ? "пройден" : "будет пройден"} в ${MONTHS_IN[Number(vat.crossing.slice(5, 7)) - 1]}` : `до порога ${money(vat.remaining)}`
          }`;
  return (
    <Section title={`В цифрах${data ? ` · ${data.year}` : ""}`}>
      {error ? <p className="ifield-error">{error}</p> : null}
      {!data && !error ? <p className="party-none">Считаем…</p> : null}
      {data ? (
        <>
          {vat ? (
            <div className="party-line">
              <span>Оборот без НДС</span>
              <span className="fin-num">
                {money(vat.fact)} <span className="fin-soft">· к концу года {money(vat.forecast)}</span>
              </span>
            </div>
          ) : null}
          {vat ? (
            <div className="party-line">
              <span>НДС</span>
              <button type="button" className="fin-link-btn" onClick={() => openSection({ section: "vat" })}>
                {vatLine}
              </button>
            </div>
          ) : null}
          <div className="party-line">
            <span>Должны этому ТОО</span>
            <button
              type="button"
              className="fin-link-btn"
              onClick={() =>
                openSection({
                  section: "debts",
                  session: { "core.debts.view": "contracts", "core.debts.side": "receivable", "core.debts.group": "entity" },
                })
              }
            >
              {Number(data.debts.owed)
                ? `${money(data.debts.owed)} · ${data.debts.contracts} ${plural(data.debts.contracts, "договор", "договора", "договоров")}${
                    Number(data.debts.d90plus) ? ` · больше 90 дней ${money(data.debts.d90plus)}` : ""
                  }`
                : "никто не должен"}
            </button>
          </div>
        </>
      ) : null}
    </Section>
  );
}

/**
 * Режим юрлица по датам: с какого дня общеустановленный или упрощённый и
 * плательщик ли НДС. Действующий - полной тушью, прошлые - тише, будущий -
 * с пометкой «впереди». От него считаются НДС документов и оборот к порогу.
 */
function TaxPeriods({
  entityId,
  periods,
  canSetup,
  onChanged,
}: {
  entityId: string;
  periods: TaxPeriod[];
  canSetup: boolean;
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const today = localToday();
  const sorted = [...periods].sort((a, b) => b.valid_from.localeCompare(a.valid_from));
  const current = sorted.find((period) => period.valid_from <= today);
  const remove = async (periodId: string) => {
    setBusy(periodId);
    setError("");
    try {
      await coreApi.removeTaxPeriod(entityId, periodId);
      onChanged();
    } catch (exc) {
      setError(messageOf(exc, "Запись не убралась"));
    } finally {
      setBusy("");
    }
  };
  return (
    <Section
      title="Режим и НДС"
      count={periods.length || undefined}
      end={
        canSetup && !adding ? (
          <button type="button" className="fin-link-btn" onClick={() => setAdding(true)}>
            С новой даты
          </button>
        ) : null
      }
    >
      {sorted.map((period) => (
        <div
          key={period.id}
          className="amend-row"
          data-muted={period !== current && period.valid_from <= today ? "true" : undefined}
        >
          <span className="amend-when">с {formatDay(period.valid_from)}</span>
          <span>
            {period.regime_title ?? period.regime}
            {period.vat_payer ? " · плательщик НДС" : " · без НДС"}
            {period.note ? (
              <>
                <br />
                <span className="fin-soft">{period.note}</span>
              </>
            ) : null}
          </span>
          <span className="party-row-acts">
            {period.valid_from > today ? <span className="annot">впереди</span> : null}
            {canSetup ? (
              <button type="button" className="fin-link-btn" disabled={busy === period.id} onClick={() => remove(period.id)}>
                Убрать
              </button>
            ) : null}
          </span>
        </div>
      ))}
      {!sorted.length && !adding ? <p className="party-none">Режим не записан</p> : null}
      {adding ? (
        <PeriodForm
          entityId={entityId}
          onDone={() => {
            setAdding(false);
            onChanged();
          }}
          onCancel={() => setAdding(false)}
        />
      ) : null}
      {error ? <p className="ifield-error">{error}</p> : null}
    </Section>
  );
}

function PeriodForm({ entityId, onDone, onCancel }: { entityId: string; onDone: () => void; onCancel: () => void }) {
  const [from, setFrom] = useState("");
  const [regime, setRegime] = useState<TaxPeriod["regime"]>("general");
  const [vat, setVat] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const iso = parseDay(from);
  const save = async () => {
    if (!iso) return;
    setBusy(true);
    setError("");
    try {
      await coreApi.addTaxPeriod(entityId, {
        valid_from: iso,
        regime,
        vat_payer: regime === "general" && vat,
        note: note.trim(),
      });
      onDone();
    } catch (exc) {
      setError(messageOf(exc, "Режим не записался"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="party-form party-period-form">
      <DateInput value={from} onChange={setFrom} ariaLabel="С какой даты" autoFocus className="input-field party-date" />
      <ChoiceSelect
        className="input-field"
        value={regime}
        placeholder="режим"
        aria-label="Режим"
        onChange={(value) => {
          const next = (value || "general") as TaxPeriod["regime"];
          setRegime(next);
          // На специальном режиме плательщиком НДС не бывают.
          if (next !== "general") setVat(false);
        }}
      >
        {REGIMES.map((item) => (
          <option key={item.value} value={item.value}>
            {item.title}
          </option>
        ))}
      </ChoiceSelect>
      <label className="party-check">
        <input type="checkbox" checked={vat} disabled={regime !== "general"} onChange={(event) => setVat(event.target.checked)} />
        плательщик НДС
      </label>
      <input
        className="input-field party-note"
        value={note}
        placeholder="примечание"
        aria-label="Примечание"
        onChange={(event) => setNote(event.target.value)}
      />
      <span className="party-form-acts">
        <button type="button" className="btn-ghost btn-sm" disabled={!iso || busy} onClick={save}>
          {busy ? "Записываем…" : "Записать"}
        </button>
        <button type="button" className="fin-link-btn" onClick={onCancel}>
          Отмена
        </button>
      </span>
      {error ? <p className="ifield-error party-form-error">{error}</p> : null}
    </div>
  );
}
