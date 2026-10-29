'use strict';

const billing = require('../../../billing');

const ADMIN_ROLE = 'SuperAdmin';
const MAX_OFFERED_MONTHS = 24;

const requireAdmin = (ctx) => {
	if (!ctx.state.user) return ctx.unauthorized();
	if (ctx.state.user.role?.name !== ADMIN_ROLE) return ctx.forbidden();
	return true;
};

const monthsOf = (ctx) => {
	const months = Number(ctx.request.body?.months);
	return Number.isInteger(months) && months >= 1 && months <= MAX_OFFERED_MONTHS ? months : null;
};

/** Erreurs prévues (status + message) renvoyées telles quelles, les autres journalisées */
const run = async (ctx, action) => {
	try {
		return await action();
	} catch (error) {
		if (error.expose || error.status === 503) {
			ctx.status = error.status;
			ctx.body = { error: { status: error.status, message: error.message } };
			return undefined;
		}
		strapi.log.error(`Abonnements : ${error.message}`);
		ctx.status = 502;
		ctx.body = { error: { status: 502, message: 'Le service de paiement est indisponible. Réessayez dans un instant.' } };
		return undefined;
	}
};

const mineOrForbid = async (ctx) => {
	if (!ctx.state.user) return ctx.unauthorized();
	const doctor = await billing.doctorOfUser(strapi, ctx.state.user);
	if (!doctor) return ctx.forbidden('Réservé aux praticiens.');
	return doctor;
};

module.exports = {
	/** GET /api/billing/mine : abonnement du praticien connecté */
	async mine(ctx) {
		const doctor = await mineOrForbid(ctx);
		if (!doctor?.id) return;
		ctx.body = { data: billing.summary(doctor) };
	},

	/** POST /api/billing/sync : relit l'abonnement chez Stripe (retour de la page de paiement) */
	async sync(ctx) {
		const doctor = await mineOrForbid(ctx);
		if (!doctor?.id) return;
		await run(ctx, async () => {
			ctx.body = { data: billing.summary(await billing.syncDoctor(strapi, doctor)) };
		});
	},

	/** POST /api/billing/subscribe { interval: 'month' | 'year' } → { mode, clientSecret } */
	async subscribe(ctx) {
		if (!ctx.state.user) return ctx.unauthorized();
		await run(ctx, async () => {
			ctx.body = { data: await billing.prepareSubscription(strapi, ctx.state.user, ctx.request.body?.interval) };
		});
	},

	/** POST /api/billing/confirm { setupIntent } : abonnement avec essai, une fois la carte validée */
	async confirm(ctx) {
		if (!ctx.state.user) return ctx.unauthorized();
		await run(ctx, async () => {
			const doctor = await billing.confirmTrialSubscription(strapi, ctx.state.user, ctx.request.body?.setupIntent);
			ctx.body = { data: billing.summary(doctor) };
		});
	},

	/** POST /api/billing/portal → { url } */
	async portal(ctx) {
		if (!ctx.state.user) return ctx.unauthorized();
		await run(ctx, async () => {
			ctx.body = { url: await billing.createPortal(strapi, ctx.state.user) };
		});
	},

	/** POST /api/billing/webhook (Stripe) */
	async webhook(ctx) {
		const raw = ctx.request.body?.[Symbol.for('unparsedBody')];
		if (!raw) return ctx.badRequest('Corps brut manquant.');
		await run(ctx, async () => {
			await billing.handleWebhook(strapi, raw, ctx.request.headers['stripe-signature']);
			ctx.body = { received: true };
		});
	},

	/** GET /api/billing/doctors/:documentId (SuperAdmin) */
	async doctor(ctx) {
		if (requireAdmin(ctx) !== true) return;
		const doctor = await billing.findDoctor(strapi, { documentId: ctx.params.documentId });
		if (!doctor) return ctx.notFound();
		ctx.body = { data: billing.summary(doctor) };
	},

	/** POST /api/billing/doctors/:documentId/offer { months } (SuperAdmin) */
	async offer(ctx) {
		if (requireAdmin(ctx) !== true) return;
		const months = monthsOf(ctx);
		if (!months) return ctx.badRequest(`Nombre de mois invalide (1 à ${MAX_OFFERED_MONTHS}).`);
		const doctor = await billing.findDoctor(strapi, { documentId: ctx.params.documentId });
		if (!doctor) return ctx.notFound();
		await run(ctx, async () => {
			ctx.body = { data: billing.summary(await billing.offerMonths(strapi, doctor, months)) };
		});
	},

	/** POST /api/billing/offer-all { months } (SuperAdmin) : tous les praticiens validés */
	async offerAll(ctx) {
		if (requireAdmin(ctx) !== true) return;
		const months = monthsOf(ctx);
		if (!months) return ctx.badRequest(`Nombre de mois invalide (1 à ${MAX_OFFERED_MONTHS}).`);
		const doctors = await strapi.db.query('api::doctor.doctor').findMany({
			where: { isActive: true },
			select: billing.DOCTOR_FIELDS,
		});
		let done = 0;
		const failed = [];
		for (const doctor of doctors) {
			try {
				await billing.offerMonths(strapi, doctor, months);
				done += 1;
			} catch (error) {
				strapi.log.error(`Abonnements : mois non offerts à ${doctor.documentId} (${error.message})`);
				failed.push(doctor.documentId);
			}
		}
		ctx.body = { data: { done, failed } };
	},
};
