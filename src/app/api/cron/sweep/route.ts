import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runSweep } from "@/server/jobs/sweep";

export const dynamic = "force-dynamic";

/** For external schedulers: POST with `Authorization: Bearer $CRON_SECRET`. */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!secret || given.length !== secret.length || !timingSafeEqual(Buffer.from(given), Buffer.from(secret))) {
    return new NextResponse(null, { status: 401 });
  }
  return NextResponse.json(await runSweep());
}
