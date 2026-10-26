import type { APIRoute } from "astro";
import { healthSchema } from "../../shared/foundation";

export const GET: APIRoute = () =>
  Response.json(
    healthSchema.parse({
      status: "ok",
      service: "MadeMe Studio",
      version: "0.1.0",
    }),
  );
