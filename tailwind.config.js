/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,jsx}',
    './components/**/*.{js,jsx}',
    './app/**/*.{js,jsx}',
    './lib/**/*.{js,jsx}',
  ],
  theme: {
    extend: {
      colors: {
        navy: {
          950: '#040912',
          900: '#060b14',
          800: '#080e1d',
          700: '#0d1829',
          600: '#112038',
          500: '#1a2d52',
          400: '#1e3a6e',
        },
        accent: {
          DEFAULT: '#2563eb',
          hover:   '#1d4ed8',
          dim:     '#1e3a8a',
          glow:    'rgba(37,99,235,0.15)',
        },
      },
      fontFamily: {
        sans: ['var(--font-outfit)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'monospace'],
      },
    },
  },
  plugins: [],
}
