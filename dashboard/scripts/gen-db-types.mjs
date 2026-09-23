// Genereert src/lib/database.types.ts (supabase-js-formaat) uit een database die
// de migraties heeft gedraaid. Gebruik: node scripts/gen-db-types.mjs [--check]
import pg from 'pg'
import fs from 'node:fs'
import path from 'node:path'

const OUT = path.resolve(import.meta.dirname, '../src/lib/database.types.ts')

const PG_TO_TS = {
  uuid: 'string', text: 'string', 'character varying': 'string', 'timestamp with time zone': 'string',
  date: 'string', integer: 'number', bigint: 'number', smallint: 'number', numeric: 'number',
  boolean: 'boolean', jsonb: 'Json', json: 'Json', bytea: 'string',
}
const tsType = t => PG_TO_TS[t] ?? (() => { throw new Error(`Onbekend Postgres-type: ${t}`) })()

export async function generate(client) {
  const cols = (await client.query(`
    select c.table_name, c.column_name, c.data_type, c.is_nullable = 'YES' as nullable,
           (c.column_default is not null or c.is_identity = 'YES' or c.is_generated = 'ALWAYS') as has_default,
           c.is_generated = 'ALWAYS' or c.identity_generation = 'ALWAYS' as generated_always
      from information_schema.columns c
      join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
     where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
     order by c.table_name, c.ordinal_position`)).rows
  const fns = (await client.query(`
    select p.proname, pg_get_function_identity_arguments(p.oid) as args,
           pg_get_function_result(p.oid) as ret
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
     order by p.proname`)).rows

  const tables = new Map()
  for (const c of cols) {
    if (!tables.has(c.table_name)) tables.set(c.table_name, [])
    tables.get(c.table_name).push(c)
  }
  const lines = []
  lines.push('// GEGENEREERD door scripts/gen-db-types.mjs — niet met de hand bewerken.')
  lines.push('export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]', '')
  lines.push('export type Database = {', '  public: {', '    Tables: {')
  for (const [name, list] of tables) {
    const row = list.map(c => `          ${c.column_name}: ${tsType(c.data_type)}${c.nullable ? ' | null' : ''}`)
    const ins = list.filter(c => !c.generated_always).map(c =>
      `          ${c.column_name}${c.nullable || c.has_default ? '?' : ''}: ${tsType(c.data_type)}${c.nullable ? ' | null' : ''}`)
    const upd = list.filter(c => !c.generated_always).map(c =>
      `          ${c.column_name}?: ${tsType(c.data_type)}${c.nullable ? ' | null' : ''}`)
    lines.push(`      ${name}: {`, '        Row: {', ...row, '        }', '        Insert: {', ...ins, '        }',
      '        Update: {', ...upd, '        }', '        Relationships: []', '      }')
  }
  lines.push('    }', '    Views: { [_ in never]: never }', '    Functions: {')
  for (const f of fns) {
    const args = f.args ? f.args.split(', ').map(a => {
      const [n, ...t] = a.split(' ')
      return `${n}: ${tsType(t.join(' '))}`
    }) : []
    const table = /^TABLE\((.*)\)$/.exec(f.ret)
    const ret = f.ret === 'void'
      ? 'undefined'
      : table
        ? `{ ${table[1].split(', ').map(c => { const [n, ...t] = c.split(' '); return `${n}: ${tsType(t.join(' '))}` }).join('; ')} }[]`
        : tsType(f.ret)
    lines.push(`      ${f.proname}: { Args: ${args.length ? `{ ${args.join('; ')} }` : 'Record<PropertyKey, never>'}; Returns: ${ret} }`)
  }
  lines.push('    }', '    Enums: { [_ in never]: never }', '    CompositeTypes: { [_ in never]: never }', '  }', '}', '')
  lines.push("export type Tables<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row']", '')
  return lines.join('\n')
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const client = new pg.Client({ host: process.env.TEST_PG_HOST ?? '/tmp', port: Number(process.env.TEST_PG_PORT ?? 54322), user: 'postgres', password: process.env.TEST_PG_PASSWORD, database: process.env.TEST_DB_NAME ?? 'verploy_test' })
  await client.connect()
  const out = await generate(client)
  await client.end()
  if (process.argv.includes('--check')) {
    const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : ''
    if (current !== out) { console.error('database.types.ts is verouderd: draai node scripts/gen-db-types.mjs'); process.exit(1) }
    console.log('database.types.ts is actueel')
  } else {
    fs.writeFileSync(OUT, out)
    console.log(`geschreven: ${OUT}`)
  }
}
