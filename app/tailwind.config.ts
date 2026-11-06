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
          950: "#050506",
          900: "#0b0b0e",
          800: "#131318",
          700: "#1b1b22",
          600: "#2a2a33"
        },
        // "Signal" lime: high-visibility street-marking green; pair with dark text on fills
        brand: {
          50: "#fbfff0",
          100: "#f7fee7",
          200: "#ecfccb",
          300: "#d9f99d",
          400: "#bef264",
          500: "#a3e635",
          600: "#84cc16",
          700: "#65a30d",
          800: "#4d7c0f",
          900: "#3f6212",
          950: "#1a2e05"
        },
        accent: {
          300: "#c4b5fd",
          400: "#a78bfa",
          500: "#8b5cf6"
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
        glow: "0 0 0 1px rgb(190 242 100 / 0.35), 0 10px 36px -10px rgb(163 230 53 / 0.55)",
        "glow-sm": "0 4px 22px -8px rgb(163 230 53 / 0.5)"
      },
      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        rise: "rise 0.6s cubic-bezier(0.22, 1, 0.36, 1) both",
        shimmer: "shimmer 1.8s linear infinite",
        float: "float 7s ease-in-out infinite",
        "glow-pulse": "glowPulse 3.5s ease-in-out infinite",
        aurora: "aurora 18s ease-in-out infinite alternate",
        marquee: "marquee 40s linear infinite"
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
        },
        aurora: {
          "0%": { transform: "translate3d(-6%, -4%, 0) scale(1) rotate(0deg)" },
          "50%": { transform: "translate3d(5%, 6%, 0) scale(1.15) rotate(12deg)" },
          "100%": { transform: "translate3d(-3%, 8%, 0) scale(0.95) rotate(-8deg)" }
        },
        marquee: {
          from: { transform: "translateX(0)" },
          to: { transform: "translateX(-50%)" }
        }
      }
    }
  },
  plugins: []
};

export default config;
