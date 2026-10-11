import { useCallback, useEffect, useState } from "react";

// The user's saved games live in this browser only; no account needed.
const KEY = "game-search:list";

function read(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function write(ids: string[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(ids));
  } catch {
    // Storage full or blocked (private mode): the list just won't persist.
  }
}

const listeners = new Set<(ids: string[]) => void>();
let current = read();

function set(ids: string[]) {
  current = ids;
  write(ids);
  listeners.forEach((l) => l(ids));
}

if (typeof window !== "undefined") {
  // Keep several open tabs in sync.
  window.addEventListener("storage", (e) => {
    if (e.key === KEY) {
      current = read();
      listeners.forEach((l) => l(current));
    }
  });
}

export function useSavedList() {
  const [ids, setIds] = useState(current);
  useEffect(() => {
    listeners.add(setIds);
    return () => void listeners.delete(setIds);
  }, []);

  const has = useCallback((id: string) => ids.includes(id), [ids]);
  const toggle = useCallback((id: string) => {
    set(current.includes(id) ? current.filter((x) => x !== id) : [id, ...current]);
  }, []);
  /** Add many ids at once (e.g. a Steam wishlist import); returns how many were new. */
  const addMany = useCallback((newIds: string[]) => {
    const fresh = newIds.filter((id) => !current.includes(id));
    set([...current, ...fresh]);
    return fresh.length;
  }, []);
  const clear = useCallback(() => set([]), []);

  return { ids, has, toggle, addMany, clear };
}
