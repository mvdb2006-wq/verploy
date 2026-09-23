import { execFileSync } from 'node:child_process'
import path from 'node:path'

// Bouwt een schone testdatabase op uit de ECHTE migraties.
export default function setup(): void {
  const script = path.resolve(import.meta.dirname, '../../../supabase/local/reset-db.sh')
  execFileSync(script, [process.env.TEST_DB_NAME ?? 'verploy_test'], { stdio: 'inherit' })
}
