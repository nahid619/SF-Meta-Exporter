/**
 * Salesforce Switch — load and deploy automation components.
 *
 * Full mirror of metadata_switch_manager.py + trigger_deployer.py.
 * Handles 4 component types:
 *   ValidationRule  → Tooling API GET + PATCH (Metadata field)
 *   WorkflowRule    → Tooling API GET + PATCH (Metadata field)
 *   Flow            → FlowDefinition GET + PATCH (activeVersionNumber)
 *   ApexTrigger     → MetadataContainer → ApexTriggerMember → ContainerAsyncRequest
 *
 * Server-side only — never imported by client components.
 */

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

// ─── Load functions ───────────────────────────────────────────────────────────

/**
 * Mirrors _fetch_validation_rules() in metadata_switch_manager.py
 */
export async function loadValidationRules(client) {
  const result = await client.toolingQuery(
    `SELECT Id, Active, ValidationName, EntityDefinitionId, Description
     FROM ValidationRule
     ORDER BY EntityDefinitionId, ValidationName
     LIMIT 2000`
  )
  return result.records.map(r => ({
    id:               r.Id,
    name:             r.ValidationName,
    type:             'ValidationRule',
    isActive:         r.Active,
    originalIsActive: r.Active,
    objectName:       r.EntityDefinitionId,
    description:      r.Description || '',
  }))
}

/**
 * Mirrors _fetch_workflow_rules() in metadata_switch_manager.py
 */
export async function loadWorkflowRules(client) {
  try {
    const result = await client.toolingQuery(
      `SELECT Id, Active, Name, TableEnumOrId
       FROM WorkflowRule
       ORDER BY TableEnumOrId, Name
       LIMIT 2000`
    )
    return result.records.map(r => ({
      id:               r.Id,
      name:             r.Name,
      type:             'WorkflowRule',
      isActive:         r.Active,
      originalIsActive: r.Active,
      objectName:       r.TableEnumOrId,
    }))
  } catch {
    // WorkflowRule may not be accessible in all orgs
    return []
  }
}

/**
 * Mirrors _fetch_flows() in metadata_switch_manager.py
 * Queries FlowDefinition for active version, then batch-queries Flow for status.
 */
export async function loadFlows(client) {
  const defsResult = await client.toolingQuery(
    `SELECT Id, ActiveVersionId, LatestVersionId, DeveloperName, MasterLabel
     FROM FlowDefinition
     ORDER BY MasterLabel
     LIMIT 2000`
  )

  const defs = defsResult.records
  if (defs.length === 0) return []

  // Batch-query all relevant version records
  const versionIds = [...new Set(
    defs.flatMap(d => [d.ActiveVersionId, d.LatestVersionId].filter(Boolean))
  )]

  const versionMap = new Map()
  const CHUNK = 200

  for (let i = 0; i < versionIds.length; i += CHUNK) {
    const chunk    = versionIds.slice(i, i + CHUNK)
    const inClause = chunk.map(id => `'${id}'`).join(', ')
    try {
      const vs = await client.toolingQuery(
        `SELECT Id, Status, VersionNumber, ProcessType FROM Flow WHERE Id IN (${inClause})`
      )
      for (const v of vs.records) versionMap.set(v.Id, v)
    } catch {}
  }

  return defs.map(def => {
    const versionId = def.ActiveVersionId || def.LatestVersionId
    const version   = versionId ? versionMap.get(versionId) : null
    const isActive  = version?.Status === 'Active'

    return {
      id:               versionId || def.Id,
      name:             def.MasterLabel || def.DeveloperName || def.Id,
      apiName:          def.DeveloperName,
      type:             'Flow',
      isActive,
      originalIsActive: isActive,
      definitionId:     def.Id,
      activeVersionId:  def.ActiveVersionId,
      versionNumber:    version?.VersionNumber ?? null,
      processType:      version?.ProcessType ?? null,
    }
  })
}

/**
 * Mirrors _fetch_triggers() in metadata_switch_manager.py
 */
