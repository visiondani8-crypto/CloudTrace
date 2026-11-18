export function tc(t: number, withMs = false): string {
  if (!Number.isFinite(t)) return "--:--";
  const neg = t < 0;
  t = Math.abs(t);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  const ms = Math.floor((t % 1) * 1000);
  const base = (h ? `${h}:${String(m).padStart(2, "0")}` : `${m}`) + `:${String(s).padStart(2, "0")}`;
  return (neg ? "-" : "") + base + (withMs ? `.${String(ms).padStart(3, "0").slice(0, 2)}` : "");
}

export function bytes(n: number): string {
  if (!n) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
}

export function dur(s: number): string {
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m ${r}s`;
}

export function ago(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso.endsWith("Z") || iso.includes("+") ? iso : iso + "Z").getTime();
  const s = (Date.now() - d) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function clamp(x: number, a: number, b: number) {
  return Math.max(a, Math.min(b, x));
}

export function uid(prefix = "") {
  return prefix + Math.random().toString(16).slice(2, 14);
}

export const PLATFORM_LABELS: Record<string, string> = {
  tiktok: "TikTok", reels: "Instagram Reels", shorts: "YouTube Shorts", facebook: "Facebook Reels", linkedin: "LinkedIn", x: "X", custom: "Custom",
};
export const MODE_LABELS: Record<string, string> = {
  podcast: "Podcast", interview: "Interview", educational: "Educational", gaming: "Gaming", sports: "Sports commentary",
  entertainment: "Entertainment", business: "Business / Finance", custom: "Custom instructions",
};
export const STYLE_LABELS: Record<string, string> = { clean: "Clean Professional", dynamic: "Social Dynamic", cinematic: "Cinematic" };
