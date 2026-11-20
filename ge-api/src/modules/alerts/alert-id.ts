/** Parse `sender|identifier|sentIso` built by `buildAlertId`. */
export function parseAlertId(id: string): {
  sender: string;
  identifier: string;
  sentIso: string;
} {
  const parts = id.split('|');
  if (parts.length < 3) {
    throw new Error(`Alert id is not sender|identifier|sent: ${id}`);
  }
  const sentIso = parts[parts.length - 1];
  const identifier = parts[parts.length - 2];
  const sender = parts.slice(0, -2).join('|');
  if (!sender || !identifier || !sentIso) {
    throw new Error(`Alert id is not sender|identifier|sent: ${id}`);
  }
  return { sender, identifier, sentIso };
}

const TIER_RANK: Record<string, number> = { A: 4, B: 3, C: 2, D: 1 };

export function tierRank(tier: string | null | undefined): number {
  return TIER_RANK[tier?.trim() ?? ''] ?? 0;
}