export async function loadTriggers(client) {
  const result = await client.toolingQuery(
    `SELECT Id, Name, TableEnumOrId, Status, Body, ApiVersion
     FROM ApexTrigger
     ORDER BY TableEnumOrId, Name
     LIMIT 2000`
  )
  return result.records.map(r => ({
    id:               r.Id,
    name:             r.Name,
    type:             'ApexTrigger',
    isActive:         r.Status === 'Active',
    originalIsActive: r.Status === 'Active',
    objectName:       r.TableEnumOrId,
    body:             r.Body,
    apiVersion:       r.ApiVersion,
    status:           r.Status,
  }))
}

// ─── Deploy functions ─────────────────────────────────────────────────────────

/**
 * Mirrors _update_validation_rule() in metadata_switch_manager.py exactly:
 *   GET existing Metadata → set active → PATCH back
 */
export async function deployValidationRule(client, component) {
  const url = `${client.instanceUrl}/services/data/v${client.apiVersion}/tooling/sobjects/ValidationRule/${component.id}`

  // GET current full metadata (must send all fields back, not just active)
  const getRes = await fetch(url, { headers: client.headers })
  if (!getRes.ok) throw new Error(`GET failed: HTTP ${getRes.status}`)
  const current = await getRes.json()

  if (!current.Metadata) throw new Error('No Metadata field returned — check Tooling API permissions')

  // Modify only the active field — mirrors Python: existing_metadata['active'] = component.is_active
  const updatedMetadata = { ...current.Metadata, active: component.isActive }

  const patchRes = await fetch(url, {
    method:  'PATCH',
    headers: client.headers,
    body:    JSON.stringify({ Metadata: updatedMetadata }),
  })

  if (patchRes.status !== 204) {
    const body = await patchRes.text()
    throw new Error(`PATCH failed HTTP ${patchRes.status}: ${body}`)
  }

  return { success: true }
}

/**
 * Mirrors _update_workflow_rule() — identical pattern to ValidationRule
 */
export async function deployWorkflowRule(client, component) {
  const url = `${client.instanceUrl}/services/data/v${client.apiVersion}/tooling/sobjects/WorkflowRule/${component.id}`

  const getRes = await fetch(url, { headers: client.headers })
  if (!getRes.ok) throw new Error(`GET failed: HTTP ${getRes.status}`)
  const current = await getRes.json()

  if (!current.Metadata) throw new Error('No Metadata field returned')

  const updatedMetadata = { ...current.Metadata, active: component.isActive }

  const patchRes = await fetch(url, {
    method:  'PATCH',
    headers: client.headers,
    body:    JSON.stringify({ Metadata: updatedMetadata }),
  })

  if (patchRes.status !== 204) {
    const body = await patchRes.text()
    throw new Error(`PATCH failed HTTP ${patchRes.status}: ${body}`)
  }

  return { success: true }
}

/**
 * Mirrors _update_flow() in metadata_switch_manager.py:
 *   GET FlowDefinition Metadata → set activeVersionNumber → PATCH back
 *   activeVersionNumber = 0 → deactivate
 *   activeVersionNumber = N → activate version N
 */
export async function deployFlow(client, component) {
  if (!component.definitionId) {
    throw new Error('Missing definitionId — cannot deploy Flow')
  }

  const url = `${client.instanceUrl}/services/data/v${client.apiVersion}/tooling/sobjects/FlowDefinition/${component.definitionId}`

  const getRes = await fetch(url, { headers: client.headers })
  if (!getRes.ok) throw new Error(`GET FlowDefinition failed: HTTP ${getRes.status}`)
  const current = await getRes.json()

  if (!current.Metadata) throw new Error('No Metadata field on FlowDefinition')

  const updatedMetadata = { ...current.Metadata }

  if (component.isActive) {
    // Activate: set the version number we loaded
    if (!component.versionNumber) throw new Error('Cannot activate — unknown version number')
    updatedMetadata.activeVersionNumber = component.versionNumber
  } else {
    // Deactivate: 0 means no active version (mirrors Python: existing_metadata['activeVersionNumber'] = 0)
    updatedMetadata.activeVersionNumber = 0
  }

  const patchRes = await fetch(url, {
    method:  'PATCH',
    headers: client.headers,
    body:    JSON.stringify({ Metadata: updatedMetadata }),
  })

  if (patchRes.status !== 204) {
    const body = await patchRes.text()
    throw new Error(`Flow PATCH failed HTTP ${patchRes.status}: ${body}`)
  }

  return { success: true }
}

