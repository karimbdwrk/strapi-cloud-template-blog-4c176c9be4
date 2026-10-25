'use strict';

/**
 * Charte éthique (single type « Charte éthique »).
 *
 * - Au premier démarrage, la charte est créée avec le texte d'origine (v1.0),
 *   ensuite elle se modifie uniquement dans le panneau d'administration.
 * - Lecture publique : le site l'affiche aux praticiens avant signature.
 * - La version en vigueur est celle enregistrée sur chaque signature
 *   (contrôleur doctor). Changer la version = nouvelle signature demandée.
 */

const UID = 'api::charter.charter';
const PUBLIC_ACTION = 'api::charter.charter.find';
const FALLBACK_VERSION = '1.0';

const INITIAL_CHARTER = {
	"version": "1.0",
	"dateLabel": "octobre 2026",
	"intro": "Meyana met en relation des personnes qui cherchent à prendre soin d’elles avec des praticiens de la santé et du bien-être. Cette confiance repose sur des engagements communs. En signant cette charte, vous vous engagez à les respecter dans chacune de vos consultations, en cabinet comme en visio.",
	"articles": [
		{
			"title": "Respect de la personne",
			"text": "J’accueille chaque patient avec respect, bienveillance et sans jugement. Je respecte sa dignité, son intimité, ses convictions et son droit de décider pour lui-même."
		},
		{
			"title": "Honnêteté sur mes compétences",
			"text": "Les diplômes, titres et expériences que j’indique sur Meyana sont exacts et vérifiables. Je n’utilise aucun titre que je ne possède pas et je n’interviens que dans le champ de compétences de ma formation."
		},
		{
			"title": "Complémentarité avec la médecine",
			"text": "Je ne pose pas de diagnostic médical si ma profession ne m’y autorise pas. Je ne demande jamais à un patient d’arrêter, de réduire ou de modifier un traitement prescrit. Dès qu’une situation le nécessite, j’oriente vers un médecin ou vers les urgences."
		},
		{
			"title": "Aucune promesse de guérison",
			"text": "Je ne promets aucun résultat, aucune guérison, et je ne présente pas ma pratique comme une alternative à un traitement médical. Je décris ma pratique de façon claire et mesurée, sur mon profil comme dans mes articles."
		},
		{
			"title": "Information et consentement",
			"text": "J’explique le déroulé, la durée et le tarif de la consultation avant de la commencer. Je recueille le consentement du patient avant tout acte et je respecte son droit de l’interrompre à tout moment."
		},
		{
			"title": "Confidentialité",
			"text": "Les informations confiées par le patient, y compris son carnet de santé et ses documents, restent strictement confidentielles. Je ne les utilise que pour sa prise en charge et ne les partage avec personne sans son accord."
		},
		{
			"title": "Transparence des tarifs",
			"text": "Mes tarifs sont indiqués sur mon profil et je les respecte. Je ne propose ni vente forcée, ni engagement sur un nombre de séances, ni produit dont le patient n’a pas besoin."
		},
		{
			"title": "Non-discrimination",
			"text": "Je reçois chaque patient sans distinction d’origine, de genre, d’orientation sexuelle, d’âge, de handicap, de religion ou de situation sociale."
		},
		{
			"title": "Cadre professionnel",
			"text": "Je maintiens une relation strictement professionnelle avec mes patients. Je n’exerce aucune emprise, aucune pression psychologique ou financière, et je refuse toute pratique pouvant conduire à une dérive sectaire."
		},
		{
			"title": "Suivi par Meyana",
			"text": "J’accepte que Meyana vérifie mon profil, recueille l’avis des patients et examine les signalements. En cas de manquement à cette charte, Meyana peut suspendre ou retirer mon profil de la plateforme."
		}
	]
};

/** Version de la charte en vigueur, enregistrée avec chaque signature */
const currentCharterVersion = async (strapi) => {
	const charter = await strapi.documents(UID).findFirst({ fields: ['version'] });
	return charter?.version || FALLBACK_VERSION;
};

const ensureCharter = async (strapi) => {
	const existing = await strapi.documents(UID).findFirst({ fields: ['id'] });
	if (!existing) await strapi.documents(UID).create({ data: INITIAL_CHARTER });

	const publicRole = await strapi.query('plugin::users-permissions.role').findOne({ where: { type: 'public' } });
	if (!publicRole) return;
	const granted = await strapi
		.query('plugin::users-permissions.permission')
		.findOne({ where: { action: PUBLIC_ACTION, role: publicRole.id } });
	if (!granted) {
		await strapi.query('plugin::users-permissions.permission').create({ data: { action: PUBLIC_ACTION, role: publicRole.id } });
	}
};

module.exports = { ensureCharter, currentCharterVersion };
