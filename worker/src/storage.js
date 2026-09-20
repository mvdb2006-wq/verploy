/**
 * Screenshot storage — Supabase Storage bucket: "screenshots"
 */

export async function uploadScreenshot(supabase, runId, buffer, label) {
  const path = `${runId}/${label}.png`

  const { error } = await supabase.storage
    .from('screenshots')
    .upload(path, buffer, {
      contentType: 'image/png',
      upsert: true,
    })

  if (error) {
    console.error(`[storage] Failed to upload ${label} screenshot:`, error.message)
    return null
  }

  const { data } = supabase.storage.from('screenshots').getPublicUrl(path)
  return data.publicUrl
}
