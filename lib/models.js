// FILE PATH: lib/models.js
// lib/models.js

/**
 * Data model factory functions.
 * JavaScript equivalent of models.py from the Python app.
 *
 * Using factory functions instead of classes keeps things plain and serialisable —
 * these objects are passed between server and client via JSON (e.g. in SSE stats events).
 */

// ─── Picklist models ──────────────────────────────────────────────────────────

/** Mirrors FieldInfo in models.py */
export function createFieldInfo(apiName, label, isGlobal = false) {
  return { apiName, label, isGlobal }
}

/** Mirrors PicklistValueDetail in models.py */
export function createPicklistValue(label, value, isActive = true) {
  return { label, value, isActive }
}

/** Mirrors ProcessingResult in models.py */
export function createProcessingResult() {
  return {
    valuesProcessed:      0,
    inactiveValues:       0,
    rows:                 [],    // string[][] — ready for Excel
    picklistFieldsCount:  0,
    globalPicklistCount:  0,
    objectExists:         true,
    errorMessage:         null,
  }
}

// ─── Metadata models ──────────────────────────────────────────────────────────

/**
 * Mirrors MetadataField in models.py.
 * All fields default to '' so we can call toRow() safely even with missing data.
 */
export function createMetadataField(objectName, fieldLabel, apiName, dataType, opts = {}) {
  return {
    objectName,
    fieldLabel,
    apiName,
    dataType,
    length:         opts.length         ?? '',
    fieldType:      opts.fieldType      ?? '',
    required:       opts.required       ?? '',
    picklistValues: opts.picklistValues ?? '',
    formula:        opts.formula        ?? '',
    externalId:     opts.externalId     ?? '',
    trackHistory:   opts.trackHistory   ?? '',
    description:    opts.description    ?? '',
    helpText:       opts.helpText       ?? '',
    attributes:     opts.attributes     ?? '',
    fieldUsage:     opts.fieldUsage     ?? '',
  }
}

/**
 * Convert a MetadataField to a 15-column Excel row.
 * Mirrors MetadataField.to_row() in models.py.
 */
export function metadataFieldToRow(field) {
  return [
    field.objectName,
    field.fieldLabel,
    field.apiName,
    field.dataType,
    field.length,
    field.fieldType,
    field.required,
    field.picklistValues,
    field.formula,
    field.externalId,
    field.trackHistory,
    field.description,
    field.helpText,
    field.attributes,
    field.fieldUsage,
  ]
}

// ─── SF Switch models ─────────────────────────────────────────────────────────

/**
 * Mirrors the MetadataComponent class in metadata_switch_manager.py.
 * Tracks original + current active state for rollback support.
 */
export function createMetadataComponent(opts) {
  return {
    id:               opts.id,
    name:             opts.name,
    fullName:         opts.fullName,
    componentType:    opts.componentType,   // 'ValidationRule' | 'Flow' | 'WorkflowRule' | 'ApexTrigger'
    isActive:         opts.isActive,
    originalIsActive: opts.isActive,        // for rollback
    metadata:         opts.metadata ?? {},  // raw SF response payload
    recordId:         opts.recordId ?? null,
    modified:         false,
  }
}

// ─── Statistics models ────────────────────────────────────────────────────────

/** Mirrors print_picklist_statistics() output from utils.py */
export function createPicklistStats() {
  return {
    totalObjects:         0,
    successfulObjects:    0,
    failedObjects:        0,
    objectsNotFound:      0,
    objectsNoPicklists:   0,
    totalPicklistFields:  0,
    globalPicklistCount:  0,
    totalValues:          0,
    totalActiveValues:    0,
    totalInactiveValues:  0,
    failedObjectDetails:  [],  // [{ name, reason }]
    runtimeFormatted:     '',
    outputFile:           '',
  }
}

/** Mirrors print_metadata_statistics() output from utils.py */
export function createMetadataStats() {
  return {
    totalObjects:        0,
    successfulObjects:   0,
    failedObjects:       0,
    totalFields:         0,
    failedObjectDetails: [],
    runtimeFormatted:    '',
    outputFile:          '',
  }
}

/** Mirrors print_content_document_statistics() output from utils.py */
export function createContentDocStats() {
  return {
    totalDocuments:      0,
    totalVersions:       0,
    successfulDownloads: 0,
    failedDownloads:     0,
    totalSizeBytes:      0,
    failedFiles:         [],  // [{ id, filename, version, reason }]
    runtimeFormatted:    '',
    csvFile:             '',
    filesFolder:         '',
    objectTypesFiltered: [],  // SObject API names the download was restricted to, e.g. ['Account','Case']
  }
}

// ─── Backup & Restore stats (module 7) ───────────────────────────────────────

/** Stats emitted by POST /api/backup/export on completion */
export function createBackupStats() {
  return {
    totalObjects:      0,
    successfulObjects: 0,
    failedObjects:     0,
    totalRecords:      0,
    runtimeFormatted:  '',
  }
}

/** Stats emitted by POST /api/backup/restore on completion */
export function createRestoreStats() {
  return {
    totalObjects:          0,
    successfulObjects:     0,
    failedObjects:         0,
    totalRecordsInserted:  0,
    totalRecordsFailed:    0,
    runtimeFormatted:      '',
  }
}

// ─── Attachment stats (legacy Attachment object) ──────────────────────────────

/**
 * Stats emitted by POST /api/attachment/export on completion.
 * Mirrors createContentDocStats() but scoped to the legacy Attachment SObject.
 */
export function createAttachmentStats() {
  return {
    totalAttachments:    0,   // total Attachment records found across all selected objects
    successfulDownloads: 0,   // bodies downloaded successfully
    failedDownloads:     0,   // bodies that failed after retries
    totalSizeBytes:      0,   // cumulative byte count of all downloaded bodies
    failedFiles:         [],  // [{ id, filename, reason }]
    runtimeFormatted:    '',
    // objectResults is populated by the route before streaming starts.
    // Each entry is updated live as downloads progress.
    // Shape: [{ objectName, found, downloaded, failed, sizeMb, done }]
    objectResults:       [],
  }
}
