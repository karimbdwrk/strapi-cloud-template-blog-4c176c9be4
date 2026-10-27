'use strict';

/**
 * Correction des adresses de cabinet saisies à la main (orthographe de la ville, code postal).
 *
 * Après le démarrage, en tâche de fond, chaque adresse française jamais vérifiée (`geocodedAt` vide)
 * est recherchée sur la Géoplateforme de l'IGN (le service utilisé par le site pour les suggestions).
 * - Correspondance sûre (même code postal que celui saisi, ou score très élevé dans le même
 *   département) : ville, code postal, code commune
 *   et coordonnées remplacés ; les horaires qui reprenaient cette adresse sont mis à jour aussi.
 * - Sinon l'adresse est laissée telle quelle.
 * Dans les deux cas `geocodedAt` est renseigné : chaque adresse n'est examinée qu'une fois
 * (le site le remet à vide quand le praticien modifie son adresse à la main).
 */

const DOCTOR = 'api::doctor.doctor';
const GEOCODING_URL = 'https://data.geopf.fr/geocodage/search';
const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
// Score minimal (0 à 1) pour corriger une adresse. Les abréviations (« bd », « St ») et les fautes
// font baisser le score : un code postal identique à celui saisi suffit alors à confirmer.
const MIN_SCORE_SAME_POSTCODE = 0.5;
const MIN_SCORE = 0.85;
// Le service accepte 50 requêtes par seconde : on reste très en dessous
const DELAY_MS = 150;

const ARRONDISSEMENT = /^(Paris|Lyon|Marseille) \d+(er|e) Arrondissement$/i;
const isFrance = (country) => !country?.trim() || /^(france|fr)$/i.test(country.trim());
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const department = (postcode) => (postcode || '').trim().slice(0, postcode?.startsWith('97') ? 3 : 2);

const geocode = async (address) => {
	const street = address.line?.trim();
	const q = [street, address.postcode, address.city].filter((part) => part?.trim()).join(' ').slice(0, 200);
	if (q.replace(/[^a-z0-9]/gi, '').length < 3) return null;
	const url = new URL(GEOCODING_URL);
	url.searchParams.set('q', q);
	url.searchParams.set('limit', '1');
	url.searchParams.set('index', 'address');
	// Sans rue : seule la commune peut être vérifiée
	if (!street) url.searchParams.set('type', 'municipality');
	const response = await fetch(url);
	if (!response.ok) throw new Error(`Géoplateforme : ${response.status}`);
	const feature = (await response.json()).features?.[0];
	const p = feature?.properties;
	if (!p) return null;
	const samePostcode = Boolean(address.postcode?.trim()) && p.postcode === address.postcode.trim();
	if (p.score < (samePostcode ? MIN_SCORE_SAME_POSTCODE : MIN_SCORE)) return null;
	// Garde-fou : même département que le code postal saisi
	if (address.postcode?.trim() && department(p.postcode) !== department(address.postcode)) return null;
	if (street && !['housenumber', 'street'].includes(p.type)) return null;
	const [longitude, latitude] = feature.geometry?.coordinates || [];
	return {
		postcode: p.postcode,
		city: (p.city || p.name || '').replace(ARRONDISSEMENT, '$1'),
		citycode: p.citycode || null,
		latitude: street && Number.isFinite(latitude) ? latitude : null,
		longitude: street && Number.isFinite(longitude) ? longitude : null,
	};
};

const withoutId = ({ id, ...rest }) => rest;

const geocodeDoctorAddresses = async (strapi) => {
	const doctors = await strapi.documents(DOCTOR).findMany({
		fields: ['id'],
		populate: { AddressDoctor: true, ...Object.fromEntries(DAYS.map((day) => [day, true])) },
		limit: -1,
	});
	let fixed = 0;
	let checked = 0;

	for (const doctor of doctors) {
		const addresses = doctor.AddressDoctor || [];
		if (!addresses.some((a) => !a.geocodedAt && isFrance(a.country))) continue;

		const now = new Date();
		const days = Object.fromEntries(DAYS.filter((day) => doctor[day]).map((day) => [day, withoutId(doctor[day])]));
		let daysChanged = false;
		const next = [];
		for (const address of addresses) {
			if (address.geocodedAt || !isFrance(address.country)) {
				next.push(withoutId(address));
				continue;
			}
			checked++;
			let found = null;
			try {
				found = await geocode(address);
			} catch (error) {
				// Service indisponible : on réessaiera au prochain démarrage
				strapi.log.warn(`Adresses : vérification interrompue (${error.message})`);
				return;
			}
			await sleep(DELAY_MS);
			if (!found) {
				next.push({ ...withoutId(address), geocodedAt: now });
				continue;
			}
			if (found.city !== address.city || found.postcode !== address.postcode) fixed++;
			// Horaires qui reprenaient cette adresse (copie dans chaque jour)
			for (const day of Object.keys(days)) {
				const d = days[day];
				if (d.address === address.line && d.postcode === address.postcode && d.city === address.city) {
					days[day] = { ...d, postcode: found.postcode, city: found.city };
					daysChanged = true;
				}
			}
			next.push({ ...withoutId(address), ...found, country: address.country || 'France', geocodedAt: now });
		}

		await strapi.documents(DOCTOR).update({
			documentId: doctor.documentId,
			data: { AddressDoctor: next, ...(daysChanged ? days : {}) },
			// Correction technique : aucune notification (profil en attente, etc.)
			silent: true,
		});
	}
	if (checked) strapi.log.info(`Adresses : ${checked} vérifiée(s), ${fixed} corrigée(s) (ville ou code postal)`);
};

/** Lancée sans attendre : le démarrage de Strapi n'est pas retardé par les appels au service */
const scheduleAddressGeocoding = (strapi) => {
	setTimeout(() => {
		geocodeDoctorAddresses(strapi).catch((error) => strapi.log.error(`Adresses : ${error.message}`));
	}, 5000);
};

module.exports = { scheduleAddressGeocoding, geocodeDoctorAddresses };
