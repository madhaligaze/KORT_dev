"use client";

/**
 * «Слои» (ядро, фаза 9, R15-R17): шаблон → компания → отдел → человек.
 *
 * Шаблон «Компания услуг по договорам» - то, с чего начинается каждая
 * компания: поля договора, статусы с фазами, виды договоров с тем, как
 * начислять, хозяйственные смыслы. Ниже - чем эта компания от него
 * отличается: свои слова, другие смыслы, свои значения и поля, листы,
 * словари таблицы, звенья на KORT; затем - отделы с их правами и люди с
 * личными правами и видом. Другой смысл значения возвращается к шаблону
 * одной правкой (та же, что во вкладке «Поля», с журналом).
 */
import { useCallback, useEffect, useState } from "react";

import { type LayerListItem, type LayersView, contractsApi, coreApi, formatDate } from "@/components/finance/api";
import { BILLING_WORDS, ECONOMIC_WORDS, PHASE_WORDS } from "@/components/finance/contracts/setup/words";

const STATE_WORDS: Record<LayerListItem["state"], string> = {
  template: "как в шаблоне",
  renamed: "своё слово",
  meaning: "другой смысл",
  added: "своё значение",
  removed: "убрано",
};

const LINK_WORDS: Record<string, string> = { bills: "счета", payments: "оплаты" };

function messageOf(exc: unknown, fallback: string): string {
  return exc instanceof Error && exc.message ? exc.message : fallback;
}

/** Смысл значения словами: фаза статуса, как начислять, хозяйственный смысл. */
function meaningText(meaning: Record<string, unknown> | null): string {
  if (!meaning) return "";
  const parts: string[] = [];
  if (typeof meaning.phase === "string") parts.push(PHASE_WORDS[meaning.phase] ?? meaning.phase);
  if (typeof meaning.billing === "string") parts.push(`начислять: ${BILLING_WORDS[meaning.billing] ?? meaning.billing}`);
  const economic = (meaning.economic_role ?? meaning.system) as string | undefined;
  if (typeof economic === "string") parts.push(ECONOMIC_WORDS[economic] ?? economic);
  if (meaning.kind === "other") parts.push("вид известен, без начисления");
  return parts.join(" · ");
}

export function LayersTab() {
  const [data, setData] = useState<LayersView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const load = useCallback(() => {
    coreApi
      .layers()
      .then(setData)
      .catch((exc) => setError(messageOf(exc, "Слои настройки не прочитались")));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const restore = async (item: LayerListItem) => {
    if (!item.id || !item.template_meaning) return;
    setBusy(item.id);
    setError("");
    try {
      await contractsApi.setup.updateValue(item.id, { meaning: item.template_meaning });
      load();
    } catch (exc) {
      setError(messageOf(exc, "Не вернулось"));
    } finally {
      setBusy("");
    }
  };

  if (!data) return <p className="setup-summary-meta">{error || "Читаем слои настройки…"}</p>;
  const company = data.company;
  const kort = Object.entries(company.kort).filter(([, codes]) => codes.length);
  return (
    <section className="setup-pane layers" aria-label="Слои настройки">
      {error ? (
        <p className="setup-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="layer">
        <p className="layer-title">Шаблон «{data.template.title}»</p>
        <p className="layer-line">
          полей договора {data.template.fields} · статусов {data.template.lists.status ?? 0} · видов договоров {data.template.lists.type ?? 0} ·
          хозяйственных смыслов {data.template.lists.economic_role ?? 0}
        </p>
      </div>

      <div className="layer">
        <p className="layer-title">Компания</p>
        {company.lists.map((list) => {
          const changed = list.items.filter((item) => item.state !== "template");
          return (
            <div key={list.key} className="layer-list">
              <p className="layer-line">
                <span className="fin-strong">{list.title}</span>:{" "}
                {(Object.keys(STATE_WORDS) as LayerListItem["state"][])
                  .filter((state) => list.counts[state])
                  .map((state) => `${STATE_WORDS[state]} ${list.counts[state]}`)
                  .join(" · ")}
              </p>
              {changed.length ? (
                <ul className="layer-items">
                  {changed.map((item) => (
                    <li key={`${item.id ?? item.template}`} className="layer-item">
                      <span className="layer-item-what">
                        <span>
                          {item.state === "removed"
                            ? `«${item.template}»`
                            : item.state === "renamed"
                              ? `«${item.value}» вместо «${item.template}»`
                              : `«${item.value}»`}
                        </span>
                        <span className="layer-note">
                          {STATE_WORDS[item.state]}
                          {item.state === "meaning"
                            ? `: ${meaningText(item.meaning) || "без смысла"}, в шаблоне - ${meaningText(item.template_meaning)}`
                            : item.state === "added" && meaningText(item.meaning)
                              ? `: ${meaningText(item.meaning)}`
                              : ""}
                        </span>
                      </span>
                      {item.state === "meaning" ? (
                        <button
                          type="button"
                          className="fin-link-btn"
                          disabled={busy === item.id}
                          onClick={() => void restore(item)}
                        >
                          {busy === item.id ? "Возвращаем…" : "как в шаблоне"}
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          );
        })}
        <p className="layer-line">
          {company.fields.length ? `своих полей ${company.fields.length}: ${company.fields.join(", ")}` : "своих полей нет"}
          {company.hidden_fields.length ? ` · полей шаблона скрыто ${company.hidden_fields.length}` : ""}
        </p>
        <p className="layer-line">
          листов: реестр {company.views.registry ?? 0}
          {company.views.oneoff ? `, «Разовые» ${company.views.oneoff}` : ""} · своих названий колонок таблицы {company.columns} · слов таблицы{" "}
          {company.words}
        </p>
        <p className="layer-line">
          {company.since ? `учёт оплат с ${formatDate(company.since)}` : "учёт оплат не начат"}
          {kort.length ? ` · на KORT: ${kort.map(([link, codes]) => `${LINK_WORDS[link] ?? link} - ${codes.length} юрлиц`).join(", ")}` : " · все звенья - из таблицы"}
        </p>
      </div>

      <div className="layer">
        <p className="layer-title">Отделы</p>
        {data.departments.length ? (
          <ul className="layer-items">
            {data.departments.map((item) => (
              <li key={item.id} className="layer-item">
                <span className="layer-item-what">
                  <span>{item.title && item.title !== item.code ? `${item.code} · ${item.title}` : item.code}</span>
                  <span className="layer-note">{item.grants ? `прав отдела: ${item.grants}` : "своих прав нет - как у компании"}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="layer-line">отделов нет</p>
        )}
      </div>

      <div className="layer">
        <p className="layer-title">Люди</p>
        <p className="layer-line">
          сотрудников {data.people.employees} · с личными правами {data.people.with_own_rights} · с личным видом листов {data.people.looks} ·
          закрепили разделы {data.people.pins}
        </p>
      </div>
    </section>
  );
}
