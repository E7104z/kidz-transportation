/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  safelist: [
    // Dynamically applied status colours for booking/incident/document cards
    { pattern: /bg-(green|amber|red|orange|blue|indigo|teal|violet|slate|emerald|rose)-(50|100|200|500|600|700)/ },
    { pattern: /text-(green|amber|red|orange|blue|indigo|teal|violet|slate|emerald|rose)-(500|600|700|800)/ },
    { pattern: /border-(green|amber|red|orange|blue|indigo|teal|violet|slate|emerald|rose)-(200|300|400)/ },
    { pattern: /ring-(green|amber|red|orange|blue|indigo|teal|violet|slate|emerald|rose)-(400|500)/ },
    // Severity badge combos used in IncidentForm
    'bg-emerald-100', 'text-emerald-700', 'border-emerald-300',
    'bg-amber-100',   'text-amber-700',   'border-amber-300',
    'bg-orange-100',  'text-orange-700',  'border-orange-300',
    'bg-red-100',     'text-red-700',     'border-red-300',
    // ShiftControls status pills
    'bg-green-100', 'text-green-700',
    'bg-amber-50',  'text-amber-700',
    'bg-red-50',    'text-red-700',
    // ImpersonationBanner
    'bg-amber-500',
    // NotificationBell priority
    'bg-red-500',
  ],
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