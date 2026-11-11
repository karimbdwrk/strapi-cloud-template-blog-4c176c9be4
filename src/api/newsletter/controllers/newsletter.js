'use strict';

const newsletter = require('../../../newsletter');

const ADMIN_ROLE = 'SuperAdmin';

module.exports = {
	async subscribe(ctx) {
		const result = await newsletter.subscribe(strapi, ctx, ctx.request.body?.email);
		if (result === 'invalid') return ctx.badRequest('Adresse email invalide.');
		if (result === 'limited') {
			ctx.status = 429;
			ctx.body = { error: { status: 429, message: 'Trop d’inscriptions depuis cette connexion. Réessayez plus tard.' } };
			return;
		}
		ctx.body = { ok: true };
	},

	async unsubscribe(ctx) {
		const body = ctx.request.body || {};
		const token = body.token || ctx.query.token;
		if (token) {
			if (!(await newsletter.unsubscribeByToken(strapi, token))) return ctx.notFound('Lien de désinscription invalide.');
		} else if (body.email) {
			await newsletter.unsubscribeByEmail(strapi, body.email);
		} else {
			return ctx.badRequest('Lien ou adresse email manquant.');
		}
		ctx.body = { ok: true };
	},

	async export(ctx) {
		if (!ctx.state.user) return ctx.unauthorized();
		if (ctx.state.user.role?.name !== ADMIN_ROLE) return ctx.forbidden();
		ctx.set('Content-Type', 'text/csv; charset=utf-8');
		ctx.set('Content-Disposition', `attachment; filename="newsletter-${new Date().toISOString().slice(0, 10)}.csv"`);
		ctx.body = await newsletter.exportCsv(strapi);
	},
};
