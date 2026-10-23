'use strict';

/**
 * support-ticket controller
 *
 * - Un utilisateur ne voit, ne modifie et ne supprime que ses propres demandes.
 * - Le demandeur est toujours le compte connecté, rattaché par le serveur.
 * - Le demandeur (relation vers User) est ajouté côté serveur quand il est demandé :
 *   Strapi refuserait sinon le populate explicite (400).
 * Le SuperAdmin voit toutes les demandes.
 */

const { createCoreController } = require('@strapi/strapi').factories;
const { isAdmin, PUBLIC_USER_FIELDS, withoutPopulate, withoutFilter } = require('../../../utils/owned-content');

const UID = 'api::support-ticket.support-ticket';
const OWNER = 'users_permissions_user';

const ownTicket = (strapi, documentId, userId) =>
	strapi.documents(UID).findFirst({
		filters: { documentId, [OWNER]: { id: userId } },
		fields: ['id'],
	});

/** Prépare la requête : retire filtre et populate sur le demandeur. Renvoie true s'il était demandé. */
const stripOwnerFromQuery = (ctx) => {
	const { populate, removed } = withoutPopulate(ctx.query?.populate, OWNER);
	ctx.query = { ...ctx.query, populate, filters: withoutFilter(ctx.query?.filters, OWNER) };
	return removed;
};

/** Ajoute le demandeur (champs publics) aux demandes. */
const attachRequester = async (strapi, tickets) => {
	const list = (Array.isArray(tickets) ? tickets : [tickets]).filter(Boolean);
	const ids = list.map((t) => t.documentId).filter(Boolean);
	if (!ids.length) return;
	const rows = await strapi.documents(UID).findMany({
		filters: { documentId: { $in: ids } },
		fields: ['documentId'],
		populate: { [OWNER]: { fields: PUBLIC_USER_FIELDS } },
		limit: ids.length,
	});
	const byId = new Map(rows.map((r) => [r.documentId, r[OWNER] ?? null]));
	for (const ticket of list) ticket[OWNER] = byId.get(ticket.documentId) ?? null;
};

module.exports = createCoreController(UID, ({ strapi }) => ({
	async find(ctx) {
		const user = ctx.state.user;
		if (!user) return ctx.unauthorized();
		const withRequester = stripOwnerFromQuery(ctx);

		await this.validateQuery(ctx);
		const sanitizedQuery = await this.sanitizeQuery(ctx);
		const { results, pagination } = await strapi.service(UID).find({
			...sanitizedQuery,
			...(!isAdmin(user) && {
				filters: { $and: [sanitizedQuery.filters || {}, { [OWNER]: { id: user.id } }] },
			}),
		});
		const sanitizedResults = await this.sanitizeOutput(results, ctx);
		if (withRequester) await attachRequester(strapi, sanitizedResults);
		return this.transformResponse(sanitizedResults, { pagination });
	},

	async findOne(ctx) {
		const user = ctx.state.user;
		if (!user) return ctx.unauthorized();
		const { id } = ctx.params;
		if (!isAdmin(user) && !(await ownTicket(strapi, id, user.id))) return ctx.notFound();
		const withRequester = stripOwnerFromQuery(ctx);

		await this.validateQuery(ctx);
		const sanitizedQuery = await this.sanitizeQuery(ctx);
		const entity = await strapi.service(UID).findOne(id, sanitizedQuery);
		if (!entity) return ctx.notFound();
		const sanitizedEntity = await this.sanitizeOutput(entity, ctx);
		if (withRequester) await attachRequester(strapi, sanitizedEntity);
		return this.transformResponse(sanitizedEntity);
	},

	async create(ctx) {
		const user = ctx.state.user;
		if (!user) return ctx.unauthorized();

		const body = ctx.request.body || {};
		const data = { ...(body.data || {}) };
		delete data[OWNER];
		ctx.request.body = { ...body, data };

		await this.validateQuery(ctx);
		const sanitizedQuery = await this.sanitizeQuery(ctx);
		await this.validateInput(data, ctx);
		const sanitizedInput = await this.sanitizeInput(data, ctx);
		const entity = await strapi.service(UID).create({
			...sanitizedQuery,
			data: { ...sanitizedInput, [OWNER]: user.id },
		});
		const sanitizedEntity = await this.sanitizeOutput(entity, ctx);
		ctx.status = 201;
		return this.transformResponse(sanitizedEntity);
	},

	async update(ctx) {
		const user = ctx.state.user;
		if (!user) return ctx.unauthorized();
		if (!isAdmin(user) && !(await ownTicket(strapi, ctx.params.id, user.id))) return ctx.forbidden();

		const body = ctx.request.body || {};
		const data = { ...(body.data || {}) };
		delete data[OWNER];
		ctx.request.body = { ...body, data };
		return super.update(ctx);
	},

	// Le demandeur peut retirer sa demande (ex. premier message en échec)
	async delete(ctx) {
		const user = ctx.state.user;
		if (!user) return ctx.unauthorized();
		if (!isAdmin(user) && !(await ownTicket(strapi, ctx.params.id, user.id))) return ctx.forbidden();
		return super.delete(ctx);
	},
}));
