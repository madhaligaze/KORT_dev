"use client";

/**
 * «Порог НДС» - оборот наших юрлиц к порогу постановки на учёт (ядро, фаза 7).
 *
 * Решение владельца 24.10.2026: расчёт НДС и порога - функция ядра, без
 * оговорок. По каждому юрлицу - оборот без НДС с начала года (начисления
 * договоров-выручки, где оно исполнитель), прогноз до конца года из условий
 * договоров, до порога и месяц, в котором порог будет пройден. Числа года -
 * МРП, порог в МРП, ставка - из закона и поправок компании.
 *
 * «Перевести клиентов» - договоры юрлица с какого дня переходят к другому
 * нашему юрлицу: сначала оборот обоих до и после, потом запись - изменения
 * «исполнитель с даты» пачкой; вернуть - «Восстановление» в кабинете.
 */
import { useEffect, useMemo, useState } from "react";

import { type VatClient, type VatEntity, type VatPreview, type VatYearView, coreApi, formatMonth } from "@/components/finance/api";
import { CardLayer } from "@/components/finance/ui/card-layer";
import { ChoiceSelect } from "@/components/choice-select";
import { DateInput } from "@/components/finance/ui/date-picker";
import { bareNumber, contractMoney, formatDay, parseDay, plural } from "@/components/finance/format";
import { CloseIcon } from "@/components/icons";
import { useSessionState } from "@/components/session-state";

function messageOf(exc: unknown, fallback: string): string {
  return exc instanceof Error && exc.message ? exc.message : fallback;
}

function money(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "-";
  return contractMoney(value);
}

const MONTHS_IN = [
  "январе", "феврале", "марте", "апреле", "мае", "июне",
  "июле", "августе", "сентябре", "октябре", "ноябре", "декабре",
];

/** «в марте 2026» - месяц перехода порога фразой. */
function monthIn(key: string): string {
  const index = Number(key.slice(5, 7)) - 1;
  return MONTHS_IN[index] ? `в ${MONTHS_IN[index]} ${key.slice(0, 4)}` : key;
}

function regimeText(entity: VatEntity): string {
  if (entity.payer_now) return entity.payer_since ? `плательщик НДС с ${formatDay(entity.payer_since)}` : "плательщик НДС";
  return entity.regime ? `${entity.regime}, не плательщик НДС` : "режим не записан";
}

/** Первое число следующего месяца - день перевода по умолчанию. */
function nextMonthStart(): string {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return `${String(next.getDate()).padStart(2, "0")}.${String(next.getMonth() + 1).padStart(2, "0")}.${next.getFullYear()}`;
}

