'use strict';

/**
 * rating controller (avis des patients)
 *
 * - create : uniquement le patient du rendez-vous, une fois le rendez-vous terminé,
 *   non annulé et pas encore évalué. L'auteur, le praticien et la note finale sont
 *   fixés par le serveur (le navigateur n'envoie que les notes et le commentaire).
 * - update / delete : réservés au SuperAdmin (modération).
 * - find / findOne : réservés au SuperAdmin. Un avis n'est jamais transmis au praticien
 *   (ni le détail des notes, ni le rendez-vous) : il ne voit que sa note globale
 *   (doctor.ratingAverage, voir src/rating-score.js).
 * - testimonials : moyennes du site et commentaires anonymes de la page d'accueil, sans note individuelle.
 */

const { randomUUID } = require('crypto');
const { createCoreController } = require('@strapi/strapi').factories;

const UID = 'api::rating.rating';
const APPOINTMENT_UID = 'api::appointment.appointment';
const ADMIN_ROLE = 'SuperAdmin';
const CRITERIA = ['punctuality', 'respect', 'response', 'professionalism', 'listening', 'conditions'];
const NOTE_MAX_LENGTH = 2000;
// Page d'accueil : commentaires assez longs pour être lus, les plus récents
const QUOTE_MIN_LENGTH = 20;
const QUOTES_COUNT = 6;

const average = (values) => {
	const list = values.map(Number).filter((n) => Number.isFinite(n) && n > 0);
	return list.length ? Math.round((list.reduce((sum, n) => sum + n, 0) / list.length) * 100) / 100 : null;
};

const isAdmin = (user) => user?.role?.name === ADMIN_ROLE;

/** Rendez-vous visé (id numérique, documentId ou { connect }) avec ce qu'il faut pour les contrôles */
const findAppointment = (strapi, value) => {
	const ref = value?.connect?.[0] ?? value?.set?.[0] ?? value;
	const key = ref?.documentId ?? ref?.id ?? ref;
	if (key === undefined || key === null || key === '') return null;
	const where = typeof key === 'number' || /^\d+$/.test(String(key)) ? { id: Number(key) } : { documentId: String(key) };
	return strapi.db.query(APPOINTMENT_UID).findOne({
		where,
		select: ['id', 'isOver', 'isCancelled'],
		populate: { patient: { select: ['id'] }, doctor: { select: ['id'] }, rating: { select: ['id'] } },
	});
};

module.exports = createCoreController(UID, ({ strapi }) => ({
	async create(ctx) {
		const user = ctx.state.user;
		if (!user) return ctx.unauthorized();
		if (isAdmin(user)) return super.create(ctx);

		const input = ctx.request.body?.data || {};
		const appointment = await findAppointment(strapi, input.appointment);
		if (!appointment) return ctx.badRequest('Rendez-vous introuvable.');
		if (appointment.patient?.id !== user.id) return ctx.forbidden('Vous ne pouvez évaluer que vos propres rendez-vous.');
		if (appointment.isCancelled) return ctx.badRequest('Un rendez-vous annulé ne peut pas être évalué.');
		if (!appointment.isOver) return ctx.badRequest('Vous pourrez donner votre avis une fois la consultation terminée.');
		if (appointment.rating) return ctx.badRequest('Vous avez déjà évalué ce rendez-vous.');
		if (!appointment.doctor) return ctx.badRequest('Praticien introuvable pour ce rendez-vous.');

		// Six critères, chacun noté de 1 à 5
		const scores = {};
		for (const key of CRITERIA) {
			const value = Number(input[key]);
			if (!Number.isInteger(value) || value < 1 || value > 5) {
				return ctx.badRequest('Chaque critère doit être noté de 1 à 5.');
			}
			scores[key] = value;
		}
		const finalScore = Math.round((CRITERIA.reduce((sum, key) => sum + scores[key], 0) / CRITERIA.length) * 100) / 100;
		const note = typeof input.note === 'string' ? input.note.trim().slice(0, NOTE_MAX_LENGTH) : null;

		// Création côté serveur : relations fixées ici, en une fois (la notification au praticien les lit)
		const entity = await strapi.documents(UID).create({
			data: {
				...scores,
				finalScore,
				note: note || null,
				UUID: randomUUID(),
				appointment: appointment.id,
				doctor: appointment.doctor.id,
				users_permissions_user: user.id,
			},
		});
		const sanitizedEntity = await this.sanitizeOutput(entity, ctx);
		ctx.status = 201;
		return this.transformResponse(sanitizedEntity);
	},

	async find(ctx) {
		if (!isAdmin(ctx.state.user)) return ctx.forbidden();
		return super.find(ctx);
	},

	async findOne(ctx) {
		if (!isAdmin(ctx.state.user)) return ctx.forbidden();
		return super.findOne(ctx);
	},

	async testimonials() {
		const ratings = await strapi.db.query(UID).findMany({
			select: ['documentId', 'finalScore', 'note', 'createdAt', ...CRITERIA],
			populate: { doctor: { select: ['firstname', 'lastname'] } },
			orderBy: { createdAt: 'desc' },
		});
		return {
			data: {
				count: ratings.length,
				overall: average(ratings.map((r) => r.finalScore)),
				criteria: Object.fromEntries(CRITERIA.map((key) => [key, average(ratings.map((r) => r[key]))])),
				quotes: ratings
					.filter((r) => r.note?.trim().length > QUOTE_MIN_LENGTH)
					.slice(0, QUOTES_COUNT)
					.map((r) => ({
						id: r.documentId,
						note: r.note.trim(),
						createdAt: r.createdAt,
						doctor: r.doctor ? { firstname: r.doctor.firstname, lastname: r.doctor.lastname } : null,
					})),
			},
		};
	},

	async update(ctx) {
		if (!isAdmin(ctx.state.user)) return ctx.forbidden();
		return super.update(ctx);
	},

	async delete(ctx) {
		if (!isAdmin(ctx.state.user)) return ctx.forbidden();
		return super.delete(ctx);
	},
}));
