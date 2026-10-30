'use strict';

const payments = require('../../../payments');
const invoices = require('../../../invoices');

/** Erreurs prévues renvoyées telles quelles, les autres journalisées */
const run = async (ctx, action) => {
	if (!ctx.state.user) return ctx.unauthorized();
	try {
		ctx.body = await action(ctx.state.user);
	} catch (error) {
		if (!error.expose) strapi.log.error(`Versements : ${error.message}`);
		ctx.status = error.expose ? error.status : 502;
		ctx.body = {
			error: {
				status: ctx.status,
				message: error.expose ? error.message : 'Le service de paiement est indisponible. Réessayez dans un instant.',
			},
		};
	}
};

const doctorOf = async (user) => {
	const doctor = await payments.doctorOfUser(strapi, user);
	if (!doctor) throw Object.assign(new Error('Réservé aux praticiens.'), { status: 403, expose: true });
	return doctor;
};

module.exports = {
	async mine(ctx) {
		await run(ctx, async (user) => ({ data: await payments.accountSummary(strapi, user) }));
	},
	async onboarding(ctx) {
		await run(ctx, async (user) => ({ url: await payments.onboardingLink(strapi, user, ctx.request.body?.returnPath) }));
	},
	async dashboard(ctx) {
		await run(ctx, async (user) => ({ url: await payments.dashboardLink(strapi, user) }));
	},
	async invoices(ctx) {
		await run(ctx, async (user) => ({ data: await invoices.listInvoices(strapi, await doctorOf(user)) }));
	},
	async billingInfo(ctx) {
		await run(ctx, async (user) => ({
			data: await invoices.saveBillingInfo(strapi, await doctorOf(user), ctx.request.body?.data),
		}));
	},
};
