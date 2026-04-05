/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        'yt-bg':             'rgb(var(--yt-bg) / <alpha-value>)',
        'yt-secondary':      'rgb(var(--yt-secondary) / <alpha-value>)',
        'yt-hover':          'rgb(var(--yt-hover) / <alpha-value>)',
        'yt-text':           'rgb(var(--yt-text) / <alpha-value>)',
        'yt-text-secondary': 'rgb(var(--yt-text-secondary) / <alpha-value>)',
        'yt-text-muted':     'rgb(var(--yt-text-muted) / <alpha-value>)',
        'yt-red':            'rgb(var(--yt-red) / <alpha-value>)',
        'yt-red-hover':      'rgb(var(--yt-red-hover) / <alpha-value>)',
        'yt-border':         'rgb(var(--yt-border) / <alpha-value>)',
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Roboto',
          'Helvetica',
          'Arial',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
}
