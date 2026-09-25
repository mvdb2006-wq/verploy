'use client'
import { useI18n } from '@/lib/i18n/client'
import { intelVerdict, type Intel } from '@/lib/updates/intel'

/** "Elders zonder problemen op 212 sites" / "Gaf elders problemen op 3 van 9 sites" (vanaf een paar sites). */
export function IntelBadge({ intel }: { intel: Intel | null | undefined }) {
  const { t } = useI18n()
  const verdict = intelVerdict(intel)
  if (!verdict || !intel) return null
  const total = intel.ok + intel.failed
  if (verdict === 'proven') return <span className="badge badge-ok">{t('intel.proven', { count: intel.ok })}</span>
  if (verdict === 'risky') return <span className="badge badge-danger">{t('intel.risky', { failed: intel.failed, total })}</span>
  return <span className="badge badge-muted">{t('intel.mixed', { ok: intel.ok, total })}</span>
}
