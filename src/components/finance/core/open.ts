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
