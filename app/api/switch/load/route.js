/**
 * POST /api/switch/load
 *
 * Loads all 4 automation component types and streams them back via SSE.
 * Mirrors fetch_all_components() in metadata_switch_manager.py.
 *
 * Each type is loaded sequentially and emitted as it completes so the
 * UI can render results progressively (same as Python's per-type progress).
 *
 * SSE event types:
 *   info      — status message (shown in status log)
 *   components — { componentType, items } — client stores these
 *   done      — loading complete
 *   error     — fatal error
 */

import { getSession } from '@/lib/session'
import { SalesforceClient } from '@/lib/salesforce/client'
import { createSSEStream } from '@/lib/streaming/sse'
import { checkRateLimit, rateLimitResponse, QUERY_LIMIT } from '@/lib/rateLimit'
import {
  loadValidationRules,
  loadWorkflowRules,
  loadFlows,
  loadTriggers,
} from '@/lib/salesforce/switch/index'

const LOADERS = [
  { fn: loadValidationRules, label: 'Validation Rules', type: 'validationRules' },
  { fn: loadWorkflowRules,   label: 'Workflow Rules',   type: 'workflowRules'   },
  { fn: loadFlows,           label: 'Flows',            type: 'flows'           },
  { fn: loadTriggers,        label: 'Apex Triggers',    type: 'triggers'        },
]

export async function POST() {
  const session = await getSession()
  if (!session.accessToken) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const rl = checkRateLimit(`${session.instanceUrl}:switch-load`, QUERY_LIMIT)
  if (!rl.allowed) return rateLimitResponse(rl.resetAt)

  const { response, emit, end } = createSSEStream()

  ;(async () => {
    try {
      const client = SalesforceClient.fromSession(session)
      let   total  = 0

      emit.info('=== Loading Automation Components ===')

      for (const { fn, label, type } of LOADERS) {
        emit.info(`Loading ${label}…`)
        try {
          const items = await fn(client)
          total += items.length
          emit.success(`✓ ${label}: ${items.length} found`)
          // Emit components as a structured data event (not just a log line)
          emit.data({ type: 'components', componentType: type, items })
        } catch (err) {
          emit.warn(`✗ ${label}: ${err.message}`)
          emit.data({ type: 'components', componentType: type, items: [] })
        }
      }

      emit.info(`=== Complete: ${total} total automation component(s) loaded ===`)
      emit.done(null, { total })

    } catch (err) {
      if (err.code === 'SESSION_EXPIRED') {
        emit.error('Session expired. Please reconnect to Salesforce.')
      } else {
        emit.error(`Load failed: ${err.message}`)
      }
    } finally {
      end()
    }
  })()

  return response
}