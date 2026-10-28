'use strict';

/**
 * Périodes des indicateurs (vue d'ensemble /admin, audience) et regroupement des dates.
 *
 * Chaque période est comparée à la période précédente de même durée.
 * Les dates sont regroupées à l'heure de Paris (jour, semaine commençant le lundi, ou mois).
 */

const TIME_ZONE = 'Europe/Paris';
const DAY = 86400000;

const PERIODS = {
	'7d': { days: 7, unit: 'day' },
	'30d': { days: 30, unit: 'day' },
	'3m': { days: 91, unit: 'week' },
	'6m': { days: 182, unit: 'week' },
	'12m': { months: 12, unit: 'month' },
};

/* ---------- Dates : clés « AAAA-MM-JJ » à l'heure de Paris ---------- */

const parisKey = (date) =>
	new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
		new Date(date)
	);

// Arithmétique de calendrier sur les clés (en UTC pour éviter les changements d'heure)
const keyToUTC = (key) => {
	const [y, m, d] = key.split('-').map(Number);
	return new Date(Date.UTC(y, m - 1, d));
};
const utcToKey = (date) => date.toISOString().slice(0, 10);
const addDays = (key, n) => utcToKey(new Date(keyToUTC(key).getTime() + n * DAY));
const addMonths = (key, n) => {
	const d = keyToUTC(key);
	return utcToKey(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1)));
};
const startOfWeek = (key) => addDays(key, -((keyToUTC(key).getUTCDay() + 6) % 7));
const startOfMonth = (key) => `${key.slice(0, 7)}-01`;

const bucketOf = (key, unit) => (unit === 'week' ? startOfWeek(key) : unit === 'month' ? startOfMonth(key) : key);

const rangeFor = (periodKey) => {
	const period = PERIODS[periodKey];
	const end = parisKey(new Date());
	let start;
	let prevStart;
	if (period.unit === 'month') {
		start = addMonths(startOfMonth(end), -(period.months - 1));
		prevStart = addMonths(start, -period.months);
	} else {
		start = addDays(end, -(period.days - 1));
		prevStart = addDays(start, -period.days);
	}
	const buckets = [];
	for (let k = bucketOf(start, period.unit); k <= end; ) {
		buckets.push(k);
		k = period.unit === 'month' ? addMonths(k, 1) : addDays(k, period.unit === 'week' ? 7 : 1);
	}
	// Bornes de requête larges d'un jour (fuseau), le tri fin se fait sur la clé de Paris
	return { period: periodKey, unit: period.unit, start, end, prevStart, buckets, from: keyToUTC(addDays(prevStart, -1)) };
};

/* ---------- Agrégats ---------- */

/** Lignes créées depuis le début de la période précédente, avec leur clé de jour */
const createdSince = async (strapi, uid, range, select = [], populate) => {
	const rows = await strapi.db.query(uid).findMany({
		select: ['id', 'createdAt', ...select],
		where: { createdAt: { $gte: range.from } },
		...(populate && { populate }),
	});
	return rows.map((row) => ({ ...row, day: parisKey(row.createdAt) }));
};

const split = (rows, range) => ({
	current: rows.filter((r) => r.day >= range.start && r.day <= range.end),
	previous: rows.filter((r) => r.day >= range.prevStart && r.day < range.start),
});

/** { total, previous, buckets: [{ key, count }] } */
const series = (rows, range) => {
	const { current, previous } = split(rows, range);
	const counts = Object.fromEntries(range.buckets.map((k) => [k, 0]));
	for (const r of current) {
		const k = bucketOf(r.day, range.unit);
		if (k in counts) counts[k] += 1;
	}
	return { total: current.length, previous: previous.length, buckets: range.buckets.map((key) => ({ key, count: counts[key] })) };
};

module.exports = { PERIODS, parisKey, bucketOf, rangeFor, createdSince, split, series };
