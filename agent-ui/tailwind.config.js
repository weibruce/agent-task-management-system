/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{vue,js,ts}",
  ],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        border: "var(--atms-border)",
        input: "var(--atms-control)",
        ring: "var(--atms-focus-ring)",
        background: "var(--atms-bg)",
        foreground: "var(--atms-text-1)",
        primary: {
          DEFAULT: "var(--atms-accent)",
          foreground: "var(--atms-on-accent)",
        },
        secondary: {
          DEFAULT: "var(--atms-surface-2)",
          foreground: "var(--atms-text-2)",
        },
        destructive: {
          DEFAULT: "var(--atms-danger)",
          foreground: "var(--atms-on-strong)",
        },
        muted: {
          DEFAULT: "var(--atms-surface-1)",
          foreground: "var(--atms-text-3)",
        },
        accent: {
          DEFAULT: "var(--atms-accent-soft)",
          foreground: "var(--atms-accent)",
        },
        popover: {
          DEFAULT: "var(--atms-panel)",
          foreground: "var(--atms-text-1)",
        },
        card: {
          DEFAULT: "var(--atms-surface-1)",
          foreground: "var(--atms-text-1)",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: 0 },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: 0 },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [],
}
