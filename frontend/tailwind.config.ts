import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0B0E14",
        sidebar: "#11151D",
        surface: "#181D27",
        raised: "#202633",
        line: "#303848",
        fg: "#F4F6FA",
        sub: "#9AA6B8",
        muted: "#697586",
        accent: { DEFAULT: "#5B8CFF", hover: "#79A2FF" },
        ok: "#39B98A",
        warn: "#E8AD52",
        err: "#E46B73",
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["Space Grotesk", "Inter", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      fontSize: { "2xs": ["0.6875rem", "1rem"] },
      borderRadius: { md: "8px", lg: "10px", xl: "12px" },
      boxShadow: { panel: "0 1px 0 rgba(255,255,255,0.02) inset, 0 8px 24px rgba(0,0,0,0.25)" },
    },
  },
  plugins: [],
} satisfies Config;
