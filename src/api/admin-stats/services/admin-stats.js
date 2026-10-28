'use strict';

/**
 * Indicateurs de la vue d'ensemble /admin, calculés côté serveur.
 *
 * Chaque bloc compare la période choisie à la période précédente de même durée.
 * Les dates sont regroupées à l'heure de Paris (jour, semaine commençant le lundi, ou mois).
 * Pour ajouter un bloc (paiements…), écrire une fonction async (strapi, range) et l'ajouter à SECTIONS.
 */

const { PERIODS, parisKey, rangeFor, createdSince, split, series } = require('../../../stats-range');

const DAY = 86400000;

const round1 = (n) => Math.round(n * 10) / 10;

/* ---------- Blocs ---------- */

const growth = async (strapi, range) => {
	const [patients, doctors] = await Promise.all([
		createdSince(strapi, 'api::user-record.user-record', range),
		createdSince(strapi, 'api::doctor.doctor', range),
	]);
	return { patients: series(patients, range), doctors: series(doctors, range) };
};

const appointments = async (strapi, range) => {
	const rows = await createdSince(
		strapi,
		'api::appointment.appointment',
		range,
		['isCancelled', 'isCancelledByPatient', 'isOnline'],
		{ category: { select: ['name'] } }
	);
	const { current } = split(rows, range);
	const kept = current.filter((r) => !r.isCancelled);

	const byCategory = {};
	for (const r of kept) {
		const name = r.category?.name || 'Sans spécialité';
		byCategory[name] = (byCategory[name] || 0) + 1;
	}
	const sorted = Object.entries(byCategory)
		.map(([name, count]) => ({ name, count }))
		.sort((a, b) => b.count - a.count);
	const topCategories =
		sorted.length > 6
			? [...sorted.slice(0, 5), { name: 'Autres spécialités', count: sorted.slice(5).reduce((s, c) => s + c.count, 0) }]
			: sorted;

	return {
		// Toutes les réservations de la période (y compris celles annulées depuis)
		booked: series(rows, range),
		kept: kept.length,
		cancelled: current.length - kept.length,
		cancelledByPatient: current.filter((r) => r.isCancelled && r.isCancelledByPatient).length,
		online: kept.filter((r) => r.isOnline).length,
		topCategories,
	};
};

/** Parcours de tous les praticiens inscrits (état actuel) et délai de validation sur la période */
const doctorFunnel = async (strapi, range) => {
	const doctors = await strapi.db.query('api::doctor.doctor').findMany({
		select: ['id', 'firstname', 'lastname', 'description', 'isActive', 'validatedAt', 'rejectedAt', 'charterAcceptedAt', 'createdAt'],
		populate: { categories: { select: ['id'] }, languages: { select: ['id'] }, priceRange: true },
	});
	// Même règle que la checklist du site (adminApi.doctorChecklist)
	const complete = (d) =>
		Boolean(
			d.firstname &&
				d.lastname &&
				d.description?.trim() &&
				d.categories?.length &&
				d.languages?.length &&
				d.priceRange?.minimum &&
				d.priceRange?.maximum
		);
	const validated = doctors.filter((d) => {
		if (!d.validatedAt) return false;
		const day = parisKey(d.validatedAt);
		return day >= range.start && day <= range.end;
	});
	const delays = validated.map((d) => (new Date(d.validatedAt) - new Date(d.createdAt)) / DAY).filter((n) => n >= 0);

	return {
		registered: doctors.length,
		complete: doctors.filter(complete).length,
		charterSigned: doctors.filter((d) => complete(d) && d.charterAcceptedAt).length,
		active: doctors.filter((d) => d.isActive).length,
		rejected: doctors.filter((d) => d.rejectedAt && !d.isActive).length,
		validatedInPeriod: validated.length,
		avgValidationDays: delays.length ? round1(delays.reduce((s, n) => s + n, 0) / delays.length) : null,
	};
};

const quality = async (strapi, range) => {
	const [ratings, reportings, ticketsOpen, ticketsCreated, allRatings] = await Promise.all([
		createdSince(strapi, 'api::rating.rating', range, ['finalScore']),
		createdSince(strapi, 'api::reporting.reporting', range, ['from']),
		strapi.db.query('api::support-ticket.support-ticket').count({ where: { ticketStatus: { $in: ['open', 'pending'] } } }),
		createdSince(strapi, 'api::support-ticket.support-ticket', range),
		strapi.db.query('api::rating.rating').findMany({ select: ['finalScore'] }),
	]);
	const avg = (rows) => {
		const scores = rows.map((r) => Number(r.finalScore)).filter((n) => n > 0);
		return scores.length ? round1(scores.reduce((s, n) => s + n, 0) / scores.length) : null;
	};
	const r = split(ratings, range);
	const rep = split(reportings, range);
	return {
		ratingAvg: avg(r.current),
		ratingAvgPrevious: avg(r.previous),
		ratingCount: r.current.length,
		ratingAvgAllTime: avg(allRatings),
		ratingCountAllTime: allRatings.length,
		reportings: rep.current.length,
		reportingsPrevious: rep.previous.length,
		reportingsFromPatients: rep.current.filter((x) => x.from === 'patient').length,
		ticketsOpen,
		ticketsCreated: split(ticketsCreated, range).current.length,
	};
};

const SECTIONS = { growth, appointments, doctorFunnel, quality };

module.exports = ({ strapi }) => ({
	PERIODS,

	async overview(periodKey) {
		const range = rangeFor(periodKey);
		const entries = await Promise.all(
			Object.entries(SECTIONS).map(async ([name, compute]) => [name, await compute(strapi, range)])
		);
		return {
			period: { value: range.period, unit: range.unit, start: range.start, end: range.end, prevStart: range.prevStart },
			...Object.fromEntries(entries),
		};
	},
});
