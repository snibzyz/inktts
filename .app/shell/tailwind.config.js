/** @type {import('tailwindcss').Config} */
// Token set จาก INKIDEA hub — รักษา UX ให้สม่ำเสมอข้ามแอป
module.exports = {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Tahoma', '"Segoe UI"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', '"Cascadia Code"', 'Consolas', 'monospace'],
      },
      borderRadius: {
        mac: '12px',
        'mac-sm': '8px',
        'mac-md': '12px',
        'mac-lg': '16px',
      },
      keyframes: {
        'progress-slide': {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(400%)' },
        },
        'ink-pulse': {
          '0%': { boxShadow: '0 0 0 0 rgb(0 127 212 / 0.75)' },
          '50%': { boxShadow: '0 0 0 4px rgb(0 127 212 / 0.32)' },
          '100%': { boxShadow: '0 0 0 0 rgb(0 127 212 / 0)' },
        },
      },
      animation: {
        'progress-slide': 'progress-slide 1.4s ease-in-out infinite',
        'ink-pulse': 'ink-pulse 1s ease-out 3',
      },
      colors: {
        vscode: {
          editor: 'rgb(30 30 30 / <alpha-value>)',
          sidebar: 'rgb(24 24 24 / <alpha-value>)',
          titlebar: 'rgb(30 30 30 / <alpha-value>)',
          surface: 'rgb(37 37 38 / <alpha-value>)',
          border: 'rgb(43 43 43 / <alpha-value>)',
          muted: 'rgb(133 133 133 / <alpha-value>)',
          fg: 'rgb(204 204 204 / <alpha-value>)',
          'fg-bright': 'rgb(224 224 224 / <alpha-value>)',
          'fg-dim': 'rgb(160 160 160 / <alpha-value>)',
          accent: 'rgb(14 99 156 / <alpha-value>)',
          'accent-hover': 'rgb(17 119 187 / <alpha-value>)',
          'list-hover': 'rgb(42 45 46 / <alpha-value>)',
          'list-active': 'rgb(55 55 61 / <alpha-value>)',
          focus: 'rgb(0 127 212 / <alpha-value>)',
          input: 'rgb(49 49 49 / <alpha-value>)',
          'input-border': 'rgb(60 60 60 / <alpha-value>)',
          button: 'rgb(58 61 65 / <alpha-value>)',
          'button-hover': 'rgb(69 73 78 / <alpha-value>)',
          'section-header-bg': 'rgb(21 21 21 / <alpha-value>)',
          'section-header-border': 'rgb(43 43 43 / <alpha-value>)',
          error: 'rgb(244 135 113 / <alpha-value>)',
          'error-bg': 'rgb(90 29 29 / <alpha-value>)',
          warning: 'rgb(204 167 0 / <alpha-value>)',
          'warning-bg': 'rgb(61 47 0 / <alpha-value>)',
          info: 'rgb(55 148 255 / <alpha-value>)',
          'info-bg': 'rgb(9 71 113 / <alpha-value>)',
          success: 'rgb(137 209 133 / <alpha-value>)',
          statusbar: 'rgb(0 122 204 / <alpha-value>)',
          track: 'rgb(58 58 58 / <alpha-value>)',
        },
      },
    },
  },
  darkMode: 'class',
  plugins: [],
};
