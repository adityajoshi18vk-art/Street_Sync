import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
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
        status: {
          open: "#22c55e",
          claimed: "#eab308",
          submitted: "#8b5cf6",
          inreview: "#f97316",
          approved: "#3b82f6",
          rejected: "#ef4444",
          refunded: "#6b7280"
        }
      },
      boxShadow: {
        card: "0 1px 3px 0 rgb(0 0 0 / 0.08), 0 4px 14px -4px rgb(0 0 0 / 0.12)"
      },
      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite"
      }
    }
  },
  plugins: []
};

export default config;
