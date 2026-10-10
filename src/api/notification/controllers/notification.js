'use strict';

/**
 * notification controller
 *
 * Chaque utilisateur ne voit et ne modifie que ses propres notifications,
 * quelle que soit la requête envoyée. Seul `readAt` est modifiable.
 * La création se fait uniquement côté serveur, via le service `notify()`.
 */

const { createCoreController } = require('@strapi/strapi').factories;

const UID = 'api::notification.notification';
const PUBLIC_FIELDS = ['type', 'title', 'body', 'link', 'readAt', 'createdAt'];
const MAX_PAGE_SIZE = 50;

const toInt = (value, fallback) => {
	const n = parseInt(value, 10);
	return Number.isFinite(n) && n > 0 ? n : fallback;
};

module.exports = createCoreController(UID, ({ strapi }) => ({
	/** GET /notifications?pagination[page]=1&pagination[pageSize]=20&unread=true */
	async find(ctx) {
		const user = ctx.state.user;
		if (!user) return ctx.unauthorized();

		const page = toInt(ctx.query?.pagination?.page, 1);
		const pageSize = Math.min(toInt(ctx.query?.pagination?.pageSize, 20), MAX_PAGE_SIZE);
		const filters = { recipient: { id: user.id } };
		if (ctx.query?.unread === 'true') filters.readAt = { $null: true };

		const [data, total] = await Promise.all([
			strapi.documents(UID).findMany({
				filters,
				fields: PUBLIC_FIELDS,
				sort: { createdAt: 'desc' },
				limit: pageSize,
				start: (page - 1) * pageSize,
			}),
			strapi.documents(UID).count({ filters }),
		]);

		return {
			data,
			meta: { pagination: { page, pageSize, pageCount: Math.ceil(total / pageSize), total } },
		};
	},

	/** GET /notifications/:id */
	async findOne(ctx) {
		const user = ctx.state.user;
		if (!user) return ctx.unauthorized();

		const notification = await strapi.documents(UID).findFirst({
			filters: { documentId: ctx.params.id, recipient: { id: user.id } },
			fields: PUBLIC_FIELDS,
		});
		if (!notification) return ctx.notFound();
		return { data: notification };
	},

	/** PUT /notifications/:id  { data: { read: true | false } } : marque comme lue / non lue. */
	async update(ctx) {
		const user = ctx.state.user;
		if (!user) return ctx.unauthorized();

		const existing = await strapi.documents(UID).findFirst({
			filters: { documentId: ctx.params.id, recipient: { id: user.id } },
			fields: ['id'],
		});
		if (!existing) return ctx.notFound();

		const read = ctx.request.body?.data?.read !== false;
		const updated = await strapi.documents(UID).update({
			documentId: ctx.params.id,
			data: { readAt: read ? new Date() : null },
			fields: PUBLIC_FIELDS,
		});
		return { data: updated };
	},

	/** GET /notifications/unread-count */
	async unreadCount(ctx) {
		const user = ctx.state.user;
		if (!user) return ctx.unauthorized();

		const count = await strapi.documents(UID).count({
			filters: { recipient: { id: user.id }, readAt: { $null: true } },
		});
		return { data: { count } };
	},

	/** PUT /notifications/read-all */
	async readAll(ctx) {
		const user = ctx.state.user;
		if (!user) return ctx.unauthorized();

		const { count } = await strapi.db.query(UID).updateMany({
			where: { recipient: user.id, readAt: null },
			data: { readAt: new Date() },
		});
		return { data: { count } };
	},

	// Création et suppression réservées au serveur
	async create(ctx) {
		return ctx.forbidden();
	},
	async delete(ctx) {
		return ctx.forbidden();
	},
}));
