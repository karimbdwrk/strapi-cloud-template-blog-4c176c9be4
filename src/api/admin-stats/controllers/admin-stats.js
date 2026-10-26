'use strict';

const ADMIN_ROLE = 'SuperAdmin';

module.exports = {
	/** GET /api/admin-stats/overview?period=30d|3m|6m|12m */
	async overview(ctx) {
		const user = ctx.state.user;
		if (!user) return ctx.unauthorized();
		if (user.role?.name !== ADMIN_ROLE) return ctx.forbidden();

		const service = strapi.service('api::admin-stats.admin-stats');
		const period = service.PERIODS[ctx.query.period] ? ctx.query.period : '30d';
		ctx.body = { data: await service.overview(period) };
	},
};
