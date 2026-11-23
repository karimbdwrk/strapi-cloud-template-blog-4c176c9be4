'use strict';

/**
 * Recherche libre des praticiens (« mal de dents », « ostéopathe lyon », « Dupont »).
 *
 * Renvoie les documentId des praticiens qui correspondent ; le site ajoute ensuite ses autres
 * filtres (ville, genre, en ligne…) à la requête /doctors habituelle.
 *
 * Plusieurs petites requêtes plutôt qu'une seule : un filtre REST qui traverse
 * praticien → métiers → mots-clés pour chaque mot saisi produit des jointures énormes
 * (plusieurs dizaines de secondes, puis 504).
 *
 * 1. Expression entière : si elle se retrouve dans un mot-clé (nom ou synonyme), ce mot-clé
 *    décide seul : praticiens qui l'ont choisi + praticiens des métiers auxquels il est rattaché.
 *    « mal de dents » → les métiers dentaires, pas tout praticien dont un mot-clé contient « mal ».
 * 2. Sinon, mot par mot (mots vides ignorés) : chaque mot doit se retrouver dans le nom, la
 *    description, la ville, le code postal, un métier ou un mot-clé du praticien.
 */

const { normalize } = require('./keywords');

const DOCTOR = 'api::doctor.doctor';
const KEYWORD = 'api::keyword.keyword';
const CATEGORY = 'api::category.category';

const STOP_WORDS = new Set([
	'a', 'au', 'aux', 'avec', 'chez', 'd', 'dans', 'de', 'des', 'du', 'en', 'et', 'j', 'je', 'l', 'la', 'le', 'les',
	'ma', 'me', 'mes', 'mon', 'ou', 'par', 'pour', 'sur', 'un', 'une',
]);
const MAX_WORDS = 6;
const MAX_LENGTH = 100;

const ids = (rows) => rows.map((r) => r.id);

/** Mots-clés validés dont le nom ou un synonyme contient le texte, avec leurs métiers */
const keywordsMatching = (strapi, text) =>
	strapi.documents(KEYWORD).findMany({
		filters: { status: 'approved', searchText: { $containsi: text } },
		fields: ['id'],
		populate: { categories: { fields: ['id'] } },
		limit: -1,
	});

const categoryIdsOf = (keywords) => keywords.flatMap((k) => ids(k.categories || []));

/** documentId des praticiens qui ont l'un de ces mots-clés, l'un de ces métiers ou l'une des conditions en plus */
const doctorsMatching = async (strapi, { keywordIds = [], categoryIds = [], extra = [] }) => {
	const conditions = [
		...extra,
		keywordIds.length && { keywords: { id: { $in: keywordIds } } },
		categoryIds.length && { categories: { id: { $in: [...new Set(categoryIds)] } } },
	].filter(Boolean);
	if (!conditions.length) return new Set();
	const rows = await strapi.documents(DOCTOR).findMany({ filters: { $or: conditions }, fields: ['documentId'], limit: -1 });
	return new Set(rows.map((r) => r.documentId));
};

const searchDoctorIds = async (strapi, query) => {
	const phrase = normalize(String(query || '').slice(0, MAX_LENGTH));
	if (!phrase) return null;

	// 1. Expression entière reconnue comme mot-clé
	if (phrase.includes(' ')) {
		const keywords = await keywordsMatching(strapi, phrase);
		if (keywords.length) {
			return [...(await doctorsMatching(strapi, { keywordIds: ids(keywords), categoryIds: categoryIdsOf(keywords) }))];
		}
	}

	// 2. Mot par mot
	const words = [...new Set(phrase.split(' ').filter((w) => w && !STOP_WORDS.has(w)))].slice(0, MAX_WORDS);
	if (!words.length) return null;

	let result = null;
	for (const word of words) {
		const [keywords, categories] = await Promise.all([
			keywordsMatching(strapi, word),
			strapi.documents(CATEGORY).findMany({
				filters: {
					$or: [
						{ name: { $containsi: word } },
						{ professionName: { $containsi: word } },
						{ professionNameFeminine: { $containsi: word } },
						{ slug: { $containsi: word } },
					],
				},
				fields: ['id'],
				limit: -1,
			}),
		]);
		const found = await doctorsMatching(strapi, {
			keywordIds: ids(keywords),
			categoryIds: [...ids(categories), ...categoryIdsOf(keywords)],
			extra: [
				{ firstname: { $containsi: word } },
				{ lastname: { $containsi: word } },
				{ description: { $containsi: word } },
				{ AddressDoctor: { city: { $containsi: word } } },
				{ AddressDoctor: { postcode: { $containsi: word } } },
			],
		});
		result = result ? new Set([...result].filter((id) => found.has(id))) : found;
		if (!result.size) break;
	}
	return [...result];
};

module.exports = { searchDoctorIds };
