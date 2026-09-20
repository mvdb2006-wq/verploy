/**
 * AI-powered failure diagnosis using OpenAI
 */

import OpenAI from 'openai'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

export async function diagnoseFailure({ siteUrl, stagingUrl, pluginSlugs, testOutput, diffScore }) {
  const prompt = `You are a WordPress expert diagnosing a failed plugin update.

Site: ${siteUrl}
Staging URL: ${stagingUrl}
Plugins being updated: ${pluginSlugs.join(', ')}

Test output:
${testOutput}

Visual diff score: ${diffScore !== null ? `${diffScore.toFixed(1)}% of pixels changed` : 'N/A'}

Analyze what likely went wrong and provide:
1. A clear diagnosis (2-3 sentences max) explaining the most likely cause
2. A concrete fix suggestion the developer can act on immediately

Format your response as JSON:
{
  "diagnosis": "...",
  "fix": "..."
}`

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      max_tokens: 400,
      temperature: 0.3,
    })

    const result = JSON.parse(response.choices[0].message.content)
    return {
      diagnosis: result.diagnosis || 'Unable to determine the cause automatically.',
      fix: result.fix || 'Check the WordPress error log for details.',
    }
  } catch (err) {
    console.error('[ai] Diagnosis failed:', err.message)
    return {
      diagnosis: 'Automated diagnosis unavailable. Check the test output above.',
      fix: 'Review the Playwright test output and check the WordPress error log via FTP or hosting panel.',
    }
  }
}
