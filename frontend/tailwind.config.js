/** @type {import('tailwindcss').Config} */
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`

module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Historical names kept so every page picks up the new palette at once
        'yt-bg':             token('yt-bg'),
        'yt-secondary':      token('yt-secondary'),
        'yt-hover':          token('yt-hover'),
        'yt-text':           token('yt-text'),
        'yt-text-secondary': token('yt-text-secondary'),
        'yt-text-muted':     token('yt-text-muted'),
        'yt-red':            token('yt-red'),
        'yt-red-hover':      token('yt-red-hover'),
        'yt-border':         token('yt-border'),
        surface:             token('surface'),
        accent:              token('yt-red'),
        'accent-2':          token('accent-2'),
        // Coral-red scale: hard-coded red-* utilities follow the brand accent
        red: {
          50: '#fff1f2', 100: '#ffe1e3', 200: '#ffc8cc', 300: '#ffa0a8', 400: '#ff6b78',
          500: '#ff4757', 600: '#f02e45', 700: '#cc1f37', 800: '#a81d33', 900: '#8c1c31', 950: '#4e0a16',
        },
      },
      fontFamily: {
        sans: ['"Inter Variable"', 'Inter', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', 'sans-serif'],
        display: ['"Bricolage Grotesque Variable"', '"Inter Variable"', '-apple-system', 'sans-serif'],
      },
      backgroundImage: {
        'accent-gradient': 'linear-gradient(135deg, rgb(var(--yt-red)) 0%, rgb(var(--accent-2)) 100%)',
        'scrim-b': 'linear-gradient(to top, rgb(var(--yt-bg)) 0%, rgb(var(--yt-bg) / 0.6) 35%, transparent 75%)',
        'scrim-r': 'linear-gradient(to right, rgb(var(--yt-bg)) 0%, rgb(var(--yt-bg) / 0.7) 35%, transparent 70%)',
      },
      boxShadow: {
        glow: '0 0 0 1px rgb(var(--yt-red) / 0.35), 0 10px 36px -10px rgb(var(--yt-red) / 0.6)',
        card: '0 18px 48px -18px rgb(0 0 0 / 0.65)',
        elevated: '0 30px 80px -24px rgb(0 0 0 / 0.75)',
      },
      borderRadius: {
        '4xl': '2rem',
      },
      keyframes: {
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(14px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        'ken-burns': {
          from: { transform: 'scale(1.06) translate3d(0, 0, 0)' },
          to: { transform: 'scale(1.16) translate3d(-2%, -1.5%, 0)' },
        },
        'pulse-ring': {
          '0%': { boxShadow: '0 0 0 0 rgb(var(--yt-red) / 0.55)' },
          '100%': { boxShadow: '0 0 0 10px rgb(var(--yt-red) / 0)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.6s cubic-bezier(0.2, 0.7, 0.2, 1) both',
        'fade-in': 'fade-in 0.4s ease-out both',
        shimmer: 'shimmer 1.6s infinite',
        'ken-burns': 'ken-burns 28s ease-in-out infinite alternate',
        'pulse-ring': 'pulse-ring 1.6s ease-out infinite',
      },
    },
  },
  plugins: [],
}
