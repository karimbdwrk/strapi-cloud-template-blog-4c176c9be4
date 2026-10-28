'use strict';

const { track, doctorAudience, siteAudience, doctorsRanking, ADMIN_ROLE } = require('../../../audience');
const { PERIODS } = require('../../../stats-range');

const periodOf = (ctx) => (PERIODS[ctx.query.period] ? ctx.query.period : '30d');

const requireAdmin = (ctx) => {
	if (!ctx.state.user) return ctx.unauthorized();
	if (ctx.state.user.role?.name !== ADMIN_ROLE) return ctx.forbidden();
	return true;
};

module.exports = {
	/** POST /api/page-views/track { path, referrer, notFound } : toujours 204, même ignorée */
	async track(ctx) {
		try {
			await track(strapi, ctx);
		} catch (error) {
			strapi.log.error(`Audience : visite non enregistrée (${error.message})`);
		}
		ctx.status = 204;
	},

	/** GET /api/page-views/mine?period= : audience de la fiche du praticien connecté */
	async mine(ctx) {
		const user = ctx.state.user;
		if (!user) return ctx.unauthorized();
		const doctor = await strapi.db.query('api::doctor.doctor').findOne({
			where: { users_permissions_user: { id: user.id } },
			select: ['documentId'],
		});
		if (!doctor) return ctx.forbidden('Réservé aux praticiens.');
		ctx.body = { data: await doctorAudience(strapi, doctor.documentId, periodOf(ctx)) };
	},

	/** GET /api/page-views/site?period= (SuperAdmin) */
	async site(ctx) {
		if (requireAdmin(ctx) !== true) return;
		ctx.body = { data: await siteAudience(strapi, periodOf(ctx)) };
	},

	/** GET /api/page-views/doctors?period= (SuperAdmin) : classement, filtré et trié côté site */
	async doctors(ctx) {
		if (requireAdmin(ctx) !== true) return;
		ctx.body = { data: await doctorsRanking(strapi, periodOf(ctx)) };
	},
};
