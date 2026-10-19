/**
 * A slash command's id: lower-case ASCII letters, digits and hyphens, starting with a letter, at most
 * 32. Kept apart from the alias table so the URL builder and the query history can check one without
 * loading it.
 */
const commandIdPattern = /^[a-z][a-z0-9-]{0,31}$/;

export function isCommandId(id: unknown): id is string {
  return typeof id === 'string' && commandIdPattern.test(id);
}
