'use strict';

/**
 * appointment controller
 */

const { createCoreController } = require('@strapi/strapi').factories;

const UID = 'api::appointment.appointment';
const ADMIN_ROLE = 'SuperAdmin';

const isAdmin = (user) => user?.role?.name === ADMIN_ROLE;

module.exports = createCoreController(UID, ({ strapi }) => ({
	/**
	 * POST /appointments
	 * Le patient est toujours le compte connecté, rattaché par le serveur :
	 * le navigateur ne choisit pas le patient, et Strapi refuserait (400)
	 * une relation vers le modèle User que le rôle n'a pas le droit de lire.
	 * Le rattachement se fait dans la création même, car les notifications
	 * (praticien et patient) sont envoyées juste après à partir du patient.
	 */
	async create(ctx) {
		const user = ctx.state.user;
		if (!user) return ctx.unauthorized();
		if (isAdmin(user)) return super.create(ctx);

		const body = ctx.request.body || {};
		const data = { ...(body.data || {}) };
		const forConnectedPatient = 'patient' in data;
		delete data.patient;
		ctx.request.body = { ...body, data };

		await this.validateQuery(ctx);
		const sanitizedQuery = await this.sanitizeQuery(ctx);
		await this.validateInput(data, ctx);
		const sanitizedInput = await this.sanitizeInput(data, ctx);

		const entity = await strapi.service(UID).create({
			...sanitizedQuery,
			data: { ...sanitizedInput, ...(forConnectedPatient && { patient: user.id }) },
		});
		const sanitizedEntity = await this.sanitizeOutput(entity, ctx);
		ctx.status = 201;
		return this.transformResponse(sanitizedEntity);
	},

	/**
	 * GET /appointments/to-rate-count
	 * Nombre de rendez-vous terminés que le patient connecté n'a pas encore évalués.
	 * Le filtre sur le patient est fait côté serveur : aucun droit de lecture
	 * sur les comptes utilisateurs n'est nécessaire.
	 */
	async toRateCount(ctx) {
		const user = ctx.state.user;
		if (!user) return ctx.unauthorized();

		const count = await strapi.documents(UID).count({
			filters: {
				patient: { id: user.id },
				isOver: true,
				isCancelled: { $ne: true },
				rating: { id: { $null: true } },
			},
		});
		return { data: { count } };
	},
}));
