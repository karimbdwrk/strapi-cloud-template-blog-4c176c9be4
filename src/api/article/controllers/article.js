'use strict';

/**
 * article controller
 *
 * - create : réservé aux praticiens dont le profil est validé (isActive). L'auteur est le profil
 *            du compte connecté, fixé par le serveur (jamais celui envoyé par le navigateur).
 * - update / delete : l'auteur (profil toujours validé) ou un SuperAdmin.
 * - find / findOne : inchangés (blog public).
 */

const { createCoreController } = require('@strapi/strapi').factories;

const UID = 'api::article.article';
const DOCTOR = 'api::doctor.doctor';
const ADMIN_ROLE = 'SuperAdmin';
const NOT_VALIDATED = 'Votre profil doit être validé par l’équipe Meyana avant de publier sur le blog.';

const isAdmin = (user) => user?.role?.name === ADMIN_ROLE;

module.exports = createCoreController(UID, ({ strapi }) => {
	const myDoctor = (user) =>
		strapi.documents(DOCTOR).findFirst({
			filters: { users_permissions_user: { id: user.id } },
			fields: ['id', 'isActive'],
		});

	/** Praticien validé du compte connecté, ou null (la réponse d'erreur est déjà posée) */
	const activeDoctor = async (ctx) => {
		const user = ctx.state.user;
		if (!user) {
			ctx.unauthorized();
			return null;
		}
		const doctor = await myDoctor(user);
		if (!doctor) {
			ctx.forbidden('Seuls les praticiens référencés peuvent publier sur le blog.');
			return null;
		}
		if (!doctor.isActive) {
			ctx.forbidden(NOT_VALIDATED);
			return null;
		}
		return doctor;
	};

	/** L'article appartient-il au praticien ? */
	const ownsArticle = async (doctor, documentId) =>
		Boolean(
			await strapi.documents(UID).findFirst({
				filters: { documentId, author: { id: doctor.id } },
				fields: ['id'],
			})
		);

	return {
		async create(ctx) {
			if (isAdmin(ctx.state.user)) return super.create(ctx);
			const doctor = await activeDoctor(ctx);
			if (!doctor) return;
			const body = ctx.request.body || {};
			ctx.request.body = { ...body, data: { ...(body.data || {}), author: doctor.id } };
			return super.create(ctx);
		},

		async update(ctx) {
			if (isAdmin(ctx.state.user)) return super.update(ctx);
			const doctor = await activeDoctor(ctx);
			if (!doctor) return;
			if (!(await ownsArticle(doctor, ctx.params.id))) return ctx.forbidden('Vous ne pouvez modifier que vos articles.');
			// L'auteur ne change pas
			const body = ctx.request.body || {};
			const { author, ...data } = body.data || {};
			ctx.request.body = { ...body, data };
			return super.update(ctx);
		},

		async delete(ctx) {
			if (isAdmin(ctx.state.user)) return super.delete(ctx);
			const doctor = await activeDoctor(ctx);
			if (!doctor) return;
			if (!(await ownsArticle(doctor, ctx.params.id))) return ctx.forbidden('Vous ne pouvez supprimer que vos articles.');
			return super.delete(ctx);
		},
	};
});
