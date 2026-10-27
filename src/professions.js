'use strict';

/**
 * Métiers référencés (catégories) et leurs familles (« Famille de métiers »).
 *
 * Au démarrage, les familles et métiers du catalogue absents de la base sont créés,
 * puis chaque métier est rattaché à ses familles. Rien n'est supprimé ni renommé :
 * une catégorie déjà présente (même slug, même nom, ou nommée d'après le métier) garde ses libellés,
 * modifiables ensuite dans le panneau d'administration.
 */

const { parseCatalog } = require('./professions-catalog');
const { ensurePermission } = require('./permissions');

const CATEGORY = 'api::category.category';
const FAMILY = 'api::profession-family.profession-family';

const slugify = (text) =>
	text
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');

const key = (text) => (text || '').trim().toLowerCase();

const ensureProfessions = async (strapi) => {
	const catalog = parseCatalog();

	// Familles : retrouvées par slug, créées sinon
	const existingFamilies = await strapi.documents(FAMILY).findMany({ fields: ['slug'], limit: -1 });
	const familyBySlug = new Map(existingFamilies.map((f) => [f.slug, f.documentId]));
	for (const family of catalog) {
		const slug = slugify(family.name);
		if (familyBySlug.has(slug)) continue;
		const created = await strapi.documents(FAMILY).create({
			data: { name: family.name, slug, domain: family.domain, order: family.order },
		});
		familyBySlug.set(slug, created.documentId);
	}

	// Métiers : un même métier peut figurer dans plusieurs familles
	const professions = new Map();
	for (const family of catalog) {
		for (const profession of family.professions) {
			const entry = professions.get(profession.professionName) || { ...profession, families: new Set() };
			entry.families.add(familyBySlug.get(slugify(family.name)));
			professions.set(profession.professionName, entry);
		}
	}

	const categories = await strapi.documents(CATEGORY).findMany({
		fields: ['name', 'slug', 'professionName', 'professionNameFeminine'],
		populate: { families: { fields: ['documentId'] } },
		limit: -1,
	});
	const find = (profession) =>
		categories.find(
			(c) =>
				c.slug === slugify(profession.name) ||
				key(c.name) === key(profession.name) ||
				// Anciennes catégories nommées d'après le métier (« Cardiologue »)
				key(c.name) === key(profession.professionName) ||
				key(c.professionName) === key(profession.professionName)
		);

	let created = 0;
	let linked = 0;
	for (const profession of professions.values()) {
		const families = [...profession.families];
		const category = find(profession);
		if (!category) {
			await strapi.documents(CATEGORY).create({
				data: {
					name: profession.name,
					slug: slugify(profession.name),
					professionName: profession.professionName,
					professionNameFeminine: profession.professionNameFeminine,
					families,
				},
			});
			created++;
			continue;
		}
		const missing = families.filter((id) => !category.families?.some((f) => f.documentId === id));
		if (!missing.length) continue;
		await strapi.documents(CATEGORY).update({
			documentId: category.documentId,
			data: {
				families: { connect: missing },
				// Libellés laissés vides à la main : complétés depuis le catalogue
				...(!category.professionName && { professionName: profession.professionName }),
				...(!category.professionNameFeminine && { professionNameFeminine: profession.professionNameFeminine }),
			},
		});
		linked++;
	}
	if (created || linked) strapi.log.info(`Métiers : ${created} créé(s), ${linked} rattaché(s) à leurs familles`);

	// Familles lisibles par tous (filtres de recherche, inscription des praticiens)
	for (const role of [{ type: 'public' }, { type: 'authenticated' }]) {
		for (const action of ['find', 'findOne']) await ensurePermission(strapi, role, `${FAMILY}.${action}`);
	}
};

module.exports = { ensureProfessions };
