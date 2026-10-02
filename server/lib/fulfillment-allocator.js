const { assertPos } = require('./pos/errors');
/** Pure, deterministic allocation. Stock is already net of reservations. */
function allocate(lines, locations, fallbackId) {
    assertPos(locations.length > 0 && locations.length <= 3, 409, 'ORIGINS_NOT_CONFIGURED', 'Configure two shops and the Al Rayyan fallback.');
    const sorted = [...locations].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
    const regular = sorted.filter((l) => l.id !== fallbackId);
    const fallback = sorted.find((l) => l.id === fallbackId);
    assertPos(fallback, 409, 'FALLBACK_NOT_CONFIGURED', 'Configure the Al Rayyan fallback location.');
    const complete = (subset) => lines.every((line) => subset.reduce((sum, loc) => sum + (loc.stock[line.variantId] || 0), 0) >= line.qty);
    let selected = regular.find((loc) => complete([loc]));
    selected = selected ? [selected] : complete([fallback]) ? [fallback] : null;
    if (!selected) {
        const candidates = [];
        for (let mask = 1; mask < (1 << sorted.length); mask++) {
            const subset = sorted.filter((_, i) => mask & (1 << i));
            if (complete(subset))
                candidates.push(subset);
        }
        candidates.sort((a, b) => a.length - b.length
            || Number(a.includes(fallback)) - Number(b.includes(fallback))
            || a.reduce((s, l) => s + l.priority, 0) - b.reduce((s, l) => s + l.priority, 0));
        selected = candidates[0];
    }
    assertPos(selected, 409, 'INSUFFICIENT_STOCK', 'Some items are unavailable in the requested quantity.');
    selected = [...selected].sort((a, b) => Number(a.id === fallbackId) - Number(b.id === fallbackId) || a.priority - b.priority || a.id.localeCompare(b.id));
    const groups = selected.map((location) => ({ locationId: location.id, origin: location.origin, items: [] }));
    for (const line of lines) {
        let remaining = line.qty;
        selected.forEach((location, i) => {
            const quantity = Math.min(remaining, location.stock[line.variantId] || 0);
            if (quantity)
                groups[i].items.push({ ...line, qty: quantity });
            remaining -= quantity;
        });
    }
    return groups.filter((group) => group.items.length);
}
function aggregateProgress(shipments) {
    const active = shipments.filter((s) => s.status !== 'cancelled');
    if (!active.length)
        return { status: 'cancelled', label: 'cancelled', delivered: 0, total: 0 };
    const delivered = active.filter((s) => s.status === 'delivered').length;
    const shipped = active.filter((s) => ['shipped', 'delivered', 'returned'].includes(s.status)).length;
    const returned = active.filter((s) => s.status === 'returned').length;
    return {
        status: delivered === active.length ? 'delivered' : returned === active.length ? 'returned' : shipped === active.length ? 'shipped' : 'processing',
        label: delivered === active.length ? 'delivered' : delivered > 0 ? 'partially_delivered' : returned === active.length ? 'returned' : shipped === active.length ? 'shipped' : shipped > 0 ? 'partially_shipped' : 'processing',
        delivered, total: active.length,
    };
}
module.exports = { allocate, aggregateProgress };
