'use strict';

/**
 * Mots-clés de recherche des praticiens.
 *
 * - Liste Meyana (`global`) : proposée à tous les praticiens, importée depuis keywords-catalog.js.
 * - Proposition d'un praticien : créée « pending », hors liste Meyana. Elle n'est reliée
 *   au praticien qu'une fois validée : un mot-clé en attente ou refusé n'apparaît
 *   jamais sur une fiche ni dans la recherche. La modération peut aussi l'ajouter à la liste Meyana.
 * - `searchText` : nom et synonymes sans accents ni majuscules, sur lequel porte la recherche.
 * - Mot-clé sensible : réservé aux métiers du domaine médical et aux métiers auxquels il est rattaché.
 */

const { parseKeywords } = require('./keywords-catalog');
const { parseCatalog } = require('./professions-catalog');
const { ensurePermission } = require('./permissions');

const KEYWORD = 'api::keyword.keyword';
const DOCTOR = 'api::doctor.doctor';
const CATEGORY = 'api::category.category';
const FAMILY = 'api::profession-family.profession-family';
const KEYWORD_LIMIT = 15;

const normalize = (text) =>
	(text || '')
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9+]+/g, ' ')
		.trim();

const searchTextOf = (name, synonyms) =>
	[name, ...(synonyms || '').split(',')]
		.map(normalize)
		.filter(Boolean)
		.join(' | ');

/** Praticien d'un métier du domaine médical (familles « medical ») */
const isMedical = (doctor) =>
	(doctor?.categories || []).some((c) => (c.families || []).some((f) => f.domain === 'medical'));

/** Un mot-clé sensible n'est utilisable que par un métier médical ou un métier auquel il est rattaché */
const canUseKeyword = (doctor, keyword) =>
	!keyword.sensitive ||
	isMedical(doctor) ||
	(keyword.categories || []).some((kc) => (doctor?.categories || []).some((dc) => dc.id === kc.id));

const registerKeywords = (strapi) => {
	strapi.documents.use(async (context, next) => {
		if (context.uid !== KEYWORD || !['create', 'update'].includes(context.action) || !context.params?.data) {
			return next();
		}
		const { action, params } = context;
		const data = params.data;
		const previous =
			action === 'update'
				? await strapi.documents(KEYWORD).findOne({
						documentId: params.documentId,
						fields: ['name', 'synonyms', 'status'],
						populate: { proposedBy: { fields: ['documentId'] } },
				  })
				: null;

		if (action === 'create' || 'name' in data || 'synonyms' in data) {
			data.searchText = searchTextOf(data.name ?? previous?.name, data.synonyms ?? previous?.synonyms);
		}
		const statusChanged = action === 'update' && data.status && data.status !== previous?.status;
		if (statusChanged && data.status !== 'pending') data.moderatedAt = new Date();

		const result = await next();
		if (!statusChanged || !result?.documentId) return result;

		// Validé : relié au praticien qui l'a proposé. Refusé : retiré de toutes les fiches et des métiers.
		if (data.status === 'approved' && previous.proposedBy?.documentId) {
			await strapi.documents(DOCTOR).update({
				documentId: previous.proposedBy.documentId,
				data: { keywords: { connect: [result.documentId] } },
			});
		}
		if (data.status === 'rejected') {
			await strapi.documents(KEYWORD).update({
				documentId: result.documentId,
				data: { doctors: { set: [] }, categories: { set: [] } },
			});
		}
		return result;
	});
};

/** Liste Meyana : mots-clés du catalogue absents de la base créés au démarrage (jamais modifiés ensuite) */
const ensureKeywords = async (strapi) => {
	const existing = await strapi.documents(KEYWORD).findMany({ fields: ['name'], limit: -1 });
	const known = new Set(existing.map((k) => normalize(k.name)));
	const missing = parseKeywords().filter((k) => !known.has(normalize(k.name)));

	if (missing.length) {
		// Métier retrouvé par slug, ou par son nom (catégories créées avant le catalogue des métiers)
		const categories = await strapi.documents(CATEGORY).findMany({ fields: ['slug', 'name', 'professionName'], limit: -1 });
		const bySlug = new Map();
		for (const c of categories) {
			for (const label of [c.professionName, c.name, c.slug]) if (label) bySlug.set(normalize(label), c.documentId);
		}
		const catalogNames = new Map(
			parseCatalog().flatMap((f) => f.professions.map((p) => [normalize(p.name), [p.name, p.professionName]]))
		);
		const categoryOf = (slug) => {
			const key = normalize(slug);
			return bySlug.get(key) || (catalogNames.get(key) || []).map((label) => bySlug.get(normalize(label))).find(Boolean);
		};
		const families = await strapi.documents(FAMILY).findMany({
			fields: ['slug'],
			populate: { categories: { fields: ['documentId'] } },
			limit: -1,
		});
		const byFamily = new Map(families.map((f) => [f.slug, f.categories.map((c) => c.documentId)]));
		const resolve = (target) => (target.startsWith('*') ? byFamily.get(target.slice(1)) || [] : [categoryOf(target)]);

		for (const keyword of missing) {
			await strapi.documents(KEYWORD).create({
				data: {
					name: keyword.name,
					synonyms: keyword.synonyms,
					type: keyword.type,
					sensitive: keyword.sensitive,
					status: 'approved',
					global: true,
					categories: [...new Set(keyword.targets.flatMap(resolve).filter(Boolean))],
				},
			});
		}
		strapi.log.info(`Mots-clés : ${missing.length} ajouté(s) à la liste Meyana`);
	}

	// Liste Meyana lisible par tous (le contrôleur filtre) ; mots-clés du praticien connecté ; modération par l'admin
	for (const role of [{ type: 'public' }, { type: 'authenticated' }]) {
		for (const action of ['find', 'findOne']) await ensurePermission(strapi, role, `${KEYWORD}.${action}`);
	}
	for (const action of ['mine', 'setMine', 'withdraw']) {
		await ensurePermission(strapi, { type: 'authenticated' }, `${KEYWORD}.${action}`);
	}
	for (const action of ['find', 'findOne', 'create', 'update', 'delete', 'mine', 'setMine', 'withdraw', 'moderation', 'moderate']) {
		await ensurePermission(strapi, { name: 'SuperAdmin' }, `${KEYWORD}.${action}`);
	}
};

module.exports = { KEYWORD_LIMIT, normalize, isMedical, canUseKeyword, registerKeywords, ensureKeywords };