export function VatScreen() {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useSessionState("core.vat.year", thisYear);
  const [data, setData] = useState<VatYearView | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const [moving, setMoving] = useState<VatEntity | null>(null);
  const [note, setNote] = useState("");
  useEffect(() => {
    let alive = true;
    coreApi
      .vat(year)
      .then((next) => {
        if (!alive) return;
        setData(next);
        setError("");
      })
      .catch((exc) => alive && setError(messageOf(exc, "Оборот не посчитался")));
    return () => {
      alive = false;
    };
  }, [year, revision]);
  const facts = data?.year;
  return (
    <div className="vat-screen">
      <div className="vat-bar">
        <nav className="fin-mine" aria-label="Год">
          {[thisYear, thisYear + 1].map((item) => (
            <button key={item} type="button" className="fin-chip" data-on={year === item ? "" : undefined} onClick={() => setYear(item)}>
              {item}
            </button>
          ))}
        </nav>
        {facts ? (
          <p className="vat-facts">
            МРП {money(facts.mrp)} ₸ · порог {facts.threshold_mrp.toLocaleString("ru-RU")} МРП = {money(facts.threshold)} ₸ · НДС{" "}
            {Number(facts.vat_rate)}%{facts.forecast ? " · прогноз" : ""}
          </p>
        ) : null}
      </div>
      {error ? <p className="party-error">{error}</p> : null}
      {note ? (
        <p className="shadow-note" role="status">
          {note}
        </p>
      ) : null}
      {!data ? (
        <p className="creg-empty">Считаем оборот…</p>
      ) : (
        <div className="vat-list">
          {data.entities.map((entity) => (
            <EntityRow
              key={entity.entity_id}
              entity={entity}
              threshold={Number(data.year.threshold)}
              open={open === entity.entity_id}
              onToggle={() => setOpen(open === entity.entity_id ? null : entity.entity_id)}
              onMove={() => setMoving(entity)}
            />
          ))}
        </div>
      )}
      {moving && data ? (
        <TransferCard
          year={year}
          source={moving}
          entities={data.entities}
          threshold={Number(data.year.threshold)}
          onClose={() => setMoving(null)}
          onDone={(text) => {
            setMoving(null);
            setNote(text);
            setRevision((value) => value + 1);
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * Полоса оборота: факт - полной тушью, прогноз до конца года - тише, порог -
 * чертой. Цвета нет: переход порога - событие учёта, не отказ.
 */
function Track({ fact, forecast, threshold }: { fact: number; forecast: number; threshold: number }) {
  const scale = Math.max(threshold, forecast, 1);
  return (
    <span className="vat-track" aria-hidden="true">
      <span className="vat-track-forecast" style={{ width: `${(Math.max(forecast, 0) / scale) * 100}%` }} />
      <span className="vat-track-fact" style={{ width: `${(Math.max(fact, 0) / scale) * 100}%` }} />
      <span className="vat-track-limit" style={{ left: `${(threshold / scale) * 100}%` }} />
    </span>
  );
}

function EntityRow({
  entity,
  threshold,
  open,
  onToggle,
  onMove,
}: {
  entity: VatEntity;
  threshold: number;
  open: boolean;
  onToggle: () => void;
  onMove: () => void;
}) {
  const fact = Number(entity.fact);
  const forecast = Number(entity.forecast);
  // Оборот с начала года на конец каждого месяца.
  const running = entity.months.reduce<number[]>((sums, month) => [...sums, (sums.at(-1) ?? 0) + Number(month.net)], []);
  return (
    <section className="vat-entity">
      <div className="vat-entity-head">
        <button type="button" className="vat-entity-name" aria-expanded={open} onClick={onToggle}>
          <span className="vat-code">{entity.code || entity.name}</span>
          {entity.code && entity.name !== entity.code ? <span className="fin-soft">{entity.name}</span> : null}
        </button>
        <span className="vat-regime">{regimeText(entity)}</span>
        <button type="button" className="fin-link-btn" onClick={onMove}>
          Перевести клиентов
        </button>
      </div>
      <Track fact={fact} forecast={forecast} threshold={threshold} />
      <dl className="vat-numbers">
        <div>
          <dt>начислено с начала года</dt>
          <dd>{money(entity.fact)}</dd>
        </div>
        <div>
          <dt>к концу года по договорам</dt>
          <dd>{money(entity.forecast)}</dd>
        </div>
        <div>
          <dt>до порога</dt>
          <dd>{Number(entity.remaining) > 0 ? money(entity.remaining) : "порог пройден"}</dd>
        </div>
        <div>
          <dt>порог</dt>
          <dd>{entity.crossing ? monthIn(entity.crossing) : "до конца года не дойдёт"}</dd>
        </div>
      </dl>
      {open ? (
        <div className="fin-card overflow-x-auto vat-months">
          <table className="fin-table">
            <thead>
              <tr>
                <th>Месяц</th>
                <th style={{ textAlign: "right" }}>Начислено без НДС</th>
                <th style={{ textAlign: "right" }}>НДС</th>
                <th style={{ textAlign: "right" }}>АВР в книге</th>
                <th style={{ textAlign: "right" }}>С начала года</th>
              </tr>
            </thead>
            <tbody>
              {entity.months.map((month, index) => {
                return (
                  <tr key={month.month} data-plan={month.forecast ? "true" : undefined}>
                    <td>
                      {formatMonth(month.month)}
                      {month.contracts ? <span className="fin-bills-note">{month.contracts} {plural(month.contracts, "договор", "договора", "договоров")}</span> : null}
                    </td>
                    <td className="fin-num">{money(month.net)}</td>
                    <td className="fin-num">{Number(month.vat) ? money(month.vat) : "-"}</td>
                    <td className="fin-num">{money(month.acts)}</td>
                    <td className="fin-num">{money(running[index])}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

function TransferCard({
  year,
  source,
  entities,
  threshold,
  onClose,
  onDone,
}: {
  year: number;
  source: VatEntity;
  entities: VatEntity[];
  threshold: number;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const [clients, setClients] = useState<VatClient[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [target, setTarget] = useState("");
  const [since, setSince] = useState(nextMonthStart());
  const [preview, setPreview] = useState<VatPreview | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    coreApi
      .vatClients(year, source.entity_id)
      .then((result) => alive && setClients(result.items))
      .catch((exc) => alive && setError(messageOf(exc, "Договоры не прочитались")));
    return () => {
      alive = false;
    };
  }, [year, source.entity_id]);
  const sinceIso = parseDay(since);
  const moves = useMemo(
    () => (target && sinceIso ? [...picked].map((contract_id) => ({ contract_id, target, since: sinceIso })) : []),
    [picked, target, sinceIso],
  );
  // Предпросмотр - заново на каждый выбор: старый к новому выбору не относится.
  const key = JSON.stringify(moves);
  useEffect(() => {
    if (!moves.length) return;
    let alive = true;
    const timer = window.setTimeout(() => {
      setBusy("preview");
      coreApi
        .vatPreview(year, moves)
        .then((result) => alive && setPreview({ ...result, key }))
        .catch((exc) => alive && setError(messageOf(exc, "Предпросмотр не посчитался")))
        .finally(() => alive && setBusy(""));
    }, 300);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` и есть выбор
  }, [key, year]);
  const shown = preview && preview.key === key && moves.length ? preview : null;
  const toggle = (id: string) =>
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const apply = async () => {
    setBusy("apply");
    setError("");
    try {
      const result = await coreApi.vatTransfer(year, moves);
      onDone(
        `Переведено к ${entities.find((item) => item.entity_id === target)?.code || "юрлицу"}: ${result.done} ${plural(result.done, "договор", "договора", "договоров")} с ${since}` +
          (result.skipped.length ? `; не переведено: ${result.skipped.join("; ")}` : "") +
          " · вернуть - «Восстановление» в кабинете",
      );
    } catch (exc) {
      setError(messageOf(exc, "Перевод не записался"));
    } finally {
      setBusy("");
    }
  };
  return (
    <CardLayer open onClose={onClose} label={`Перевод клиентов из ${source.code || source.name}`}>
      <div className="card-top">
        <span className="card-top-num">Перевод клиентов</span>
        <span className="card-top-state">{source.code || source.name}</span>
        <button type="button" className="fin-icon-btn" aria-label="Закрыть" onClick={onClose}>
          <CloseIcon size={16} />
        </button>
      </div>
      <div className="card-body">
        <h2 className="card-title">Из {source.code || source.name}</h2>
        <div className="party-form vat-move-form">
          <ChoiceSelect className="input-field" value={target} placeholder="к какому юрлицу" aria-label="К какому юрлицу" onChange={setTarget}>
            {entities
              .filter((item) => item.entity_id !== source.entity_id)
              .map((item) => (
                <option key={item.entity_id} value={item.entity_id}>
                  {item.code || item.name}
                </option>
              ))}
          </ChoiceSelect>
          <span className="fin-muted">с</span>
          <DateInput value={since} onChange={setSince} ariaLabel="С какого дня" className="input-field party-date" />
        </div>
        {error ? <p className="ifield-error">{error}</p> : null}
        <div className="vat-clients" role="list">
          {!clients ? (
            <p className="party-none">Читаем договоры…</p>
          ) : !clients.length ? (
            <p className="party-none">До конца года у юрлица начислений нет</p>
          ) : (
            clients.map((client) => (
              <label key={client.contract_id} className="vat-client" role="listitem">
                <input type="checkbox" checked={picked.has(client.contract_id)} onChange={() => toggle(client.contract_id)} />
                <span className="vat-client-name">
                  {client.customer || "-"}
                  <span className="creg-num">{bareNumber(client.number)}</span>
                </span>
                <span className="fin-num">{money(client.monthly)} /мес</span>
                <span className="fin-num fin-soft">{money(client.rest)} до конца года</span>
              </label>
            ))
          )}
        </div>
        {/* Внизу окна и при прокрутке длинного списка: что будет с оборотом и «Перевести». */}
        <div className="vat-move-foot">
          {shown ? <PreviewBlock preview={shown} threshold={threshold} /> : null}
          <div className="party-form-acts">
            <button type="button" className="btn-primary btn-sm" disabled={!moves.length || busy === "apply"} onClick={apply}>
              {busy === "apply"
                ? "Переводим…"
                : moves.length
                  ? `Перевести ${moves.length} ${plural(moves.length, "договор", "договора", "договоров")}`
                  : target
                    ? "Отметьте договоры"
                    : "Выберите юрлицо"}
            </button>
            <button type="button" className="fin-link-btn" onClick={onClose}>
              Отмена
            </button>
          </div>
        </div>
      </div>
    </CardLayer>
  );
}

function PreviewBlock({ preview, threshold }: { preview: VatPreview; threshold: number }) {
  return (
    <div className="vat-preview" role="status">
      {preview.entities.map((item) => (
        <div key={item.entity_id} className="vat-preview-row">
          <span className="vat-code">{item.code || item.name}</span>
          <span>
            к концу года {money(item.before)} → <strong>{money(item.after)}</strong>
          </span>
          <span className="fin-soft">
            {Number(item.after) > threshold
              ? `порог ${item.crossing_after ? monthIn(item.crossing_after) : "пройден"}`
              : `до порога ${money(threshold - Number(item.after))}`}
          </span>
        </div>
      ))}
    </div>
  );
}
