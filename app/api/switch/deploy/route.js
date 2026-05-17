/**
 * POST /api/switch/deploy
 *
 * Deploys all pending automation changes and streams per-component results via SSE.
 * Mirrors deploy_changes() + _batch_deploy_components() + _batch_deploy_triggers()
 * in metadata_switch_manager.py.
 *
 * Body: { changes: ComponentChange[] }
 * ComponentChange: {
 *   id, type, isActive, name, objectName?,
 *   body?, apiVersion?,          ← triggers only
 *   definitionId?, versionNumber? ← flows only
 * }
 *
 * SSE events:
 *   info      — log line
 *   result    — { id, name, success, error? } per component
 *   done      — { stats: { succeeded, failed } }
 *   error     — fatal error
 */

import { getSession } from '@/lib/session'
import { SalesforceClient } from '@/lib/salesforce/client'
import { createSSEStream } from '@/lib/streaming/sse'
import {
  deployValidationRule,
  deployWorkflowRule,
  deployFlow,
  deployTrigger,
} from '@/lib/salesforce/switch/index'

const DEPLOYERS = {
  ValidationRule: deployValidationRule,
  WorkflowRule:   deployWorkflowRule,
  Flow:           deployFlow,
  ApexTrigger:    deployTrigger,
}

export async function POST(request) {
  const { changes = [] } = await request.json()

  const session = await getSession()
  if (!session.accessToken) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 })
  }
  if (!changes.length) {
    return Response.json({ error: 'No changes to deploy' }, { status: 400 })
  }

  const { response, emit, end } = createSSEStream()

  ;(async () => {
    const succeeded = []
    const failed    = []

    try {
      const client = SalesforceClient.fromSession(session)

      emit.info(`=== Deploying ${changes.length} Change(s) ===`)

      // Separate triggers (long-running) from fast components
      const fast     = changes.filter(c => c.type !== 'ApexTrigger')
      const triggers = changes.filter(c => c.type === 'ApexTrigger')

      // ── Fast components (VR, Workflow, Flow) ──────────────────────────────
      for (const comp of fast) {
        const action = comp.isActive ? 'Enabling' : 'Disabling'
        emit.info(`[${comp.type}] ${action}: ${comp.name}`)

        const deployFn = DEPLOYERS[comp.type]
        if (!deployFn) {
          const err = `No deploy handler for type: ${comp.type}`
          emit.warn(`  ✗ ${err}`)
          failed.push({ id: comp.id, name: comp.name, error: err })
          emit.data({ type: 'result', id: comp.id, name: comp.name, success: false, error: err })
          continue
        }

        try {
          await deployFn(client, comp)
          emit.success(`  ✓ ${comp.name} → ${comp.isActive ? 'Active' : 'Inactive'}`)
          succeeded.push({ id: comp.id, name: comp.name })
          emit.data({ type: 'result', id: comp.id, name: comp.name, success: true })
        } catch (err) {
          const msg = err.message
          emit.error(`  ✗ ${comp.name}: ${msg}`)
          failed.push({ id: comp.id, name: comp.name, error: msg })
          emit.data({ type: 'result', id: comp.id, name: comp.name, success: false, error: msg })
        }
      }

      // ── Apex Triggers (MetadataContainer flow — one at a time) ────────────
      if (triggers.length) {
        emit.warn(`⚡ ${triggers.length} trigger(s) — this may take 5–15 min (Apex tests run in production)`)

        for (const comp of triggers) {
          const action = comp.isActive ? 'Enabling' : 'Disabling'
          emit.info(`[ApexTrigger] ${action}: ${comp.name} (${comp.objectName})`)

          try {
            await deployTrigger(client, comp, msg => emit.info(msg))
            emit.success(`  ✓ ${comp.name} → ${comp.isActive ? 'Active' : 'Inactive'}`)
            succeeded.push({ id: comp.id, name: comp.name })
            emit.data({ type: 'result', id: comp.id, name: comp.name, success: true })
          } catch (err) {
            const msg = err.message
            emit.error(`  ✗ ${comp.name}: ${msg}`)
            failed.push({ id: comp.id, name: comp.name, error: msg })
            emit.data({ type: 'result', id: comp.id, name: comp.name, success: false, error: msg })
          }
        }
      }

      // ── Summary ───────────────────────────────────────────────────────────
      emit.info(`=== Deploy Complete: ${succeeded.length} succeeded, ${failed.length} failed ===`)
      emit.done(null, { stats: { succeeded: succeeded.length, failed: failed.length } })
      emit.data({ type: 'deployComplete', succeeded, failed })

    } catch (err) {
      if (err.code === 'SESSION_EXPIRED') {
        emit.error('Session expired. Please reconnect.')
      } else {
        emit.error(`Deploy error: ${err.message}`)
      }
      emit.data({ type: 'deployComplete', succeeded, failed })
    } finally {
      end()
    }
  })()

  return response
}
