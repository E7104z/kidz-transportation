/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        kidz: {
          navy: '#1a2e4a',
          blue: '#2563eb',
          blueLight: '#dbeafe',
          amber: '#f59e0b',
          amberLight: '#fef3c7',
          green: '#10b981',
          red: '#ef4444',
          gray: '#f1f5f9',
          surface: '#ffffff',
          border: '#e2e8f0',
          textPrimary: '#0f172a',
          textSecondary: '#475569',
          textMuted: '#94a3b8',
        },
      },
    },
  },
  plugins: [],
};