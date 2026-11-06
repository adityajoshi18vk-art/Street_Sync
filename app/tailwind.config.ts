import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"]
      },
      colors: {
        ink: {
          950: "#05070d",
          900: "#090d17",
          800: "#0d1322",
          700: "#141c30",
          600: "#1c2742"
        },
        brand: {
          50: "#eef7ff",
          100: "#d9ecff",
          200: "#bcdeff",
          300: "#8ec9ff",
          400: "#59abff",
          500: "#338aff",
          600: "#1b6bf5",
          700: "#1554e1",
          800: "#1845b6",
          900: "#1a3e8f",
          950: "#152857"
        },
        accent: {
          300: "#67e8f9",
          400: "#22d3ee",
          500: "#06b6d4"
        },
        status: {
          open: "#34d399",
          claimed: "#fbbf24",
          submitted: "#a78bfa",
          inreview: "#fb923c",
          approved: "#60a5fa",
          rejected: "#f87171",
          refunded: "#94a3b8"
        }
      },
      boxShadow: {
        card: "0 1px 0 0 rgb(255 255 255 / 0.04) inset, 0 8px 30px -12px rgb(0 0 0 / 0.6)",
        glow: "0 0 0 1px rgb(51 138 255 / 0.25), 0 8px 32px -8px rgb(27 107 245 / 0.55)",
        "glow-sm": "0 4px 20px -6px rgb(27 107 245 / 0.5)"
      },
      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        rise: "rise 0.6s cubic-bezier(0.22, 1, 0.36, 1) both",
        shimmer: "shimmer 1.8s linear infinite",
        float: "float 7s ease-in-out infinite",
        "glow-pulse": "glowPulse 3.5s ease-in-out infinite"
      },
      keyframes: {
        rise: {
          from: { opacity: "0", transform: "translateY(14px)" },
          to: { opacity: "1", transform: "translateY(0)" }
        },
        shimmer: {
          from: { backgroundPosition: "200% 0" },
          to: { backgroundPosition: "-200% 0" }
        },
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-10px)" }
        },
        glowPulse: {
          "0%, 100%": { opacity: "0.55" },
          "50%": { opacity: "1" }
        }
      }
    }
  },
  plugins: []
};

export default config;