/**
 * Mirrors TriggerDeployer from trigger_deployer.py exactly.
 *
 * MetadataContainer flow:
 *   1. Create MetadataContainer
 *   2. Create ApexTriggerMember with Body + Metadata.status
 *   3. POST ContainerAsyncRequest (IsCheckOnly=false)
 *   4. Poll ContainerAsyncRequest every 5s until Completed/Failed
 *   5. DELETE MetadataContainer (cleanup)
 *
 * ⚠ Can take 5–15 min in production orgs (runs all Apex tests).
 *   Stream progress to client via onProgress callback.
 */
export async function deployTrigger(client, component, onProgress) {
  let containerId = null

  try {
    // Step 1: Create MetadataContainer
    onProgress?.('  › Creating MetadataContainer…')
    const container = await client._post('/tooling/sobjects/MetadataContainer', {
      Name: `SFMeta_${Date.now()}`,
    })
    containerId = container.id

    // Step 2: Create ApexTriggerMember
    // Critical: use Metadata.status ("Active"/"Inactive"), NOT a top-level IsActive field
    // Mirrors Python: payload = { ..., "Metadata": { "status": status, "apiVersion": api_version } }
    onProgress?.('  › Creating ApexTriggerMember…')
    const status = component.isActive ? 'Active' : 'Inactive'

    await client._post('/tooling/sobjects/ApexTriggerMember', {
      MetadataContainerId: containerId,
      ContentEntityId:     component.id,
      Body:                component.body,
      Metadata: {
        status,
        apiVersion: parseFloat(component.apiVersion ?? client.apiVersion),
      },
    })

    // Step 3: Deploy container
    onProgress?.('  › Deploying (may take several minutes — Apex tests run)…')
    const asyncReq = await client._post('/tooling/sobjects/ContainerAsyncRequest', {
      MetadataContainerId: containerId,
      IsCheckOnly:         false,
    })
    const requestId = asyncReq.id

    // Step 4: Poll — mirrors _monitor_deployment() in trigger_deployer.py
    const DONE_STATES = ['Completed', 'Failed', 'Error', 'Aborted', 'Cancelled']
    let   state       = 'Queued'
    let   attempts    = 0
    const maxAttempts = 120  // 10 min at 5s intervals

    while (!DONE_STATES.includes(state) && attempts < maxAttempts) {
      await sleep(5000)

      const statusData = await client._getAbsolute(
        `${client.instanceUrl}/services/data/v${client.apiVersion}/tooling/sobjects/ContainerAsyncRequest/${requestId}`
      )
      state = statusData.State ?? 'Unknown'
      attempts++

      onProgress?.(`  › [${attempts}] State: ${state}`)

      if (state === 'Failed' || state === 'Error') {
        const errMsg = statusData.ErrorMsg
          || statusData.DeployDetails?.componentFailures?.[0]?.problem
          || state
        throw new Error(`Deploy ${state}: ${errMsg}`)
      }
    }

    if (!DONE_STATES.includes(state)) {
      throw new Error(`Deploy timed out after ${attempts * 5}s (last state: ${state})`)
    }

    return { success: true, state }

  } finally {
    // Step 5: Always clean up the container — mirrors _cleanup_container()
    if (containerId) {
      try {
        await fetch(
          `${client.instanceUrl}/services/data/v${client.apiVersion}/tooling/sobjects/MetadataContainer/${containerId}`,
          { method: 'DELETE', headers: client.headers }
        )
      } catch {}
    }
  }
}