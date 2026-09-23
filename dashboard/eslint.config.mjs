import next from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'

const config = [
  ...next,
  ...nextTs,
  // Expliciete versie: de automatische detectie van eslint-plugin-react gebruikt een API die in ESLint 10 is verwijderd.
  { settings: { react: { version: '19.3' } } },
  { ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts', 'playwright-report/**', 'test-results/**'] },
]

export default config
