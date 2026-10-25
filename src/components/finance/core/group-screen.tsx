"use client";

/**
 * «Карта группы» (ядро, фаза 8): наши ТОО и что между ними - одним взглядом.
 *
 * Узел - наше юрлицо: оборот без НДС с начала года и к концу года, статус НДС
 * (на НДС, порог в таком-то месяце, режим не записан). Сплошная стрелка -
 * договоры между своими (от исполнителя к заказчику), пунктир - переводы
 * клиентов (от прежнего ТОО к новому). Под картой - те же связи списком и
 * люди, которым платят сразу несколько ТОО: наблюдение для владельца.
 *
 * Цвета нет: тушь и её тон, вес линии и пунктир. На узком экране карта
 * уступает место спискам - на 390 px надписи на ней не прочесть.
 */
import { useEffect, useMemo, useState } from "react";

import { type GroupEdge, type GroupNode, type GroupView, compactMoney, coreApi, formatMonth } from "@/components/finance/api";
import { contractMoney, formatDay, plural } from "@/components/finance/format";
import { useSessionState } from "@/components/session-state";

const W = 1100;
const H = 680;
const BOX_W = 150;
const BOX_H = 62;
/** Длинное имя (ИП, физлицо) - укорачивается на карте, целиком - в подсказке и списках. */
const NAME_MAX = 20;

function short(text: string): string {
  return text.length > NAME_MAX ? `${text.slice(0, NAME_MAX - 1).trimEnd()}…` : text;
}

const MONTHS_IN = [
  "январе", "феврале", "марте", "апреле", "мае", "июне",
  "июле", "августе", "сентябре", "октябре", "ноябре", "декабре",
];

function messageOf(exc: unknown, fallback: string): string {
  return exc instanceof Error && exc.message ? exc.message : fallback;
}

function statusText(node: GroupNode): string {
  if (node.status === "payer") return "на НДС";
  if (node.status === "becomes") return `на НДС с ${formatDay(node.payer_from).slice(0, 5)}`;
  if (node.crossing) return `порог в ${MONTHS_IN[Number(node.crossing.slice(5, 7)) - 1] ?? node.crossing}`;
  return node.status === "unknown" ? "режим не записан" : "до порога далеко";
}

type Point = { x: number; y: number };

/** Точка на краю прямоугольника узла по направлению к другой точке. */
function edgeOf(center: Point, toward: Point): Point {
  const dx = toward.x - center.x;
  const dy = toward.y - center.y;
  if (!dx && !dy) return center;
  const scale = Math.min(dx ? BOX_W / 2 / Math.abs(dx) : Infinity, dy ? BOX_H / 2 / Math.abs(dy) : Infinity);
  return { x: center.x + dx * scale, y: center.y + dy * scale };
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
      .catch((exc) => alive && setError(messageOf(exc, "Карта не собралась")))
      .finally(() => alive && setAnswered(year));
    return () => {
      alive = false;
    };
  }, [year]);

  const byId = useMemo(() => new Map((data?.nodes ?? []).map((node) => [node.id, node])), [data]);
  const intra = (data?.edges ?? []).filter((edge) => edge.kind === "intra");
  const moves = (data?.edges ?? []).filter((edge) => edge.kind === "transfer");
  const code = (id: string) => byId.get(id)?.code ?? "-";

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
            ? `${data.nodes.length} ${plural(data.nodes.length, "юрлицо", "юрлица", "юрлиц")} · порог ${compactMoney(data.threshold)} · ${intra.length} ${plural(intra.length, "связь", "связи", "связей")} договорами · ${moves.length} ${plural(moves.length, "перевод", "перевода", "переводов")} клиентов`
            : loading
              ? "Собираем карту…"
              : ""}
        </p>
      </div>
      {error ? <p className="party-error">{error}</p> : null}
      {data ? (
        <>
          <GroupMap view={data} />
          <div className="group-lists">
            <section className="group-list" aria-label="Договоры между своими">
              <h2 className="vat-group-title">Договоры между своими</h2>
              {intra.length ? (
                intra.map((edge) => (
                  <p key={`${edge.from}-${edge.to}`} className="group-row">
                    <span className="group-route">
                      {code(edge.from)} → {code(edge.to)}
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
                      {code(edge.from)} → {code(edge.to)}
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
                <p className="party-none">Таких выплат в журнале нет</p>
              )}
            </section>
          </div>
        </>
      ) : null}
    </div>
  );
}

