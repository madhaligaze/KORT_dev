"use client";

/**
 * Кнопки предложения сверки с книгой-сводкой (`core/shadow.py`): «Записать»,
 * а у вопроса - два ответа («С этого месяца» или «Только этот месяц»;
 * «Закончился» или «Стоит»). Одни и те же в карточке договора и в «Сверке».
 */
import { useState } from "react";

import { type ShadowProposal, coreApi } from "@/components/finance/api";

const OPTION_TITLES: Record<string, string> = {
  from: "С этого месяца",
  month: "Только этот месяц",
  end: "Закончился",
  pause: "Стоит",
};

export function ProposalActions({
  proposal,
  disabled,
  onApplied,
}: {
  proposal: ShadowProposal;
  disabled?: boolean;
  onApplied: (text: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async (option: string) => {
    setBusy(true);
    setError("");
    try {
      const result = await coreApi.apply({
        contract_id: proposal.contract_id,
        kind: proposal.kind,
        value: proposal.value,
        option: option || undefined,
      });
      onApplied(result.text);
    } catch (exc) {
      setError(exc instanceof Error && exc.message ? exc.message : "Не записалось");
    } finally {
      setBusy(false);
    }
  };
  const options = proposal.options.length ? proposal.options : [""];
  return (
    <span className="shadow-acts">
      {options.map((option, index) => (
        <span key={option || "write"}>
          {index ? <span className="fin-muted"> · </span> : null}
          <button type="button" className="fin-link-btn" disabled={busy || disabled} onClick={() => run(option)}>
            {option ? OPTION_TITLES[option] ?? option : "Записать"}
          </button>
        </span>
      ))}
      {error ? <span className="shadow-error">{error}</span> : null}
    </span>
  );
}
