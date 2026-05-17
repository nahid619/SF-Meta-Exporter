/**
 * Typed Salesforce error classes.
 * Mirrors the exception handling in salesforce_client.py and the
 * error responses from simple_salesforce.
 */

export class SalesforceAuthError extends Error {
  constructor(message) {
    super(message)
    this.name = 'SalesforceAuthError'
    this.code = 'SESSION_EXPIRED'
  }
}

export class SalesforceRateLimitError extends Error {
  constructor(message = 'Salesforce API rate limit exceeded. Retrying…') {
    super(message)
    this.name = 'SalesforceRateLimitError'
    this.code = 'RATE_LIMIT'
    this.retryAfter = 30 // seconds
  }
}

export class SalesforceApiError extends Error {
  constructor(message, statusCode) {
    super(message)
    this.name   = 'SalesforceApiError'
    this.code   = 'API_ERROR'
    this.status = statusCode
  }
}

/**
 * Parse a Salesforce error response body into a clean message.
 * SF errors are arrays like: [{ message: "...", errorCode: "..." }]
 * or objects like: { error: "...", error_description: "..." }
 */
export function parseSalesforceError(body, httpStatus) {
  if (Array.isArray(body) && body[0]?.message) {
    return body[0].message
  }
  if (body?.message) return body.message
  if (body?.error_description) return body.error_description
  if (body?.error) return body.error
  return `Salesforce API error (HTTP ${httpStatus})`
}

/**
 * Map HTTP status + SF error code to the right error class.
 * Mirrors the SalesforceExpiredSession detection in salesforce_client.py.
 */
export function buildSalesforceError(body, httpStatus) {
  const message = parseSalesforceError(body, httpStatus)

  if (httpStatus === 401) {
    // Check for password-expired — mirrors Python's 'expired_password' detection
    if (/password.*expired|expired_password/i.test(message)) {
      return new SalesforceAuthError(
        '🔐 Your Salesforce password has expired.\n' +
        'Reset it in Setup → My Personal Information → Change Password, ' +
        'then get a new Security Token and log in again.'
      )
    }
    return new SalesforceAuthError(`Session expired: ${message}`)
  }

  if (httpStatus === 429) return new SalesforceRateLimitError(message)

  return new SalesforceApiError(message, httpStatus)
}
