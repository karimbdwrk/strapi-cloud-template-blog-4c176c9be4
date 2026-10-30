'use strict';

const adminPayments = require('../../../admin-payments');

const ADMIN_ROLE = 'SuperAdmin';

module.exports = {
	/** GET /api/admin-payments/overview?period=30d|3m|6m|12m */
	async overview(ctx) {
		const user = ctx.state.user;
		if (!user) return ctx.unauthorized();
		if (user.role?.name !== ADMIN_ROLE) return ctx.forbidden();
		const period = adminPayments.PERIODS[ctx.query.period] ? ctx.query.period : '30d';
		try {
			ctx.body = { data: await adminPayments.overview(strapi, period) };
		} catch (error) {
			strapi.log.error(`Paiements admin : ${error.message}`);
			ctx.status = 502;
			ctx.body = { error: { status: 502, message: 'Les paiements n’ont pas pu être chargés. Réessayez dans un instant.' } };
		}
	},
};
