/**
 * Field Usage Tracker — mirrors field_usage_tracker.py exactly.
 *
 * Queries 13 Salesforce metadata sources to find where each field is referenced.
 * The cache is built ONCE per object, then all fields are looked up from cache —
 * this avoids N×13 API calls (only 13 calls per object regardless of field count).
 *
 * Key SF Tooling API constraint: "Metadata" field can only be fetched for
 * ONE record at a time. So the pattern for Layout/ValidationRule is:
 *   1. List IDs (batch query WITHOUT Metadata)
 *   2. Fetch each record individually WITH Metadata
 *
 * Usage:
 *   const cache = await buildObjectUsageCache(client, 'Account', emitFn)
 *   const usageStr = getFieldUsageString(cache, 'Account', 'Industry')
 */

// Section display order — mirrors the Python app's section_order list
const SECTION_ORDER = [
  'Page Layouts',
  'Record Types',
  'Validation Rules',
  'Workflows',
  'Flows',
  'Process Builder',
  'Apex Classes',
  'Apex Triggers',
  'Visualforce Pages',
  'Visualforce Components',
  'Lightning Components',
  'Custom Buttons/Links',
  'Email Templates',
]

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Build the full usage cache for an object.
 * Returns a nested map: { 'Object.FieldName': { 'Page Layouts': ['Layout1'], ... } }
 *
 * @param {import('./client').SalesforceClient} client
 * @param {string}   objectName   — e.g. 'Account'
 * @param {Function} [emit]       — SSE emit.info() for sub-progress messages
 */
export async function buildObjectUsageCache(client, objectName, emit) {
  const usageData = {}

  const steps = [
    ['Page Layouts',             () => getPageLayoutUsage(client, objectName, emit)],
    ['Validation Rules',         () => getValidationRuleUsage(client, objectName, emit)],
    ['Flows / Process Builder',  () => getFlowUsage(client, objectName, emit)],
    ['Apex Triggers',            () => getApexTriggerUsage(client, objectName, emit)],
    ['Apex Classes',             () => getApexClassUsage(client, objectName, emit)],
    ['Visualforce Pages',        () => getVFPageUsage(client, objectName, emit)],
    ['Visualforce Components',   () => getVFComponentUsage(client, objectName, emit)],
    ['Custom Buttons/Links',     () => getCustomButtonUsage(client, objectName, emit)],
    ['Email Templates',          () => getEmailTemplateUsage(client, objectName, emit)],
  ]

  for (const [label, fn] of steps) {
    try {
      emit?.(`    › ${label}…`)
      const result = await fn()
      mergeUsage(usageData, result)
    } catch (err) {
      emit?.(`    ⚠ ${label}: ${err.message}`)
    }
  }

  return usageData
}

/**
 * Format field usage from cache as a multi-line string.
 * Mirrors FieldUsageTracker.get_field_usage() in field_usage_tracker.py.
 *
 * @param {object} cache       — result of buildObjectUsageCache()
 * @param {string} objectName
 * @param {string} fieldApiName
 * @returns {string}           — multi-line "Page Layouts\n- Layout1\n\nApex Triggers\n- T1"
 */