function GroupMap({ view }: { view: GroupView }) {
  const nodes = view.nodes;
  const max = Math.max(...nodes.map((node) => Number(node.forecast)), Number(view.threshold), 1);
  const threshold = Number(view.threshold);
  /**
   * Самый связанный узел (у BBC - «Маркетинг», через который идут договоры
   * между своими) - в центр, остальные по кругу в порядке связей с ним: так
   * стрелки расходятся лучами, а не режут карту поперёк.
   */
  const place = useMemo(() => {
    const out = new Map<string, Point>();
    const degree = new Map<string, number>();
    for (const edge of view.edges) {
      degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1);
      degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
    }
    const ranked = [...nodes].sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0));
    const hub = ranked[0] && (degree.get(ranked[0].id) ?? 0) >= 3 ? ranked[0] : null;
    const ring = nodes.filter((node) => node !== hub);
    if (hub) out.set(hub.id, { x: W / 2, y: H / 2 });
    const count = Math.max(ring.length, 1);
    ring.forEach((node, index) => {
      const angle = -Math.PI / 2 + (index * 2 * Math.PI) / count;
      out.set(node.id, { x: W / 2 + (W / 2 - BOX_W / 2 - 16) * Math.cos(angle), y: H / 2 + (H / 2 - BOX_H / 2 - 14) * Math.sin(angle) });
    });
    return out;
  }, [nodes, view.edges]);
  const label = nodes
    .map((node) => `${node.code}: ${compactMoney(node.forecast)} к концу года, ${statusText(node)}`)
    .join("; ");
  return (
    <figure className="group-figure only-desktop">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Карта группы: ${label}`} className="group-svg">
        <defs>
          <marker id="group-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="currentColor" />
          </marker>
        </defs>
        {view.edges.map((edge) => (
          <Edge key={`${edge.kind}-${edge.from}-${edge.to}`} edge={edge} place={place} />
        ))}
        {nodes.map((node) => {
          const at = place.get(node.id);
          if (!at) return null;
          const x = at.x - BOX_W / 2;
          const y = at.y - BOX_H / 2;
          const barW = BOX_W - 20;
          return (
            <g key={node.id} className="group-node" data-status={node.status}>
              <title>{`${node.name || node.code}: ${compactMoney(node.forecast)} к концу года, ${statusText(node)}`}</title>
              <rect x={x} y={y} width={BOX_W} height={BOX_H} rx={4} />
              <text x={at.x} y={y + 19} textAnchor="middle" className="group-code">
                {short(node.code)}
              </text>
              <text x={at.x} y={y + 35} textAnchor="middle" className="group-sum">
                {compactMoney(node.forecast)} к концу года
              </text>
              <text x={at.x} y={y + 50} textAnchor="middle" className="group-state">
                {statusText(node)}
              </text>
              <rect x={x + 10} y={y + BOX_H - 9} width={barW} height={3} className="group-bar-back" />
              <rect x={x + 10} y={y + BOX_H - 9} width={(barW * Math.max(Number(node.forecast), 0)) / max} height={3} className="group-bar-forecast" />
              <rect x={x + 10} y={y + BOX_H - 9} width={(barW * Math.max(Number(node.fact), 0)) / max} height={3} className="group-bar-fact" />
              {node.status !== "payer" ? (
                <line x1={x + 10 + (barW * threshold) / max} x2={x + 10 + (barW * threshold) / max} y1={y + BOX_H - 12} y2={y + BOX_H - 3} className="group-limit" />
              ) : null}
            </g>
          );
        })}
      </svg>
      <figcaption className="group-caption">
        Сплошная стрелка - договоры между своими, от исполнителя к заказчику (бледная - без начислений); пунктир - переводы клиентов,
        от прежнего ТОО к новому. Полоса в узле - оборот к концу года (тушью - с начала года), черта - порог НДС. Числа связей - под картой
        и в подсказке у стрелки.
      </figcaption>
    </figure>
  );
}

function Edge({ edge, place }: { edge: GroupEdge; place: Map<string, Point> }) {
  const from = place.get(edge.from);
  const to = place.get(edge.to);
  if (!from || !to) return null;
  // Две связи между одной парой (договоры и перевод) - по разные стороны прямой.
  const bend = edge.kind === "intra" ? 34 : -34;
  const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  const control = { x: mid.x - ((to.y - from.y) / length) * bend, y: mid.y + ((to.x - from.x) / length) * bend };
  const start = edgeOf(from, control);
  const end = edgeOf(to, control);
  // Числа связи - в подсказке и в списках под картой: подписи на 20+ стрелках ложились друг на друга.
  const text =
    edge.kind === "intra"
      ? `${edge.contracts} ${plural(edge.contracts, "договор", "договора", "договоров")} между своими · начислено ${compactMoney(edge.amount)}`
      : `перевод ${edge.contracts} ${plural(edge.contracts, "клиента", "клиентов", "клиентов")}${edge.month ? ` с ${formatMonth(edge.month)}` : ""}`;
  return (
    <g className="group-edge" data-kind={edge.kind} data-empty={Number(edge.amount) ? undefined : "true"}>
      <title>{text}</title>
      <path d={`M${start.x},${start.y} Q${control.x},${control.y} ${end.x},${end.y}`} markerEnd="url(#group-arrow)" />
    </g>
  );
}
