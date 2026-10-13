'use strict';

/**
 * appointment controller
 */

const { createCoreController } = require('@strapi/strapi').factories;

const UID = 'api::appointment.appointment';

module.exports = createCoreController(UID, ({ strapi }) => ({
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
