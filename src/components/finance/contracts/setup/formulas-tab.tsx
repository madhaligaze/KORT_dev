"use client";

/**
 * «Формулы» (этап 3, решение владельца 31.10.2026): мера, которую компания
 * заводит сама, - «Оплачено, %», «Остаток, тыс».
 *
 * В таблице это формула в клетке: она читает соседнюю колонку, когда вставили
 * новую, и в карточке её нет. Здесь формула - команда ядра (`formula.save`):
 * одна на компанию, считает сервер (`core/formulas.py`), лист показывает её
 * колонкой только для чтения, а «объяснить» раскрывает до суммы и оплат.
 * Колонкой формула встаёт в те листы, где её отметили.
 */
import { useState } from "react";

import { type MeasureDef, type RegistryView, contractsApi, modelApi } from "@/components/finance/api";
import { ensureFormulas, useRegistry } from "@/components/finance/contracts/store";
import { useSetupAction } from "@/components/finance/contracts/setup/use-setup-action";

const KINDS: { key: "money" | "number" | "percent"; title: string }[] = [
  { key: "percent", title: "Проценты" },
  { key: "money", title: "Сумма" },
  { key: "number", title: "Число" },
];
/** Меры, из которых складывается формула, - как их пишут в формуле. */
const NAMES = "amount - сумма · paid - оплачено · remaining - остаток · age - срок, мес · + − * / ( ) · min max abs round(x, 1)";

type Draft = { key: string | null; title: string; text: string; type: "money" | "number" | "percent"; digits: number };
const EMPTY: Draft = { key: null, title: "", text: "", type: "percent", digits: 1 };

