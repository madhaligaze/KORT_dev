/**
 * Досье участника открывается из любого места - из карточки договора, из
 * досье другого участника: раздел «Участники» встаёт сам (`finance-client.tsx`),
 * а досье открывается по `p` в адресе. Событие, а не проброс колбэка: карточку
 * договора рисуют пять экранов, и каждому пришлось бы знать про участников.
 */
export const PARTICIPANT_EVENT = "kort:participant";

export function openParticipant(id: string): void {
  if (typeof window === "undefined" || !id) return;
  window.dispatchEvent(new CustomEvent<string>(PARTICIPANT_EVENT, { detail: id }));
}

/**
 * Раздел с уже выбранным списком - из любого места (досье ТОО, карточка):
 * `session` - значения состояния экрана (ключи `useSessionState`), которые
 * раздел прочтёт при открытии. Тем же событием, что и досье, - по той же причине.
 */
export const SECTION_EVENT = "kort:section";

export type SectionGo = { section: string; session?: Record<string, string> };

export function openSection(go: SectionGo): void {
  if (typeof window === "undefined" || !go.section) return;
  window.dispatchEvent(new CustomEvent<SectionGo>(SECTION_EVENT, { detail: go }));
}

/**
 * Виды изменились (сохранён, закреплён, убран - `core/views.py`): колонка
 * разделов перечитывает их сразу, а не со следующей сменой схемы.
 */
export const VIEWS_EVENT = "kort:views";

export function viewsChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(VIEWS_EVENT));
}
