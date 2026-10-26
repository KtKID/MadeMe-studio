import type { APIRoute } from "astro";
import { handleAPI } from "../../server/api";
export const prerender = false;
export const ALL: APIRoute = (context) => handleAPI(context);
