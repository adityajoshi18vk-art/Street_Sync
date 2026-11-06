"use client";

import { useCallback, useEffect, useState } from "react";
import { getBountyReport, type BountyReport } from "./api";

/** Loads the reporter's problem photo + description; `report` stays null while missing (404). */
export function useBountyReport(bountyId: string | undefined) {
  const [report, setReport] = useState<BountyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!bountyId) return;
    setLoading(true);
    try {
      setReport(await getBountyReport(bountyId));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [bountyId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { report, loading, error, reload };
}
