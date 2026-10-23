const fullTranslationKey = (itemId: string) => `${itemId}:complete`;

export function beginDetailTranslationAttempt(
  attempts: Set<string>,
  itemId: string,
  options: { retry?: boolean } = {},
) {
  const key = fullTranslationKey(itemId);
  if (options.retry) attempts.delete(key);
  if (attempts.has(key)) return false;
  attempts.add(key);
  return true;
}

export function endDetailTranslationSession(
  attempts: Set<string>,
  itemId: string,
) {
  attempts.delete(fullTranslationKey(itemId));
}
