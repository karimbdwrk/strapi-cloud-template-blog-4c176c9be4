'use strict';

/**
 * user-record controller (dossier patient : contient des données de santé)
 *
 * - create  : rattaché au compte connecté par le serveur
 * - find    : un utilisateur ne voit que son propre dossier
 * - findOne / update : uniquement son propre dossier
 * - delete  : réservé au SuperAdmin
 * Le SuperAdmin garde un accès complet.
 */

const { createCoreController } = require('@strapi/strapi').factories;
const { patientWelcomeEmail } = require('../../../notifications/account-emails');

const UID = 'api::user-record.user-record';
const USER_UID = 'plugin::users-permissions.user';
const ADMIN_ROLE = 'SuperAdmin';

const isAdmin = (user) => user?.role?.name === ADMIN_ROLE;

const ownRecord = (strapi, documentId, userId) =>
	strapi.documents(UID).findFirst({
		filters: { documentId, users_permissions_user: { id: userId } },
		fields: ['id'],
	});

module.exports = createCoreController(UID, ({ strapi }) => ({
	async create(ctx) {
		const user = ctx.state.user;
		if (!user) return ctx.unauthorized();
		if (isAdmin(user)) return super.create(ctx);

		const existing = await strapi.documents(UID).findFirst({
			filters: { users_permissions_user: { id: user.id } },
			fields: ['id'],
		});
		if (existing) return ctx.badRequest('Un dossier patient existe déjà pour ce compte.');

		const body = ctx.request.body || {};
		const data = { ...(body.data || {}) };
		delete data.users_permissions_user;
		ctx.request.body = { ...body, data };

		const response = await super.create(ctx);
		const documentId = response?.data?.documentId;
		if (documentId) {
			await strapi.documents(UID).update({ documentId, data: { users_permissions_user: user.id } });
			await strapi.db.query(USER_UID).update({
				where: { id: user.id },
				data: {
					...(data.firstname && { firstname: data.firstname }),
					...(data.lastname && { lastname: data.lastname }),
				},
			});
			// Email de bienvenue (toujours envoyé : ce n'est pas une notification réglable)
			await strapi.service('api::notification.notification').emailUser({
				recipient: user.id,
				email: patientWelcomeEmail({ firstname: data.firstname || user.firstname }),
			});
		}
		return response;
	},

	async find(ctx) {
		const user = ctx.state.user;
		if (!user) return ctx.unauthorized();
		if (isAdmin(user)) return super.find(ctx);

		// Filtre imposé : le dossier de l'utilisateur connecté uniquement.
		// Il est ajouté après la validation de la requête : Strapi refuse (400) un filtre
		// sur users_permissions_user quand le rôle n'a pas accès au modèle User.
		await this.validateQuery(ctx);
		const sanitizedQuery = await this.sanitizeQuery(ctx);
		const { results, pagination } = await strapi.service(UID).find({
			...sanitizedQuery,
			filters: { users_permissions_user: { id: user.id } },
		});
		const sanitizedResults = await this.sanitizeOutput(results, ctx);
		return this.transformResponse(sanitizedResults, { pagination });
	},

	async findOne(ctx) {
		const user = ctx.state.user;
		if (!user) return ctx.unauthorized();
		if (!isAdmin(user) && !(await ownRecord(strapi, ctx.params.id, user.id))) return ctx.notFound();
		return super.findOne(ctx);
	},

	async update(ctx) {
		const user = ctx.state.user;
		if (!user) return ctx.unauthorized();
		if (!isAdmin(user)) {
			if (!(await ownRecord(strapi, ctx.params.id, user.id))) return ctx.forbidden();
			const body = ctx.request.body || {};
			const data = { ...(body.data || {}) };
			delete data.users_permissions_user;
			ctx.request.body = { ...body, data };
		}
		const response = await super.update(ctx);

		// Nom et prénom du compte alignés sur ceux du dossier (propriétaire du dossier)
		const { firstname, lastname } = ctx.request.body?.data || {};
		if (!isAdmin(user) && (firstname || lastname)) {
			await strapi.db.query(USER_UID).update({
				where: { id: user.id },
				data: {
					...(firstname && { firstname }),
					...(lastname && { lastname }),
				},
			});
		}
		return response;
	},

	async delete(ctx) {
		if (!isAdmin(ctx.state.user)) return ctx.forbidden();
		return super.delete(ctx);
	},
}));
