import { z } from "zod";
export const Route = z.enum([
  "/studio",
  "/studio/media",
  "/studio/settings",
  "/studio/integrations",
]);
export type StudioRoute = z.infer<typeof Route>;
export const Sample = z
  .object({
    id: z.number().int().nonnegative(),
    label: z.enum(["baseline", "optimized"]),
    from: Route,
    to: Route,
    kind: z.enum(["click", "initial", "history"]),
    group: z.enum(["first-visit", "repeat"]),
    startedAt: z.number().nonnegative(),
    endedAt: z.number().nonnegative().optional(),
    durationMs: z.number().nonnegative().optional(),
    visibleImages: z
      .object({
        count: z.number().int().nonnegative(),
        status: z.enum(["pending", "ready", "failed", "timeout", "superseded"]),
        durationMs: z.number().nonnegative().optional(),
      })
      .strict()
      .optional(),
    status: z.enum([
      "pending",
      "ready",
      "failed",
      "canceled",
      "superseded",
      "timeout",
    ]),
  })
  .strict();
export const State = z
  .object({ version: z.literal(1), samples: z.array(Sample).max(200) })
  .strict();
export type TimingState = z.infer<typeof State>;
export const initialState = (): TimingState => ({ version: 1, samples: [] });
export function restore(raw: string | null): TimingState {
  try {
    return State.parse(JSON.parse(raw || "null"));
  } catch {
    return initialState();
  }
}
export function route(path: string): StudioRoute | null {
  const r = Route.safeParse(path.split(/[?#]/)[0].replace(/\/$/, "") || "/");
  return r.success ? r.data : null;
}
export function finish(
  state: TimingState,
  status: Exclude<z.infer<typeof Sample>["status"], "pending">,
  now: number,
) {
  const current = state.samples.at(-1);
  if (!current || current.status !== "pending") return;
  current.status = status;
  current.endedAt = now;
  current.durationMs = Math.max(0, now - current.startedAt);
}
export function begin(
  state: TimingState,
  from: StudioRoute,
  to: StudioRoute,
  now: number,
  kind: z.infer<typeof Sample>["kind"],
  label: "baseline" | "optimized" = "optimized",
) {
  finish(state, "superseded", now);
  for (const sample of state.samples) {
    if (sample.visibleImages?.status === "pending") {
      sample.visibleImages.status = "superseded";
      sample.visibleImages.durationMs = Math.max(0, now - sample.startedAt);
    }
  }
  const group = state.samples.some((s) => s.to === to)
    ? "repeat"
    : "first-visit";
  const id = (state.samples.at(-1)?.id ?? 0) + 1;
  state.samples.push({
    id,
    label,
    from,
    to,
    kind,
    group,
    startedAt: now,
    status: "pending",
  });
  state.samples = state.samples.slice(-200);
  return id;
}
