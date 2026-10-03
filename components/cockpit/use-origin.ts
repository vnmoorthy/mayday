"use client";

import { useSyncExternalStore } from "react";

const ENV_ORIGIN = (process.env.NEXT_PUBLIC_SITE_URL ?? "").trim().replace(/\/+$/, "");
const subscribe = () => () => {};

// Origin used in snippets: NEXT_PUBLIC_SITE_URL when set, otherwise wherever
// this page is being served from.
export function useOrigin(): string {
  return useSyncExternalStore(
    subscribe,
    () => ENV_ORIGIN || window.location.origin,
    () => ENV_ORIGIN || "http://localhost:3000",
  );
}
