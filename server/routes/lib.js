function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

function toCents(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}

function fromCents(value) {
  return Math.round(Number(value || 0) / 100);
}

function intOrZero(value) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function slugify(value) {
  const slug = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug || `item-${Date.now().toString(36)}`;
}

function ok(res, data, message = undefined) {
  res.json({ success: true, data, ...(message ? { message } : {}) });
}

function created(res, data, message = undefined) {
  res.status(201).json({ success: true, data, ...(message ? { message } : {}) });
}

function notFound(res, message = 'Not found.') {
  return res.status(404).json({ success: false, message });
}

function validationError(res, errors) {
  return res.status(422).json({
    success: false,
    message: 'Validation failed.',
    errors,
  });
}

module.exports = {
  asyncHandler,
  created,
  fromCents,
  intOrZero,
  notFound,
  ok,
  slugify,
  toCents,
  validationError,
};
