/**
 * Expected, user-facing failures. `code` maps to messages `errors.<code>` so the
 * UI can show a translated reason. Anything else is a bug and is logged.
 */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(code);
    this.name = "AppError";
  }
}

export type ActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? { data?: undefined } : { data: T }))
  | { ok: false; code: string; details?: Record<string, unknown>; fieldErrors?: Record<string, string[]> };
