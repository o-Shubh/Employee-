import "server-only";
import { AppError, type ActionResult } from "./errors";

/** Wrap a server action body: expected AppErrors become `{ ok: false, code }`, everything else rethrows. */
export async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    return { ok: true, data } as ActionResult<T>;
  } catch (e) {
    if (e instanceof AppError) return { ok: false, code: e.code, details: e.details };
    // Next.js uses thrown errors for redirect()/notFound(); let those through.
    if (e && typeof e === "object" && "digest" in e && String((e as { digest: unknown }).digest).startsWith("NEXT_")) throw e;
    console.error(e);
    return { ok: false, code: "UNEXPECTED" };
  }
}
