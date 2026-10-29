"use client";

/**
 * Финал загрузки: сколько договоров заведено - одним большим числом; сколько
 * договоров, которые KORT уже знал (1С), файл дополнил, - строкой под ним.
 *
 * Число поднимается буквами (`SplitReveal`), строка под ним проявляется
 * следом. Незаведённые строки перечислены с причиной розой: это отказ, и его
 * нельзя пропустить глазами. «Всё заведено» цветом не показывается.
 */
import { plural } from "@/components/finance/format";
import { SplitReveal } from "@/components/motion/split-reveal";

import styles from "./registry-import.module.css";
import { sectionOf, type BlockItem, type EntityItem, type Report } from "./types";

export type ApplyResult = { created: number; updated?: number; failed: { ref: string; error: string }[] };

export function Finale({ result, report, onDone }: { result: ApplyResult; report: Report | null; onDone: () => void }) {
  const blocks = (report ? (sectionOf(report, "blocks")?.items as BlockItem[] | undefined) : undefined) ?? [];
  const entities = (report ? (sectionOf(report, "entities")?.items as EntityItem[] | undefined) : undefined) ?? [];
  // Два написания одного знакомого юрлица - одно юрлицо (как в сводке «Наши юрлица»).
  const own = new Set(entities.filter((item) => item.own).map((item) => item.known ?? item.key)).size;
  const sheets = report?.sheets.length ?? 0;
  const updated = result.updated ?? 0;
  const facts = [
    updated ? `${updated} ${plural(updated, "договор KORT дополнен", "договора KORT дополнены", "договоров KORT дополнены")}` : "",
    own ? `${own} ${plural(own, "наше юрлицо", "наших юрлица", "наших юрлиц")}` : "",
    sheets ? `${sheets} ${plural(sheets, "лист", "листа", "листов")}` : "",
    blocks.length ? `${blocks.length} ${plural(blocks.length, "блок", "блока", "блоков")}` : "",
  ].filter(Boolean);

  return (
    <div className={styles.finale}>
      <SplitReveal key={result.created} as="p" className={`proto-big ${styles.finaleNumber}`}>
        {String(result.created)}
      </SplitReveal>
      <p className={styles.finaleCaption}>
        {plural(result.created, "договор", "договора", "договоров")} в реестре
      </p>
      {facts.length ? <p className={`fin-soft ${styles.finaleFacts}`}>{facts.join(" · ")}</p> : null}
      {result.failed.length ? (
        <div className={styles.finaleFailed}>
          <p className="fin-fail">
            Не заведены: {result.failed.length} {plural(result.failed.length, "строка", "строки", "строк")}
          </p>
          <ul className={styles.rows}>
            {result.failed.map((item) => (
              <li key={item.ref} className={styles.row}>
                <span className="fin-mono">{item.ref}</span>
                <span className={`fin-fail ${styles.grow}`}>{item.error}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className={styles.actions}>
        <button type="button" className="btn-primary" onClick={onDone}>
          К реестру
        </button>
      </div>
    </div>
  );
}
