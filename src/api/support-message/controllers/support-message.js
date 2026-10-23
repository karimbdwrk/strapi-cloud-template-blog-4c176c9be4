'use strict';

/**
 * support-message controller
 *
 * - Un utilisateur ne lit que les messages de ses propres demandes.
 * - L'auteur est toujours le compte connecté, rattaché par le serveur ;
 *   un utilisateur ne peut écrire que dans ses demandes, jamais « en tant qu'admin ».
 * - L'auteur (relation vers User) est ajouté côté serveur quand il est demandé :
 *   Strapi refuserait sinon le populate explicite (400).
 * Le SuperAdmin lit et écrit dans toutes les demandes.
 */

const { createCoreController } = require('@strapi/strapi').factories;
const { isAdmin, PUBLIC_USER_FIELDS, withoutPopulate, withoutFilter } = require('../../../utils/owned-content');

const UID = 'api::support-message.support-message';
const TICKET_UID = 'api::support-ticket.support-ticket';
const AUTHOR = 'users_permissions_user';
const TICKET = 'support_ticket';

const stripAuthorFromQuery = (ctx) => {
	const { populate, removed } = withoutPopulate(ctx.query?.populate, AUTHOR);
	ctx.query = { ...ctx.query, populate, filters: withoutFilter(ctx.query?.filters, AUTHOR) };
	return removed;
};

/** Ajoute l'auteur (champs publics) aux messages. */
const attachAuthors = async (strapi, messages) => {
	const list = (Array.isArray(messages) ? messages : [messages]).filter(Boolean);
	const ids = list.map((m) => m.documentId).filter(Boolean);
	if (!ids.length) return;
	const rows = await strapi.documents(UID).findMany({
		filters: { documentId: { $in: ids } },
		fields: ['documentId'],
		populate: { [AUTHOR]: { fields: PUBLIC_USER_FIELDS } },
		limit: ids.length,
	});
	const byId = new Map(rows.map((r) => [r.documentId, r[AUTHOR] ?? null]));
	for (const message of list) message[AUTHOR] = byId.get(message.documentId) ?? null;
};

/** Demande visée par un message ({ documentId } | documentId | id), si elle appartient à l'utilisateur. */
const ownTicketFromInput = async (strapi, value, userId) => {
	const ref = value?.connect?.[0] ?? value?.set?.[0] ?? value;
	const key = ref?.documentId ?? ref?.id ?? ref;
	if (key === undefined || key === null || key === '') return null;
	const filters = typeof key === 'number' || /^\d+$/.test(String(key)) ? { id: Number(key) } : { documentId: String(key) };
	return strapi.documents(TICKET_UID).findFirst({
		filters: { ...filters, users_permissions_user: { id: userId } },
		fields: ['id'],
	});
};

module.exports = createCoreController(UID, ({ strapi }) => ({
	async find(ctx) {
		const user = ctx.state.user;
		if (!user) return ctx.unauthorized();
		const withAuthor = stripAuthorFromQuery(ctx);

		await this.validateQuery(ctx);
		const sanitizedQuery = await this.sanitizeQuery(ctx);
		const { results, pagination } = await strapi.service(UID).find({
			...sanitizedQuery,
			...(!isAdmin(user) && {
				filters: {
					$and: [sanitizedQuery.filters || {}, { [TICKET]: { users_permissions_user: { id: user.id } } }],
				},
			}),
		});
		const sanitizedResults = await this.sanitizeOutput(results, ctx);
		if (withAuthor) await attachAuthors(strapi, sanitizedResults);
		return this.transformResponse(sanitizedResults, { pagination });
	},

	async findOne(ctx) {
		const user = ctx.state.user;
		if (!user) return ctx.unauthorized();
		const { id } = ctx.params;
		if (!isAdmin(user)) {
			const own = await strapi.documents(UID).findFirst({
				filters: { documentId: id, [TICKET]: { users_permissions_user: { id: user.id } } },
				fields: ['id'],
			});
			if (!own) return ctx.notFound();
		}
		const withAuthor = stripAuthorFromQuery(ctx);

		await this.validateQuery(ctx);
		const sanitizedQuery = await this.sanitizeQuery(ctx);
		const entity = await strapi.service(UID).findOne(id, sanitizedQuery);
		if (!entity) return ctx.notFound();
		const sanitizedEntity = await this.sanitizeOutput(entity, ctx);
		if (withAuthor) await attachAuthors(strapi, sanitizedEntity);
		return this.transformResponse(sanitizedEntity);
	},

	async create(ctx) {
		const user = ctx.state.user;
		if (!user) return ctx.unauthorized();

		const body = ctx.request.body || {};
		const data = { ...(body.data || {}) };
		delete data[AUTHOR];
		if (!isAdmin(user)) {
			if (!(await ownTicketFromInput(strapi, data[TICKET], user.id))) {
				return ctx.forbidden('Vous ne pouvez écrire que dans vos propres demandes.');
			}
			data.fromAdmin = false;
		}
		ctx.request.body = { ...body, data };

		await this.validateQuery(ctx);
		const sanitizedQuery = await this.sanitizeQuery(ctx);
		await this.validateInput(data, ctx);
		const sanitizedInput = await this.sanitizeInput(data, ctx);
		// Auteur rattaché dans la création même : la notification part juste après et le lit
		const entity = await strapi.service(UID).create({
			...sanitizedQuery,
			data: { ...sanitizedInput, [AUTHOR]: user.id },
		});
		const sanitizedEntity = await this.sanitizeOutput(entity, ctx);
		ctx.status = 201;
		return this.transformResponse(sanitizedEntity);
	},

	async update(ctx) {
		if (!isAdmin(ctx.state.user)) return ctx.forbidden();
		return super.update(ctx);
	},

	async delete(ctx) {
		if (!isAdmin(ctx.state.user)) return ctx.forbidden();
		return super.delete(ctx);
	},
}));