export function FormulasTab() {
  const schema = useRegistry((s) => s.schema);
  const action = useSetupAction();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const formulas: MeasureDef[] = (schema?.measures ?? []).filter((item) => item.formula);
  const sheets: RegistryView[] = schema?.views ?? [];

  const apply = (command: string, params: Record<string, unknown>) => async () => {
    const done = await modelApi.apply([{ command, params }]);
    void ensureFormulas(true);
    return done;
  };

  const save = async () => {
    const params = { ...(draft.key ? { key: draft.key } : {}), title: draft.title.trim(), text: draft.text.trim(), type: draft.type, digits: draft.digits };
    const ok = await action.run("save", apply("formula.save", params), "schema", (done) =>
      done.point ? { text: `Формула «${params.title}»`, revert: () => modelApi.undo(done.point!.id) } : null,
    );
    if (ok) setDraft(EMPTY);
  };

  const remove = (item: MeasureDef) =>
    action.run(`remove-${item.key}`, apply("formula.remove", { key: item.key }), "schema", (done) =>
      done.point ? { text: `Формула «${item.title}» убрана`, revert: () => modelApi.undo(done.point!.id) } : null,
    );

  /** Колонка формулы в листе: во всех частях листа сразу, последней перед «Долями сотрудников». */
  const inSheet = (view: RegistryView, key: string) => view.blocks.some((block) => block.columns.some((column) => column.key === key));
  const toggle = (view: RegistryView, item: MeasureDef) => {
    const on = inSheet(view, item.key);
    const previous = view.blocks;
    const blocks = view.blocks.map((block) => ({
      ...block,
      columns: on
        ? block.columns.filter((column) => column.key !== item.key)
        : [...block.columns, { key: item.key, label: "", width: null }],
    }));
    return action.run(`sheet-${view.id}-${item.key}`, async () => {
      await contractsApi.setup.updateView(view.id, { blocks });
      void ensureFormulas(true);
    }, "schema", {
      text: `«${item.title}» ${on ? "убрана из листа" : "в листе"} «${view.title}»`,
      revert: () => contractsApi.setup.updateView(view.id, { blocks: previous }),
    });
  };

  return (
    <section className="setup-pane setup-formulas" aria-label="Формулы">
      {formulas.length ? (
        <ul className="setup-formula-list">
          {formulas.map((item) => (
            <li key={item.key} className="setup-formula">
              <div className="setup-formula-head">
                <span className="setup-formula-title">{item.title}</span>
                <code className="setup-formula-text">{item.formula}</code>
                <span className="fin-soft">{KINDS.find((kind) => kind.key === item.kind)?.title ?? ""}</span>
              </div>
              {sheets.length ? (
                <div className="setup-formula-sheets" role="group" aria-label={`Где колонка «${item.title}»`}>
                  {sheets.map((view) => (
                    <label key={view.id} className="setup-formula-sheet">
                      <input
                        type="checkbox"
                        checked={inSheet(view, item.key)}
                        disabled={action.busy(`sheet-${view.id}-${item.key}`)}
                        onChange={() => void toggle(view, item)}
                      />
                      <span>{view.title}</span>
                    </label>
                  ))}
                </div>
              ) : null}
              <div className="setup-formula-acts">
                <button
                  type="button"
                  className="fin-link-btn"
                  onClick={() =>
                    setDraft({
                      key: item.key,
                      title: item.title,
                      text: item.formula ?? "",
                      type: (item.kind ?? "number") as Draft["type"],
                      digits: item.digits ?? 0,
                    })
                  }
                >
                  Изменить
                </button>
                <button type="button" className="fin-link-btn setup-quiet" disabled={action.busy(`remove-${item.key}`)} onClick={() => void remove(item)}>
                  Убрать
                </button>
              </div>
              {action.error(`remove-${item.key}`) ? <p className="setup-error">{action.error(`remove-${item.key}`)}</p> : null}
              {sheets.map((view) =>
                action.error(`sheet-${view.id}-${item.key}`) ? (
                  <p key={view.id} className="setup-error">
                    {action.error(`sheet-${view.id}-${item.key}`)}
                  </p>
                ) : null,
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="setup-summary-meta">Формул пока нет.</p>
      )}

      <form
        className="setup-formula-form"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <label className="setup-summary-field">
          <span>Название</span>
          <input
            id="formula-title"
            type="text"
            className="setup-input"
            value={draft.title}
            placeholder="Оплачено, %"
            onChange={(event) => setDraft({ ...draft, title: event.target.value })}
          />
        </label>
        <label className="setup-summary-field setup-formula-wide">
          <span>Формула</span>
          <input
            id="formula-text"
            type="text"
            className="setup-input fin-mono"
            value={draft.text}
            placeholder="paid / amount * 100"
            onChange={(event) => setDraft({ ...draft, text: event.target.value })}
          />
          <span className="setup-formula-names">{NAMES}</span>
        </label>
        <label className="setup-summary-field">
          <span>Что считает</span>
          <select
            id="formula-kind"
            className="setup-input"
            value={draft.type}
            onChange={(event) => setDraft({ ...draft, type: event.target.value as Draft["type"] })}
          >
            {KINDS.map((kind) => (
              <option key={kind.key} value={kind.key}>
                {kind.title}
              </option>
            ))}
          </select>
        </label>
        <label className="setup-summary-field">
          <span>Знаков после запятой</span>
          <input
            id="formula-digits"
            type="number"
            min={0}
            max={4}
            className="setup-input"
            value={draft.digits}
            onChange={(event) => setDraft({ ...draft, digits: Math.max(0, Math.min(4, Number(event.target.value) || 0)) })}
          />
        </label>
        <div className="setup-formula-acts">
          <button type="submit" className="btn-primary btn-sm" disabled={!draft.title.trim() || !draft.text.trim() || action.busy("save")}>
            {draft.key ? "Сохранить" : "Добавить формулу"}
          </button>
          {draft.key ? (
            <button type="button" className="btn-ghost btn-sm" onClick={() => setDraft(EMPTY)}>
              Отмена
            </button>
          ) : null}
        </div>
        {action.error("save") ? (
          <p className="setup-error" role="alert">
            {action.error("save")}
          </p>
        ) : null}
      </form>
    </section>
  );
}
