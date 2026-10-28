"use client";

/**
 * «Виды»: из чего собрана колонка разделов (этап 2, шаг 6, `core/views.py`).
 *
 * Вид - сохранённый вопрос к ядру: отбор, меры, группировки, форма, владелец.
 * «Реестр», «Долги», «Разовые ЮО» - виды, а не разделы, зашитые в код. Здесь
 * виды переименовывают, ставят в колонку всем или только владельцу, двигают
 * и убирают; новый вид сохраняют из шаблона отрасли - на компанию или на
 * отдел («Разовые договоры по возрасту долга» отдел сохраняет себе).
 *
 * Листы вида договоров правятся на вкладке «Листы», как листы реестра.
 */
import { useCallback, useEffect, useMemo, useState } from "react";

import { type CoreView, type ViewChange, type ViewsList, coreApi } from "@/components/finance/api";
import { useRegistry } from "@/components/finance/contracts/store";
import { viewsChanged } from "@/components/finance/core/open";
import { ArrowDownIcon, ArrowUpIcon } from "@/components/icons";
import { ConfirmDialog } from "@/components/finance/ui/confirm-dialog";
import { InlineText } from "@/components/finance/contracts/setup/inline-text";
import { tip } from "@/components/finance/contracts/setup/tip";
import { errorText, useSetupAction } from "@/components/finance/contracts/setup/use-setup-action";

const PINS: { key: CoreView["pin"]; title: string; tip: string }[] = [
  { key: "all", title: "всем", tip: "Пункт в колонке у каждого, кому открыты данные вида" },
  { key: "owner", title: "владельцу", tip: "Пункт в колонке у людей отдела-владельца; остальным - в «Ещё»" },
  { key: "", title: "нет", tip: "Вид открывается из «Ещё» и поиска (Ctrl+K)" },
];

function ownerText(view: CoreView): string {
  if (view.owner.kind === "department") return view.owner.code || view.owner.title || "отдел";
  if (view.owner.kind === "user") return "мой";
  return "компания";
}

