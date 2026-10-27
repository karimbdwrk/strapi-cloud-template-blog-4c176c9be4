'use strict';

/**
 * Note globale des praticiens (champs doctor.ratingAverage et doctor.ratingCount).
 *
 * Comme sur Uber, chaque praticien part d'une première note fictive de 5/5 :
 * note globale = (5 + somme des notes des avis) / (nombre d'avis + 1).
 * Un nouveau praticien affiche donc 5/5, puis la moyenne évolue avec les avis.
 * Les avis individuels ne sont jamais transmis au praticien : il ne voit que cette moyenne.
 */

const RATING_UID = 'api::rating.rating';
const DOCTOR_UID = 'api::doctor.doctor';
const SEED_SCORE = 5;

/** Recalcule la note globale d'un praticien (id numérique) */
const refreshDoctorRating = async (strapi, doctorId) => {
	if (!doctorId) return;
	const rows = await strapi.db.query(RATING_UID).findMany({
		where: { doctor: { id: doctorId } },
		select: ['finalScore'],
	});
	const scores = rows.map((r) => Number(r.finalScore)).filter((n) => Number.isFinite(n) && n > 0);
	const total = scores.reduce((sum, n) => sum + n, SEED_SCORE);
	// db.query : n'appelle pas les middlewares du document service (notifications du praticien)
	await strapi.db.query(DOCTOR_UID).update({
		where: { id: doctorId },
		data: { ratingAverage: Math.round((total / (scores.length + 1)) * 100) / 100, ratingCount: scores.length },
	});
};

const doctorOf = async (strapi, documentId) => {
	if (!documentId) return null;
	const rating = await strapi.db.query(RATING_UID).findOne({
		where: { documentId },
		select: ['id'],
		populate: { doctor: { select: ['id'] } },
	});
	return rating?.doctor?.id ?? null;
};

/** Recalcul après chaque création, modification ou suppression d'avis (site ou admin Strapi) */
const registerRatingScore = (strapi) => {
	strapi.documents.use(async (context, next) => {
		if (context.uid !== RATING_UID || !['create', 'update', 'delete'].includes(context.action)) return next();

		// Praticien avant l'action : l'avis supprimé ou déplacé n'est plus lisible ensuite
		const before = context.action === 'create' ? null : await doctorOf(strapi, context.params?.documentId);
		const result = await next();
		const after = context.action === 'delete' ? null : await doctorOf(strapi, result?.documentId);

		for (const doctorId of new Set([before, after].filter(Boolean))) {
			try {
				await refreshDoctorRating(strapi, doctorId);
			} catch (error) {
				strapi.log.error(`[rating-score] Praticien ${doctorId} : ${error.message}`);
			}
		}
		return result;
	});
};

/** Au démarrage : calcule la note des praticiens qui n'en ont pas encore */
const ensureDoctorRatings = async (strapi) => {
	const doctors = await strapi.db.query(DOCTOR_UID).findMany({ where: { ratingAverage: { $null: true } }, select: ['id'] });
	for (const { id } of doctors) await refreshDoctorRating(strapi, id);
};

module.exports = { SEED_SCORE, refreshDoctorRating, registerRatingScore, ensureDoctorRatings };
