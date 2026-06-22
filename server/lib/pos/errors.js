class PosError extends Error {
  constructor(status, code, message, details = undefined) {
    super(message);
    this.name = 'PosError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function assertPos(condition, status, code, message, details = undefined) {
  if (!condition) throw new PosError(status, code, message, details);
}

function cents(value, field, { allowZero = true } = {}) {
  assertPos(
    Number.isSafeInteger(value) && (allowZero ? value >= 0 : value > 0),
    422,
    'INVALID_MONEY',
    `${field} must be ${allowZero ? 'a non-negative' : 'a positive'} integer number of cents.`,
  );
  return value;
}

function positiveInt(value, field) {
  assertPos(Number.isSafeInteger(value) && value > 0, 422, 'INVALID_QUANTITY', `${field} must be a positive integer.`);
  return value;
}

function nonEmpty(value, field, maxLength = 250) {
  const result = String(value || '').trim();
  assertPos(result.length > 0 && result.length <= maxLength, 422, 'INVALID_FIELD', `${field} is required.`);
  return result;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function uuid(value, field) {
  assertPos(isUuid(value), 422, 'INVALID_ID', `${field} must be a valid UUID.`);
  return String(value);
}

module.exports = { PosError, assertPos, cents, isUuid, nonEmpty, positiveInt, uuid };
