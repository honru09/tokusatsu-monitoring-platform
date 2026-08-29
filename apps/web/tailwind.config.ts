import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0f172a",
        paper: "#f8fafc",
        moss: "#1e40af",
        lime: "#d97706",
        rust: "#dc2626",
        fog: "#e9eef6",
      },
      fontFamily: {
        heading: ['"Fira Code"', '"Noto Sans SC"', "monospace"],
        sans: ['"Fira Sans"', '"Noto Sans SC"', '"Hiragino Sans"', "sans-serif"],
        mono: ['"Fira Code"', '"SFMono-Regular"', "Consolas", "monospace"],
      },
      boxShadow: {
        panel: "0 8px 28px rgba(15, 23, 42, .08)",
        modal: "0 24px 70px rgba(15, 23, 42, .22)",
      },
    },
  },
  plugins: [],
} satisfies Config;
