import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        bg:       '#080C16',
        surface:  '#0F1629',
        surface2: '#162038',
        border:   '#1E2D4A',
        border2:  '#2A3D5E',
        accent:   '#22D98A',
        'accent-dark': '#19B874',
        'accent-dim':  'rgba(34,217,138,0.13)',
        text:     '#F0F4FF',
        muted:    '#8896B3',
        subtle:   '#3A4A6A',
        warn:     '#F59E0B',
        danger:   '#EF4444',
        ok:       '#22D98A',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      borderRadius: {
        card: '12px',
        lg:   '10px',
      },
      boxShadow: {
        glow:   '0 0 24px rgba(34,217,138,0.2)',
        card:   '0 1px 3px rgba(0,0,0,0.4)',
        modal:  '0 24px 64px rgba(0,0,0,0.6)',
      },
    },
  },
  plugins: [],
}

export default config
