"use client";

/**
 * «Между своими»: что происходит между нашими юрлицами, списками.
 *
 * Договоры одного нашего ТОО с другим, клиенты, переведённые с ТОО на ТОО, и
 * люди, которым платят сразу несколько ТОО. Раздел виден, когда юрлиц два и
 * больше (`core/usage.py`).
 *
 * Раньше здесь стояла схема: узлы и стрелки «от исполнителя к заказчику» с
 * полосой оборота внутри. Владелец 01.11: модель непонятна, переработать или
 * убрать. Своего у схемы не было: связи - те же списки ниже, оборот к порогу -
 * в «НДС». Убрана.
 */
import { useEffect, useMemo, useState } from "react";

import { type GroupView, compactMoney, coreApi, formatMonth } from "@/components/finance/api";
import { contractMoney, plural } from "@/components/finance/format";
import { useSessionState } from "@/components/session-state";

function messageOf(exc: unknown, fallback: string): string {
  return exc instanceof Error && exc.message ? exc.message : fallback;
}

export function GroupScreen() {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useSessionState("core.group.year", thisYear);
  const [data, setData] = useState<GroupView | null>(null);
  const [error, setError] = useState("");
  const [answered, setAnswered] = useState(0);
  const loading = answered !== year;

  useEffect(() => {
    let alive = true;
    coreApi
      .group(year)
      .then((next) => {
        if (!alive) return;
        setData(next);
        setError("");
      })
      .catch((exc) => alive && setError(messageOf(exc, "Не прочиталось")))
      .finally(() => alive && setAnswered(year));
    return () => {
      alive = false;
    };
  }, [year]);

  const byId = useMemo(() => new Map((data?.nodes ?? []).map((node) => [node.id, node])), [data]);
  const intra = (data?.edges ?? []).filter((edge) => edge.kind === "intra");
  const moves = (data?.edges ?? []).filter((edge) => edge.kind === "transfer");
  const name = (id: string) => {
    const node = byId.get(id);
    return node?.code || node?.name || "-";
  };

  return (
    <div className="group-screen">
      <div className="debts-bar">
        <span className="fin-mine" role="group" aria-label="Год">
          {[thisYear - 1, thisYear].map((item) => (
            <button key={item} type="button" className="fin-chip" data-on={year === item ? "" : undefined} onClick={() => setYear(item)}>
              {item}
            </button>
          ))}
        </span>
        <p className="debts-source">
          {data
            ? `${data.nodes.length} ${plural(data.nodes.length, "юрлицо", "юрлица", "юрлиц")} · ${intra.length} ${plural(intra.length, "пара", "пары", "пар")} с договорами между собой · ${moves.length} ${plural(moves.length, "перевод", "перевода", "переводов")} клиентов`
            : loading
              ? "Собираем…"
              : ""}
        </p>
      </div>
      {error ? <p className="party-error">{error}</p> : null}
      {data ? (
        <div className="group-lists">
          <section className="group-list" aria-label="Договоры между своими">
            <h2 className="vat-group-title">Договоры между своими</h2>
            {intra.length ? (
              intra.map((edge) => (
                <p key={`${edge.from}-${edge.to}`} className="group-row">
                  <span className="group-route">
                    {name(edge.from)} оказывает услуги {name(edge.to)}
                  </span>
                  <span>
                    {edge.contracts} {plural(edge.contracts, "договор", "договора", "договоров")}
                    {edge.numbers?.length ? <span className="fin-soft"> · {edge.numbers.join(", ")}</span> : null}
                  </span>
                  <span className="fin-num">{Number(edge.amount) ? contractMoney(Math.round(Number(edge.amount))) : "-"}</span>
                </p>
              ))
            ) : (
              <p className="party-none">Договоров между нашими юрлицами нет</p>
            )}
          </section>
          <section className="group-list" aria-label="Переводы клиентов">
            <h2 className="vat-group-title">Переводы клиентов</h2>
            {moves.length ? (
              moves.map((edge) => (
                <p key={`${edge.from}-${edge.to}`} className="group-row">
                  <span className="group-route">
                    С {name(edge.from)} на {name(edge.to)}
                  </span>
                  <span>
                    {edge.contracts} {plural(edge.contracts, "договор", "договора", "договоров")}
                    {edge.month ? <span className="fin-soft"> · с {formatMonth(edge.month)}</span> : null}
                  </span>
                  <span className="fin-num">{contractMoney(Math.round(Number(edge.amount)))} /мес</span>
                </p>
              ))
            ) : (
              <p className="party-none">В {year} году клиентов между юрлицами не переводили</p>
            )}
          </section>
          <section className="group-list" aria-label="Выплаты людям из нескольких ТОО">
            <h2 className="vat-group-title">
              Выплаты людям из нескольких ТОО <span className="fin-soft">{data.people_total}</span>
            </h2>
            {data.people.length ? (
              data.people.map((person) => (
                <p key={person.id} className="group-row">
                  <span className="group-route">{person.name}</span>
                  <span className="fin-soft">
                    {person.entities.map((item) => `${item.code} ${compactMoney(item.amount)}`).join(" · ")}
                  </span>
                  <span className="fin-num">{contractMoney(Math.round(Number(person.total)))}</span>
                </p>
              ))
            ) : (
              <p className="party-none">Таких выплат нет</p>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}
