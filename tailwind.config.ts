import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Muecards — Coleccionista / Premium dark palette
        ink: {
          950: '#0b0a08', // deep warm black
          900: '#131210',
          800: '#1c1a17',
          700: '#26231f',
          600: '#322e28',
          500: '#4a443c',
        },
        parchment: {
          50: '#faf6ec',
          100: '#f0e9d6',
          200: '#d9cfb6',
          300: '#b8ac91',
          400: '#8f846c',
        },
        gold: {
          300: '#f1cc85',
          400: '#e4b062',
          500: '#c8934a',
          600: '#9d7135',
        },
        ember: {
          500: '#c0563b',
        },
      },
      fontFamily: {
        serif: ['"Cormorant Garamond"', 'Georgia', 'serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 0 rgba(244, 220, 170, 0.04) inset, 0 20px 40px -20px rgba(0,0,0,0.8)',
        gold: '0 0 0 1px rgba(228,176,98,0.35), 0 10px 30px -10px rgba(228,176,98,0.25)',
      },
    },
  },
  plugins: [],
};

export default config;
