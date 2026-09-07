"use client";

import { useEffect, useState } from "react";
import { REPLAY_MODELS } from "@/lib/replay/models";

/**
 * The effective replay model list for this deployment.
 *
 * Starts from the build-time constant so the control renders immediately and
 * the hosted service — where the two lists are identical — never flickers, then
 * replaces it with the server's list, which is the only place an air-gapped
 * operator's own models exist.
 *
 * A failed fetch keeps the built-in list rather than emptying the dropdown: a
 * momentarily stale set of options is a far better failure than a control with
 * nothing in it and no explanation.
 */
export function useReplayModels(): string[] {
  const [models, setModels] = useState<string[]>([...REPLAY_MODELS]);

  useEffect(() => {
    let live = true;
    fetch("/api/replay/models")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (live && Array.isArray(d?.models) && d.models.length) setModels(d.models);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  return models;
}
