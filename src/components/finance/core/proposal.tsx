"use client";

/**
 * Кнопки предложения сверки с книгой-сводкой (`core/shadow.py`): «Записать»,
 * а у вопроса - два ответа («С этого месяца» или «Только этот месяц»;
 * «Закончился» или «Стоит»; статусы компании). Одни и те же в карточке
 * договора и в «Сверке»; в «Сверке» - ещё и «Верно у KORT»: ошиблась таблица,
 * договор под неё не подгоняется.
 */
import { useState } from "react";

import { type ShadowProposal, coreApi } from "@/components/finance/api";

const OPTION_TITLES: Record<string, string> = {
  from: "С этого месяца",
  month: "Только этот месяц",
  end: "Закончился",
  pause: "Стоит",
};

export type Verified = { text: string; batch: string; done: number };

export function ProposalActions({
  proposal,
  disabled,
  onApplied,
  onVerified,
}: {
  proposal: ShadowProposal;
  disabled?: boolean;
  onApplied: (text: string) => void;
  /** Есть - показать «Верно у KORT»: решение сверки, его принимает владелец или администратор. */
  onVerified?: (result: Verified) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const act = async <T,>(call: () => Promise<T>, done: (result: T) => void) => {
    setBusy(true);
    setError("");
    try {
      done(await call());
    } catch (exc) {
      setError(exc instanceof Error && exc.message ? exc.message : "Не записалось");
    } finally {
      setBusy(false);
    }
  };
  const run = (option: string) =>
    act(
      () =>
        coreApi.apply({
          contract_id: proposal.contract_id,
          kind: proposal.kind,
          value: proposal.value,
          option: option || undefined,
        }),
      (result) => onApplied(result.text),
    );
  const options = proposal.options.length ? proposal.options : [""];
  const title = (option: string) => (option ? (proposal.labels?.[option] ?? OPTION_TITLES[option] ?? option) : "Записать");
  const answers = options.map((option) => ({ key: option || "write", title: title(option), go: () => run(option) }));
  if (onVerified && proposal.months.length) {
    answers.push({
      key: "verify",
      title: "Верно у KORT",
      go: () => act(() => coreApi.verifyProposal(proposal.contract_id, proposal.months), onVerified),
    });
  }
  return (
    <span className="shadow-acts">
      {/* Точка - в конце ответа, а не в начале следующего: перенесённая строка начинается с кнопки. */}
      {answers.map((answer, index) => (
        <span key={answer.key}>
          <button type="button" className="fin-link-btn" disabled={busy || disabled} onClick={answer.go}>
            {answer.title}
          </button>
          {index < answers.length - 1 ? <span className="fin-muted"> · </span> : null}
        </span>
      ))}
      {error ? <span className="shadow-error">{error}</span> : null}
    </span>
  );
}
