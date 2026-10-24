/** Слова «Участников»: подпись номера, число договоров, режим юрлица. */
import type { ParticipantKind, TaxPeriod } from "@/components/finance/api";
import { formatDay, plural } from "@/components/finance/format";

/** У организации - БИН, у ИП и физлица - ИИН. Номера ещё нет - «БИН». */
export function binWord(kind: ParticipantKind): string {
  return kind === "ip" || kind === "person" ? "ИИН" : "БИН";
}

export function kindWord(kind: ParticipantKind): string {
  return { org: "юрлицо", ip: "ИП", person: "физлицо", "": "" }[kind];
}

export function contractsWord(count: number): string {
  return `${count} ${plural(count, "договор", "договора", "договоров")}`;
}

/** «общеустановленный · плательщик НДС» - режим на сегодня; нет записи - так и сказано. */
export function regimeText(period: TaxPeriod | null | undefined, withDate = false): string {
  if (!period) return "режим не записан";
  const head = withDate ? `с ${formatDay(period.valid_from)} ` : "";
  return `${head}${period.regime_title ?? period.regime}${period.vat_payer ? " · плательщик НДС" : " · без НДС"}`;
}

export const REGIMES: { value: TaxPeriod["regime"]; title: string }[] = [
  { value: "general", title: "общеустановленный" },
  { value: "simplified", title: "упрощённая декларация" },
  { value: "other", title: "другой специальный" },
];
