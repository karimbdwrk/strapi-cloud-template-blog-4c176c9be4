'use strict';

/**
 * doctor controller
 *
 * - create : le profil est rattaché au compte connecté par le serveur
 *            (jamais à un identifiant envoyé par le navigateur).
 * - update : un praticien ne modifie que son propre profil.
 * Dans les deux cas, les champs de modération (validation, badge, compte lié)
 * ne peuvent être changés que par un SuperAdmin.
 */

const { createCoreController } = require('@strapi/strapi').factories;

const UID = 'api::doctor.doctor';
const USER_UID = 'plugin::users-permissions.user';
const ADMIN_ROLE = 'SuperAdmin';
const PROTECTED_FIELDS = ['isActive', 'isRecommended', 'users_permissions_user'];

const isAdmin = (user) => user?.role?.name === ADMIN_ROLE;

const stripProtected = (data = {}) => {
	const clean = { ...data };
	for (const field of PROTECTED_FIELDS) delete clean[field];
	return clean;
};

module.exports = createCoreController(UID, ({ strapi }) => ({
	async create(ctx) {
		const user = ctx.state.user;
		if (!user) return ctx.unauthorized();
		if (isAdmin(user)) return super.create(ctx);

		const existing = await strapi.documents(UID).findFirst({
			filters: { users_permissions_user: { id: user.id } },
			fields: ['id'],
		});
		if (existing) return ctx.badRequest('Un profil praticien existe déjà pour ce compte.');

		const body = ctx.request.body || {};
		const data = stripProtected(body.data);
		ctx.request.body = { ...body, data };

		const response = await super.create(ctx);
		const documentId = response?.data?.documentId;

		if (documentId) {
			// Rattachement au compte connecté, puis compte marqué « praticien »
			await strapi.documents(UID).update({ documentId, data: { users_permissions_user: user.id } });
			await strapi.db.query(USER_UID).update({
				where: { id: user.id },
				data: {
					isDoctor: true,
					...(data.firstname && { firstname: data.firstname }),
					...(data.lastname && { lastname: data.lastname }),
				},
			});
		}
		return response;
	},

	async update(ctx) {
		const user = ctx.state.user;
		if (!user) return ctx.unauthorized();
		if (isAdmin(user)) return super.update(ctx);

		const own = await strapi.documents(UID).findFirst({
			filters: { documentId: ctx.params.id, users_permissions_user: { id: user.id } },
			fields: ['id'],
		});
		if (!own) return ctx.forbidden('Vous ne pouvez modifier que votre propre profil.');

		const body = ctx.request.body || {};
		ctx.request.body = { ...body, data: stripProtected(body.data) };
		return super.update(ctx);
	},

	async delete(ctx) {
		if (!isAdmin(ctx.state.user)) return ctx.forbidden();
		return super.delete(ctx);
	},
}));
