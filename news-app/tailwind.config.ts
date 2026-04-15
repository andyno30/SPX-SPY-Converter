import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      boxShadow: {
        card: "0 6px 24px -14px rgba(15, 23, 42, 0.28)",
      },
      colors: {
        canvas: "#f6f8fb",
      },
    },
  },
  plugins: [],
};

export default config;
