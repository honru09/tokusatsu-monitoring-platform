import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: "#1d1d1f",
        paper: "#f4f4f5",
        page: "#f4f4f5",
        surface: "#ffffff",
        moss: "#0071e3",
        lime: "#64d2ff",
        rust: "#ff3b30",
        fog: "#e8e8ed",
        "hero-start": "#0a1526",
        "hero-end": "#0066ff",
        "brick-dark": "#101014",
        "label-muted": "#8e8e93",
        "positive-green": "#34c759",
        blue: {
          50: "#f0f7ff",
          100: "#e3f0ff",
          200: "#c5dfff",
          300: "#8ec5ff",
          800: "#0055b3",
        },
        amber: {
          50: "#fff8ec",
          100: "#ffedcc",
          200: "#ffd89a",
          300: "#ffc766",
          400: "#ffb340",
          500: "#ff9f0a",
          700: "#b85f00",
          800: "#8a4700",
          900: "#643500",
        },
        emerald: {
          50: "#eefbf2",
          100: "#dcf7e4",
          400: "#34c759",
          800: "#248a3d",
        },
      },
      fontFamily: {
        heading: ["var(--font-heading)"],
        sans: ["var(--font-sans)"],
        mono: ["var(--font-mono)"],
      },
      borderRadius: {
        hero: "28px",
        brick: "20px",
        capsule: "9999px",
      },
      boxShadow: {
        panel: "0 1px 2px rgba(0, 0, 0, .04), 0 8px 24px rgba(0, 0, 0, .05)",
        modal: "0 24px 70px rgba(0, 0, 0, .20)",
      },
    },
  },
  plugins: [],
} satisfies Config;