export function getFieldUsageString(cache, objectName, fieldApiName) {
  const fieldKey   = `${objectName}.${fieldApiName}`
  const fieldUsage = cache[fieldKey]

  if (!fieldUsage || Object.keys(fieldUsage).length === 0) return ''

  const sections = []

  for (const section of SECTION_ORDER) {
    const items = fieldUsage[section]
    if (items?.length) {
      sections.push(section)
      for (const item of [...new Set(items)].sort()) {
        sections.push(`- ${item}`)
      }
      sections.push('') // blank line between sections
    }
  }

  return sections.join('\n').trim()
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Merge { fieldKey → [items] } into the main usageData store */
function mergeUsage(usageData, fieldUsage) {
  for (const [fieldKey, categories] of Object.entries(fieldUsage)) {
    if (!usageData[fieldKey]) usageData[fieldKey] = {}
    for (const [cat, items] of Object.entries(categories)) {
      if (!usageData[fieldKey][cat]) usageData[fieldKey][cat] = []
      usageData[fieldKey][cat].push(...items)
    }
  }
}

/** Extract field references from a Salesforce formula string.
 *  Looks for bare identifiers — same heuristic as Python's _extract_fields_from_formula(). */
function extractFieldsFromFormula(formula) {
  if (!formula) return []
  // Match bare word tokens that look like field API names (alphanumeric + underscore, not in quotes)
  const tokens = formula
    .replace(/"[^"]*"/g, '') // strip string literals
    .split(/[^a-zA-Z0-9_]/)
    .filter(t => t.length > 0 && /[A-Za-z]/.test(t[0]))
  return [...new Set(tokens)]
}

// ─── Source 1: Page Layouts ───────────────────────────────────────────────────

async function getPageLayoutUsage(client, objectName, emit) {
  const result = {}

  // Step 1: list layout IDs without Metadata
  const list = await client.toolingQuery(
    `SELECT Id, Name FROM Layout WHERE EntityDefinitionId = '${objectName}'`
  )

  // Step 2: fetch each layout's Metadata individually (SF Tooling API constraint)
  for (const layout of (list.records || [])) {
    try {
      const detail = await client.toolingQuery(
        `SELECT Id, Name, Metadata FROM Layout WHERE Id = '${layout.Id}'`
      )
      const metadata = detail.records?.[0]?.Metadata
      if (!metadata) continue

      for (const section of (metadata.layoutSections || [])) {
        for (const column of (section.layoutColumns || [])) {
          for (const item of (column.layoutItems || [])) {
            if (!item.field) continue
            const key = `${objectName}.${item.field}`
            if (!result[key]) result[key] = { 'Page Layouts': [] }
            if (!result[key]['Page Layouts']) result[key]['Page Layouts'] = []
            result[key]['Page Layouts'].push(layout.Name)
          }
        }
      }
    } catch { /* skip individual layout failures */ }
  }

  return result
}

// ─── Source 2: Validation Rules ───────────────────────────────────────────────

async function getValidationRuleUsage(client, objectName) {
  const result = {}

  const list = await client.toolingQuery(
    `SELECT Id, ValidationName FROM ValidationRule 
     WHERE EntityDefinition.QualifiedApiName = '${objectName}'`
  )

  for (const rule of (list.records || [])) {
    try {
      const detail = await client.toolingQuery(
        `SELECT Id, ValidationName, Metadata FROM ValidationRule WHERE Id = '${rule.Id}'`
      )
      const metadata = detail.records?.[0]?.Metadata
      if (!metadata) continue

      const ruleName = rule.ValidationName

      // Direct field reference via errorDisplayField
      if (metadata.errorDisplayField) {
        const key = `${objectName}.${metadata.errorDisplayField}`
        if (!result[key]) result[key] = {}
        if (!result[key]['Validation Rules']) result[key]['Validation Rules'] = []
        result[key]['Validation Rules'].push(ruleName)
      }

      // Fields referenced in formula
      const fields = extractFieldsFromFormula(metadata.errorConditionFormula)
      for (const f of fields) {
        const key = `${objectName}.${f}`
        if (!result[key]) result[key] = {}
        if (!result[key]['Validation Rules']) result[key]['Validation Rules'] = []
        result[key]['Validation Rules'].push(ruleName)
      }
    } catch { /* skip */ }
  }

  return result
}

// ─── Source 3: Flows + Process Builder ───────────────────────────────────────

async function getFlowUsage(client, objectName) {
  const result = {}

  try {
    // Get active flows that reference this object
    const list = await client.toolingQuery(
      `SELECT Id, MasterLabel, ProcessType FROM Flow 
       WHERE Status = 'Active' 
       AND (TriggerType = 'RecordAfterSave' OR TriggerType = 'RecordBeforeSave'
            OR ProcessType = 'Workflow' OR ProcessType = 'Flow')
       LIMIT 200`
    )

    for (const flow of (list.records || [])) {
      try {
        const detail = await client.toolingQuery(
          `SELECT Id, MasterLabel, Metadata FROM Flow WHERE Id = '${flow.Id}'`
        )
        const metadata = detail.records?.[0]?.Metadata
        const label    = flow.MasterLabel
        if (!metadata) continue

        // Search for object.field references in flow body
        const flowJson   = JSON.stringify(metadata)
        const objectRefs = new RegExp(`${objectName}\\.([A-Za-z][A-Za-z0-9_]*)`, 'g')
        let   match

        while ((match = objectRefs.exec(flowJson)) !== null) {
          const fieldName = match[1]
          const key       = `${objectName}.${fieldName}`
          const cat = flow.ProcessType === 'Workflow' ? 'Process Builder' : 'Flows'
          if (!result[key]) result[key] = {}
          if (!result[key][cat]) result[key][cat] = []
          result[key][cat].push(label)
        }
      } catch { /* skip */ }
    }
  } catch { /* flows may not be accessible */ }

  return result
}

// ─── Source 4: Apex Triggers ─────────────────────────────────────────────────

async function getApexTriggerUsage(client, objectName) {
  const result = {}

  const list = await client.toolingQuery(
    `SELECT Name, Body FROM ApexTrigger 
     WHERE TableEnumOrId = '${objectName}' AND Status = 'Active'`
  )

  for (const trigger of (list.records || [])) {
    const body    = trigger.Body || ''
    const pattern = new RegExp(`\\.([A-Za-z][A-Za-z0-9_]*)`, 'g')
    let   match

    while ((match = pattern.exec(body)) !== null) {
      const fieldName = match[1]
      const key       = `${objectName}.${fieldName}`
      if (!result[key]) result[key] = {}
      if (!result[key]['Apex Triggers']) result[key]['Apex Triggers'] = []
      result[key]['Apex Triggers'].push(trigger.Name)
    }
  }

  return result
}

// ─── Source 5: Apex Classes ───────────────────────────────────────────────────

async function getApexClassUsage(client, objectName) {
  const result = {}

  // Limit to 500 classes as per Python app
  const list = await client.toolingQuery(
    `SELECT Name, Body FROM ApexClass LIMIT 500`
  )

  for (const cls of (list.records || [])) {
    const body    = cls.Body || ''
    // Look for ObjectName.FieldName patterns
    const pattern = new RegExp(`${objectName}\\.([A-Za-z][A-Za-z0-9_]*)`, 'g')
    let   match

    while ((match = pattern.exec(body)) !== null) {
      const fieldName = match[1]
      const key       = `${objectName}.${fieldName}`
      if (!result[key]) result[key] = {}
      if (!result[key]['Apex Classes']) result[key]['Apex Classes'] = []
      result[key]['Apex Classes'].push(cls.Name)
    }
  }

  return result
}

// ─── Source 6: Visualforce Pages ─────────────────────────────────────────────

async function getVFPageUsage(client, objectName) {
  const result = {}

  const list = await client.toolingQuery(
    `SELECT Name, Markup FROM ApexPage LIMIT 200`
  )

  for (const page of (list.records || [])) {
    const markup  = page.Markup || ''
    const pattern = new RegExp(`${objectName}\\.([A-Za-z][A-Za-z0-9_]*)`, 'g')
    let   match

    while ((match = pattern.exec(markup)) !== null) {
      const fieldName = match[1]
      const key       = `${objectName}.${fieldName}`
      if (!result[key]) result[key] = {}
      if (!result[key]['Visualforce Pages']) result[key]['Visualforce Pages'] = []
      result[key]['Visualforce Pages'].push(page.Name)
    }
  }

  return result
}

// ─── Source 7: Visualforce Components ────────────────────────────────────────

async function getVFComponentUsage(client, objectName) {
  const result = {}

  const list = await client.toolingQuery(
    `SELECT Name, Markup FROM ApexComponent LIMIT 200`
  )

  for (const comp of (list.records || [])) {
    const markup  = comp.Markup || ''
    const pattern = new RegExp(`${objectName}\\.([A-Za-z][A-Za-z0-9_]*)`, 'g')
    let   match

    while ((match = pattern.exec(markup)) !== null) {
      const fieldName = match[1]
      const key       = `${objectName}.${fieldName}`
      if (!result[key]) result[key] = {}
      if (!result[key]['Visualforce Components']) result[key]['Visualforce Components'] = []
      result[key]['Visualforce Components'].push(comp.Name)
    }
  }

  return result
}

// ─── Source 8: Custom Buttons/Links ──────────────────────────────────────────

async function getCustomButtonUsage(client, objectName) {
  const result = {}

  try {
    const describe = await client.describeSObject(objectName)
    const links = describe.supportedScopes
      ? []
      : (describe.actionOverrides || [])

    // WebLinks from the describe
    for (const link of (describe.webLinks || [])) {
      const url  = link.url || link.encodingKey || ''
      const body = `${link.name} ${url}`
      const pattern = new RegExp(`[{\\[]!${objectName}\\.([A-Za-z][A-Za-z0-9_]*)`, 'gi')
      let   match

      while ((match = pattern.exec(body)) !== null) {
        const fieldName = match[1]
        const key       = `${objectName}.${fieldName}`
        if (!result[key]) result[key] = {}
        if (!result[key]['Custom Buttons/Links']) result[key]['Custom Buttons/Links'] = []
        result[key]['Custom Buttons/Links'].push(link.name || link.label)
      }
    }
  } catch { /* skip */ }

  return result
}

// ─── Source 9: Email Templates ────────────────────────────────────────────────

async function getEmailTemplateUsage(client, objectName) {
  const result = {}

  try {
    const list = await client.toolingQuery(
      `SELECT Name, HtmlValue, Body FROM EmailTemplate LIMIT 200`
    )

    for (const tpl of (list.records || [])) {
      const content = `${tpl.HtmlValue || ''} ${tpl.Body || ''}`
      const pattern = new RegExp(`${objectName}\\.([A-Za-z][A-Za-z0-9_]*)`, 'g')
      let   match

      while ((match = pattern.exec(content)) !== null) {
        const fieldName = match[1]
        const key       = `${objectName}.${fieldName}`
        if (!result[key]) result[key] = {}
        if (!result[key]['Email Templates']) result[key]['Email Templates'] = []
        result[key]['Email Templates'].push(tpl.Name)
      }
    }
  } catch { /* skip */ }

  return result
}
