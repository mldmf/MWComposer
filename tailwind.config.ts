import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          green: "#96f74b",
          pink: "#f910cd",
          purple: "#674ed1",
        },
      },
    },
  },
  plugins: [],
}
export default config