'use strict';

/**
 * profession-family controller
 *
 * Routes de base : lecture publique des familles (filtres de recherche, inscription).
 * adminList / adminCreate / adminUpdate / adminDelete : gestion des familles par l'admin Meyana
 * (/admin/metiers?onglet=familles). Le slug d'une famille ne change pas quand on la renomme
 * (le catalogue des métiers la retrouve par son slug) ; une famille qui contient encore des
 * métiers ne peut pas être supprimée, et une famille supprimée n'est pas recréée au démarrage.
 */

const { createCoreController } = require('@strapi/strapi').factories;
const { slugify, recordAdminChange } = require('../../../professions');

const UID = 'api::profession-family.profession-family';
const ADMIN_ROLE = 'SuperAdmin';
const DOMAINS = ['medical', 'paramedical', 'wellbeing'];
const NAME_MIN = 2;
const NAME_MAX = 80;
const ORDER_MAX = 999;

const isAdmin = (user) => user?.role?.name === ADMIN_ROLE;
const clean = (text) => String(text || '').replace(/\s+/g, ' ').trim();

const ADMIN_POPULATE = { categories: { fields: ['name', 'professionName'] } };

const adminView = (f) => ({
	documentId: f.documentId,
	name: f.name,
	slug: f.slug,
	domain: f.domain,
	order: f.order ?? 0,
	categories: (f.categories || [])
		.map((c) => ({ documentId: c.documentId, name: c.professionName || c.name }))
		.sort((a, b) => a.name.localeCompare(b.name, 'fr')),
});

const byDomainThenOrder = (a, b) =>
	DOMAINS.indexOf(a.domain) - DOMAINS.indexOf(b.domain) || a.order - b.order || a.name.localeCompare(b.name, 'fr');

module.exports = createCoreController(UID, ({ strapi }) => {
	const loadOne = (documentId) => strapi.documents(UID).findOne({ documentId, populate: ADMIN_POPULATE });

	/** Champs saisis, vérifiés : { data } ou { error } */
	const validate = async (input, currentId) => {
		const data = { name: clean(input.name), domain: input.domain };
		if (data.name.length < NAME_MIN || data.name.length > NAME_MAX) {
			return { error: `Le nom de la famille fait entre ${NAME_MIN} et ${NAME_MAX} caractères.` };
		}
		if (!DOMAINS.includes(data.domain)) return { error: 'Domaine inconnu.' };

		const others = (await strapi.documents(UID).findMany({ fields: ['name', 'slug', 'domain', 'order'], limit: -1 })).filter(
			(f) => f.documentId !== currentId
		);
		if (others.some((f) => clean(f.name).toLowerCase() === data.name.toLowerCase())) {
			return { error: `La famille « ${data.name} » existe déjà.` };
		}

		// Ordre dans le domaine : saisi, sinon à la suite des familles du domaine
		if (input.order !== undefined && input.order !== null && input.order !== '') {
			const order = Number(input.order);
			if (!Number.isInteger(order) || order < 0 || order > ORDER_MAX) {
				return { error: `L’ordre est un nombre entier entre 0 et ${ORDER_MAX}.` };
			}
			data.order = order;
		} else if (!currentId) {
			data.order = Math.max(0, ...others.filter((f) => f.domain === data.domain).map((f) => f.order ?? 0)) + 1;
		}

		// Slug fixé à la création (unique), gardé ensuite
		if (!currentId) {
			const base = slugify(data.name) || 'famille';
			const taken = new Set(others.map((f) => f.slug));
			let slug = base;
			for (let i = 2; taken.has(slug); i++) slug = `${base}-${i}`;
			data.slug = slug;
		}
		return { data };
	};

	return {
		/** Toutes les familles avec leurs métiers, rangées par domaine puis par ordre */
		async adminList(ctx) {
			if (!isAdmin(ctx.state.user)) return ctx.forbidden();
			const families = await strapi.documents(UID).findMany({ populate: ADMIN_POPULATE, limit: -1 });
			ctx.body = { data: families.map(adminView).sort(byDomainThenOrder) };
		},

		async adminCreate(ctx) {
			if (!isAdmin(ctx.state.user)) return ctx.forbidden();
			const { data, error } = await validate(ctx.request.body?.data || {});
			if (error) return ctx.badRequest(error);
			const created = await strapi.documents(UID).create({ data });
			ctx.body = { data: adminView(await loadOne(created.documentId)) };
		},

		async adminUpdate(ctx) {
			if (!isAdmin(ctx.state.user)) return ctx.forbidden();
			const existing = await strapi.documents(UID).findOne({ documentId: ctx.params.id, fields: ['id'] });
			if (!existing) return ctx.notFound();
			const { data, error } = await validate(ctx.request.body?.data || {}, ctx.params.id);
			if (error) return ctx.badRequest(error);
			await strapi.documents(UID).update({ documentId: ctx.params.id, data });
			ctx.body = { data: adminView(await loadOne(ctx.params.id)) };
		},

		async adminDelete(ctx) {
			if (!isAdmin(ctx.state.user)) return ctx.forbidden();
			const family = await loadOne(ctx.params.id);
			if (!family) return ctx.notFound();
			const count = family.categories?.length || 0;
			if (count) {
				return ctx.badRequest(
					`Cette famille contient encore ${count} métier${count > 1 ? 's' : ''} : retirez-les d’abord depuis l’onglet Métiers.`
				);
			}
			await strapi.documents(UID).delete({ documentId: ctx.params.id });
			await recordAdminChange(strapi, { removedFamilies: [family.slug, family.name] });
			ctx.body = { ok: true };
		},
	};
});