export function SavedViewsTab() {
  const schema = useRegistry((s) => s.schema);
  const action = useSetupAction();
  const [data, setData] = useState<ViewsList | null>(null);
  const [loadError, setLoadError] = useState("");
  const [owners, setOwners] = useState<Record<string, string>>({});
  const [dropping, setDropping] = useState<CoreView | null>(null);
  /** Где встал только что сохранённый вид, если не в колонке у того, кто сохранил. */
  const [savedNote, setSavedNote] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      setData(await coreApi.views());
      setLoadError("");
    } catch (exc) {
      setLoadError(errorText(exc));
    }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- виды читаются с сервера при открытии вкладки
    void load();
  }, [load, schema?.schema_rev]);

  const views = useMemo(() => [...(data?.views ?? [])].sort((a, b) => a.position - b.position), [data]);
  const departments = schema?.departments ?? [];
  const sources = data?.sources;

  /** Правка вида: записать, перечитать вкладку и колонку разделов. */
  const change = (key: string, view: CoreView, next: ViewChange, text: string, back: ViewChange) =>
    action.run(
      key,
      async () => {
        await coreApi.viewUpdate(view.id, next);
        await load();
        viewsChanged();
      },
      "schema",
      {
        text,
        revert: async () => {
          await coreApi.viewUpdate(view.id, back);
          viewsChanged();
        },
      },
    );

  const move = async (index: number, dir: -1 | 1) => {
    const one = views[index];
    const other = views[index + dir];
    if (!one || !other) return;
    const a = one.position;
    const b = other.position === a ? a + dir : other.position;
    await action.run(`move:${one.id}`, async () => {
      await coreApi.viewUpdate(one.id, { position: b });
      await coreApi.viewUpdate(other.id, { position: a });
      await load();
      viewsChanged();
    });
  };

  const save = async (template: string, owner: string) => {
    await action.run(`save:${template}`, async () => {
      const made = await coreApi.viewCreate({ template, owner: owner ? { department: owner } : "company" });
      await load();
      viewsChanged();
      // Вид отдела стоит в колонке у людей отдела; у сохранившего не из отдела - в «Ещё».
      const code = made.owner.kind === "department" ? made.owner.code : "";
      setSavedNote((value) => ({
        ...value,
        [template]: made.pinned ? "" : `«${made.title}» - в колонке у людей отдела ${code}; у вас - в «Ещё»`,
      }));
    });
  };

  if (!schema) return null;
  return (
    <div className="setup-views-saved">
      {loadError ? (
        <p className="setup-error" role="alert">
          {loadError}
        </p>
      ) : null}
      <div className="setup-vrow setup-vhead" aria-hidden="true">
        <span className="eyebrow">Вид</span>
        <span className="eyebrow">Что</span>
        <span className="eyebrow">Чей</span>
        <span className="eyebrow">В колонке</span>
        <span />
      </div>
      {views.map((view, index) => {
        const errors = ["title", "pin", "move", "drop"].map((slot) => action.error(`${slot}:${view.id}`)).filter(Boolean);
        const sheets = view.source === "contracts" ? schema.views.filter((item) => (item.book ?? "") === view.key).length : 0;
        const groups = (view.groups ?? []).map((key) => sources?.[view.source]?.groups.find((item) => item.key === key)?.title ?? key);
        const extra = [
          sheets ? `листов: ${sheets}` : "",
          ...groups,
          view.owner.kind === "department" && view.measures.includes("share") ? `сумма - доля ${view.owner.code}` : "",
        ].filter(Boolean);
        return (
          <div key={view.id} className="setup-vrow">
            <span className="setup-vname">
              <InlineText
                value={view.title}
                maxLength={120}
                label={`Название вида «${view.title}»`}
                disabled={!view.editable}
                trace={action.trace(`title:${view.id}`)}
                onCommit={(next) => {
                  if (!next.trim() || next === view.title || !view.editable) return;
                  void change(`title:${view.id}`, view, { title: next }, `Вид «${view.title}» - «${next}»`, { title: view.title });
                }}
              />
              {extra.length ? <span className="setup-vnote">{extra.join(" · ")}</span> : null}
            </span>
            <span className="setup-vsource" data-label="Что">
              {sources?.[view.source]?.title ?? view.source}
            </span>
            <span className="setup-vowner" data-label="Чей" data-code={view.owner.kind === "department" ? "true" : undefined}>
              {ownerText(view)}
            </span>
            <span className="setup-vpin" role="radiogroup" aria-label={`Кому «${view.title}» в колонке`}>
              {PINS.filter((item) => item.key !== "owner" || view.owner.kind !== "company").map((item) => (
                <button
                  key={item.key || "none"}
                  type="button"
                  role="radio"
                  className="setup-toggle"
                  aria-checked={view.pin === item.key}
                  data-on={view.pin === item.key ? "true" : undefined}
                  disabled={!view.editable || action.busy(`pin:${view.id}`)}
                  {...tip(item.tip)}
                  onClick={() => {
                    if (view.pin === item.key) return;
                    void change(
                      `pin:${view.id}`,
                      view,
                      { pin: item.key },
                      `«${view.title}» в колонке: ${item.title}`,
                      { pin: view.pin },
                    );
                  }}
                >
                  {item.title}
                </button>
              ))}
            </span>
            <span className="setup-vaction">
              <button
                type="button"
                className="fin-icon-btn setup-move-btn"
                aria-label={`«${view.title}» выше в колонке`}
                disabled={!index || action.busy(`move:${view.id}`)}
                onClick={() => void move(index, -1)}
              >
                <ArrowUpIcon size={14} />
              </button>
              <button
                type="button"
                className="fin-icon-btn setup-move-btn"
                aria-label={`«${view.title}» ниже в колонке`}
                disabled={index === views.length - 1 || action.busy(`move:${view.id}`)}
                onClick={() => void move(index, 1)}
              >
                <ArrowDownIcon size={14} />
              </button>
              {view.key && view.editable ? (
                <button type="button" className="fin-link-btn" onClick={() => setDropping(view)}>
                  Убрать
                </button>
              ) : null}
            </span>
            {errors.length ? <p className="setup-vnote setup-error">{errors[0]}</p> : null}
          </div>
        );
      })}

      <h3 className="setup-vtitle">Из шаблона</h3>
      {(data?.templates ?? [])
        .filter((item) => item.key !== "registry")
        .map((template) => {
          const owner = owners[template.key] ?? (template.department ? departments[0]?.id ?? "" : "");
          const missing = template.department && !owner;
          return (
            <div key={template.key} className="setup-vtemplate">
              <span className="setup-vname">
                <span className="setup-vname-main">{template.title}</span>
                <span className="setup-vnote">{template.note}</span>
              </span>
              <span className="setup-vpin" role="radiogroup" aria-label={`Чей вид «${template.title}»`}>
                {template.department ? null : (
                  <button
                    type="button"
                    role="radio"
                    className="setup-toggle"
                    aria-checked={!owner}
                    data-on={!owner ? "true" : undefined}
                    onClick={() => setOwners((value) => ({ ...value, [template.key]: "" }))}
                  >
                    компания
                  </button>
                )}
                {departments.map((department) => (
                  <button
                    key={department.id}
                    type="button"
                    role="radio"
                    className="setup-toggle"
                    aria-checked={owner === department.id}
                    data-on={owner === department.id ? "true" : undefined}
                    {...tip(department.title || department.code)}
                    onClick={() => setOwners((value) => ({ ...value, [template.key]: department.id }))}
                  >
                    {department.code}
                  </button>
                ))}
              </span>
              <span className="setup-vaction">
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  disabled={Boolean(missing) || action.busy(`save:${template.key}`)}
                  onClick={() => void save(template.key, owner)}
                >
                  Сохранить
                </button>
              </span>
              {missing ? <p className="setup-vnote">Вид отдела: сначала заведите отдел</p> : null}
              {savedNote[template.key] ? <p className="setup-vnote">{savedNote[template.key]}</p> : null}
              {action.error(`save:${template.key}`) ? (
                <p className="setup-vnote setup-error" role="alert">
                  {action.error(`save:${template.key}`)}
                </p>
              ) : null}
            </div>
          );
        })}

      {dropping ? (
        <ConfirmDialog
          open
          title={`Убрать вид «${dropping.title}»?`}
          text={
            dropping.source === "contracts"
              ? "Уйдут вид и его листы. Договоры остаются в реестре, как были."
              : "Вид уйдёт из колонки и «Ещё». Данные не меняются."
          }
          confirm="Убрать"
          onCancel={() => setDropping(null)}
          onConfirm={async () => {
            const view = dropping;
            setDropping(null);
            await action.run(`drop:${view.id}`, async () => {
              await coreApi.viewRemove(view.id);
              await load();
              viewsChanged();
            });
          }}
        />
      ) : null}
    </div>
  );
}
