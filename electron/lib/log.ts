// Minimal logger. Never pass full URLs, file paths or personal data here:
// callers log error codes and the sanitized tool detail only.
const stamp = () => new Date().toISOString()

export const log = {
  info: (...a: unknown[]) => console.log(stamp(), '[info]', ...a),
  warn: (...a: unknown[]) => console.warn(stamp(), '[warn]', ...a),
  error: (...a: unknown[]) => console.error(stamp(), '[error]', ...a)
}
