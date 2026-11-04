'use strict';

/**
 * category controller
 *
 * Routes de base : lecture publique des métiers.
 * adminList / adminCreate / adminUpdate / adminDelete : gestion des métiers par l'admin Meyana
 * (/admin/metiers). Un métier encore choisi par des praticiens ou lié à des rendez-vous
 * ne peut pas être supprimé. Les changements sont retenus pour que le catalogue des métiers
 * (src/professions.js) ne les écrase pas au démarrage.
 */

const { createCoreController } = require('@strapi/strapi').factories;
const { slugify, recordAdminChange } = require('../../../professions');

const UID = 'api::category.category';
const FAMILY = 'api::profession-family.profession-family';
const ADMIN_ROLE = 'SuperAdmin';
const NAME_MIN = 2;
const NAME_MAX = 80;
const DESCRIPTION_MAX = 1000;

const isAdmin = (user) => user?.role?.name === ADMIN_ROLE;
const clean = (text) => String(text || '').replace(/\s+/g, ' ').trim();
const same = (a, b) => clean(a).toLowerCase() === clean(b).toLowerCase();

const ADMIN_POPULATE = {
	families: { fields: ['name', 'domain'] },
	doctors: { fields: ['id'] },
	appointments: { fields: ['id'] },
	keywords: { fields: ['id'] },
};

const adminView = (c) => ({
	documentId: c.documentId,
	name: c.name,
	professionName: c.professionName || '',
	professionNameFeminine: c.professionNameFeminine || '',
	description: c.description || '',
	slug: c.slug,
	families: (c.families || []).map((f) => ({ documentId: f.documentId, name: f.name, domain: f.domain })),
	doctorsCount: c.doctors?.length || 0,
	appointmentsCount: c.appointments?.length || 0,
	keywordsCount: c.keywords?.length || 0,
});

module.exports = createCoreController(UID, ({ strapi }) => {
	const loadOne = (documentId) => strapi.documents(UID).findOne({ documentId, populate: ADMIN_POPULATE });

	/** Champs saisis, vérifiés : { data } ou { error } */
	const validate = async (input, currentId) => {
		const data = {
			name: clean(input.name),
			professionName: clean(input.professionName),
			professionNameFeminine: clean(input.professionNameFeminine) || clean(input.professionName),
			description: String(input.description || '').trim().slice(0, DESCRIPTION_MAX) || null,
		};
		if (data.name.length < NAME_MIN || data.name.length > NAME_MAX) {
			return { error: `Le nom de la spécialité fait entre ${NAME_MIN} et ${NAME_MAX} caractères.` };
		}
		if (data.professionName.length < NAME_MIN || data.professionName.length > NAME_MAX) {
			return { error: `Le nom du métier fait entre ${NAME_MIN} et ${NAME_MAX} caractères.` };
		}
		const others = await strapi.documents(UID).findMany({ fields: ['name', 'professionName', 'slug'], limit: -1 });
		const duplicate = others.find(
			(c) => c.documentId !== currentId && (same(c.name, data.name) || same(c.professionName, data.professionName))
		);
		if (duplicate) return { error: `« ${duplicate.professionName || duplicate.name} » existe déjà.` };

		if (Array.isArray(input.families)) {
			const ids = [...new Set(input.families.map(String))];
			const found = ids.length
				? await strapi.documents(FAMILY).findMany({ filters: { documentId: { $in: ids } }, fields: ['id'], limit: -1 })
				: [];
			if (found.length !== ids.length) return { error: 'Famille de métiers inconnue.' };
			data.families = ids;
		}

		// Slug unique dérivé du nom de la spécialité (gardé tel quel s'il ne change pas)
		const base = slugify(data.name) || 'metier';
		const taken = new Set(others.filter((c) => c.documentId !== currentId).map((c) => c.slug));
		let slug = base;
		for (let i = 2; taken.has(slug); i++) slug = `${base}-${i}`;
		data.slug = slug;
		return { data };
	};

	return {
		/** Tous les métiers (avec leurs familles et leur utilisation) et la liste des familles */
		async adminList(ctx) {
			if (!isAdmin(ctx.state.user)) return ctx.forbidden();
			const [categories, families] = await Promise.all([
				strapi.documents(UID).findMany({ populate: ADMIN_POPULATE, sort: 'professionName:asc', limit: -1 }),
				strapi.documents(FAMILY).findMany({ fields: ['name', 'domain', 'order'], sort: ['order:asc', 'name:asc'], limit: -1 }),
			]);
			ctx.body = {
				data: categories.map(adminView),
				families: families.map((f) => ({ documentId: f.documentId, name: f.name, domain: f.domain })),
			};
		},

		async adminCreate(ctx) {
			if (!isAdmin(ctx.state.user)) return ctx.forbidden();
			const { data, error } = await validate(ctx.request.body?.data || {});
			if (error) return ctx.badRequest(error);
			const created = await strapi.documents(UID).create({ data });
			await recordAdminChange(strapi, { managed: [created.documentId] });
			ctx.body = { data: adminView(await loadOne(created.documentId)) };
		},

		async adminUpdate(ctx) {
			if (!isAdmin(ctx.state.user)) return ctx.forbidden();
			const existing = await strapi.documents(UID).findOne({ documentId: ctx.params.id, fields: ['id'] });
			if (!existing) return ctx.notFound();
			const { data, error } = await validate(ctx.request.body?.data || {}, ctx.params.id);
			if (error) return ctx.badRequest(error);
			await strapi.documents(UID).update({ documentId: ctx.params.id, data });
			await recordAdminChange(strapi, { managed: [ctx.params.id] });
			ctx.body = { data: adminView(await loadOne(ctx.params.id)) };
		},

		async adminDelete(ctx) {
			if (!isAdmin(ctx.state.user)) return ctx.forbidden();
			const category = await loadOne(ctx.params.id);
			if (!category) return ctx.notFound();
			const { doctorsCount, appointmentsCount } = adminView(category);
			if (doctorsCount || appointmentsCount) {
				const uses = [
					doctorsCount && `${doctorsCount} praticien${doctorsCount > 1 ? 's' : ''}`,
					appointmentsCount && `${appointmentsCount} rendez-vous`,
				].filter(Boolean);
				return ctx.badRequest(`Ce métier est encore utilisé (${uses.join(', ')}) : il ne peut pas être supprimé.`);
			}
			await strapi.documents(UID).delete({ documentId: ctx.params.id });
			await recordAdminChange(strapi, { removed: [category.slug, category.name, category.professionName], deletedId: ctx.params.id });
			ctx.body = { ok: true };
		},
	};
});
