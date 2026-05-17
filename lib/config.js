// Mirrors config.py from the Python desktop app.
// v65+ permanently disables SOAP login() — keep at 64.
export const API_VERSION = '64.0'

export const ORG_URLS = {
  production: 'https://login.salesforce.com',
  sandbox:    'https://test.salesforce.com',
}

// Output filename templates — {timestamp} replaced at runtime
export const DEFAULT_PICKLIST_FILENAME        = 'Picklist_Export_{timestamp}.xlsx'
export const DEFAULT_METADATA_FILENAME        = 'Object_Metadata_{timestamp}.xlsx'
export const DEFAULT_CONTENTDOCUMENT_FILENAME = 'ContentDocument_Export_{timestamp}.csv'
export const DEFAULT_SOQL_FILENAME            = 'SOQL_Export_{timestamp}.csv'

/** Returns a timestamp string like "2024-01-15_14-30-00" */
export function makeTimestamp() {
  return new Date()
    .toISOString()
    .replace(/T/, '_')
    .replace(/:/g, '-')
    .slice(0, 19)
}

/** Formats seconds into HH:MM:SS — mirrors format_runtime() in utils.py */
export function formatRuntime(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = Math.floor(totalSeconds % 60)
  return [h, m, s].map(v => String(v).padStart(2, '0')).join(':')
}
