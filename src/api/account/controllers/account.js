'use strict';

const account = require('../../../account');

// Suppression : 5 essais de mot de passe par compte et par heure
const attempts = new Map();
const tooManyAttempts = (userId) => {
	const now = Date.now();
	const entry = attempts.get(userId);
	if (!entry || now > entry.reset) {
		attempts.set(userId, { count: 1, reset: now + 60 * 60 * 1000 });
		return false;
	}
	entry.count += 1;
	return entry.count > 5;
};

const fail = (ctx, error, label) => {
	if (error.expose) {
		ctx.status = error.status;
		ctx.body = { error: { status: error.status, message: error.message, ...(error.field && { details: { field: error.field } }) } };
		return;
	}
	strapi.log.error(`${label} : ${error.message}`);
	ctx.status = 500;
	ctx.body = { error: { status: 500, message: 'Une erreur est survenue. Réessayez dans un instant.' } };
};

module.exports = {
	async export(ctx) {
		const user = ctx.state.user;
		if (!user) return ctx.unauthorized();
		try {
			const data = await account.exportData(strapi, user.id);
			const day = new Date().toISOString().slice(0, 10);
			ctx.set('Content-Disposition', `attachment; filename="meyana-mes-donnees-${day}.json"`);
			ctx.set('Cache-Control', 'no-store');
			ctx.body = data;
		} catch (error) {
			fail(ctx, error, 'Export des données');
		}
	},

	async remove(ctx) {
		const user = ctx.state.user;
		if (!user) return ctx.unauthorized();
		if (tooManyAttempts(user.id)) {
			ctx.status = 429;
			ctx.body = { error: { status: 429, message: 'Trop de tentatives. Réessayez dans une heure.' } };
			return;
		}
		try {
			const { password, reason } = ctx.request.body || {};
			ctx.body = await account.deleteAccount(strapi, user.id, { password, reason });
		} catch (error) {
			fail(ctx, error, 'Suppression de compte');
		}
	},
};
