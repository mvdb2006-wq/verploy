import { NextResponse } from 'next/server'

/**
 * Connector 1.x gebruikte ongesigneerde API-keys. Die zijn op 23-09-2026 allemaal
 * ingetrokken; deze melding verschijnt in de plugin-instellingen van oude installaties.
 */
export function POST() {
  return NextResponse.json(
    { message: 'Verploy Connector 1.x wordt niet meer ondersteund. Installeer versie 2 via app.verploy.com en koppel de site opnieuw.' },
    { status: 410 },
  )
}
