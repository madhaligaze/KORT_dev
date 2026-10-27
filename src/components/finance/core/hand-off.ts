/**
 * Файл, переданный из приёмника в свой разбор: реестр - в «Загрузку реестра»,
 * выписку - в «Загрузку». Только в памяти страницы: после перезагрузки браузер
 * файл не отдаёт, и человек выберет его снова - разбор от этого не меняется.
 */
export type HandOffTarget = "registry" | "statement";

let pending: { target: HandOffTarget; file: File } | null = null;

export function handOff(target: HandOffTarget, file: File): void {
  pending = { target, file };
}

/** Файл, переданный сюда, - не забирая: для первого кадра экрана (StrictMode зовёт его дважды). */
export function peekHandOff(target: HandOffTarget): File | null {
  return pending && pending.target === target ? pending.file : null;
}

/** Забрать файл, если он передан именно сюда; второй вызов вернёт `null`. */
export function takeHandOff(target: HandOffTarget): File | null {
  if (!pending || pending.target !== target) return null;
  const { file } = pending;
  pending = null;
  return file;
}
