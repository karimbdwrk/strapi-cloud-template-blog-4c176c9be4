'use strict';

/**
 * appointment controller
 */

const { createCoreController } = require('@strapi/strapi').factories;

const UID = 'api::appointment.appointment';
const ADMIN_ROLE = 'SuperAdmin';

const isAdmin = (user) => user?.role?.name === ADMIN_ROLE;

// populate=* ou toute demande qui inclut la relation patient (patient, patient.user_record…)
const wantsPatient = (populate) =>
	populate === '*' || /(^|[^A-Za-z])patient([^A-Za-z]|$)/.test(JSON.stringify(populate ?? ''));

// Champs du patient transmis au praticien : identité, contact et dossier (jamais le mot de passe, le rôle…)
const PATIENT_POPULATE = {
	fields: ['id', 'documentId', 'firstname', 'lastname', 'email'],
	populate: {
		user_record: {
			fields: ['documentId', 'firstname', 'lastname', 'phone'],
			populate: {
				healthRecord: true,
				addressUser: true,
				healthInformations: true,
				languages: { fields: ['title', 'code'] },
			},
		},
	},
};

/** Ajoute le patient aux rendez-vous dont le demandeur est le praticien ou le patient. */
const attachPatients = async (strapi, appointments, user) => {
	const list = Array.isArray(appointments) ? appointments : [appointments];
	const ids = list.map((a) => a?.documentId).filter(Boolean);
	if (!ids.length) return;

	const rows = await strapi.documents(UID).findMany({
		filters: { documentId: { $in: ids } },
		fields: ['documentId'],
		populate: {
			doctor: { fields: ['id'], populate: { users_permissions_user: { fields: ['id'] } } },
			patient: PATIENT_POPULATE,
		},
		limit: ids.length,
	});
	const byId = new Map(rows.map((r) => [r.documentId, r]));

	for (const appointment of list) {
		const row = byId.get(appointment.documentId);
		const patient = row?.patient;
		if (!patient) continue;
		const isOwnDoctor = row.doctor?.users_permissions_user?.id === user.id;
		const isPatient = patient.id === user.id;
		if (isOwnDoctor || isPatient) appointment.patient = patient;
	}
};

module.exports = createCoreController(UID, ({ strapi }) => ({
	/**
	 * GET /appointments
	 *
	 * - Un filtre sur le patient (« mes rendez-vous ») est remplacé côté serveur
	 *   par le compte connecté : Strapi refuserait (400) un filtre sur la relation
	 *   vers le modèle User, et un utilisateur ne liste pas ceux d'un autre patient.
	 * - Quand le patient est demandé (populate), Strapi le retire de la réponse
	 *   (le rôle n'a pas accès au modèle User) : il est ajouté ici, avec son dossier,
	 *   uniquement pour le praticien du rendez-vous et pour le patient lui-même.
	 * Les autres lectures (agenda d'un praticien, créneaux pris) sont inchangées.
	 */
	async find(ctx) {
		const user = ctx.state.user;
		if (isAdmin(user)) return super.find(ctx);

		const filters = ctx.query?.filters;
		const forcePatient = Boolean(filters && typeof filters === 'object' && 'patient' in filters);
		if (forcePatient && !user) return ctx.unauthorized();
		const withPatient = Boolean(user) && wantsPatient(ctx.query?.populate);
		if (!forcePatient && !withPatient) return super.find(ctx);

		if (forcePatient) {
			const { patient, ...otherFilters } = filters;
			ctx.query = { ...ctx.query, filters: otherFilters };
		}
		await this.validateQuery(ctx);
		const sanitizedQuery = await this.sanitizeQuery(ctx);

		const { results, pagination } = await strapi.service(UID).find({
			...sanitizedQuery,
			...(forcePatient && {
				filters: { $and: [sanitizedQuery.filters || {}, { patient: { id: user.id } }] },
			}),
		});
		const sanitizedResults = await this.sanitizeOutput(results, ctx);
		if (withPatient) await attachPatients(strapi, sanitizedResults, user);
		return this.transformResponse(sanitizedResults, { pagination });
	},

	/**
	 * POST /appointments
	 * Le patient est toujours le compte connecté, rattaché par le serveur :
	 * le navigateur ne choisit pas le patient, et Strapi refuserait (400)
	 * une relation vers le modèle User que le rôle n'a pas le droit de lire.
	 * Le rattachement se fait dans la création même, car les notifications
	 * (praticien et patient) sont envoyées juste après à partir du patient.
	 */
	async create(ctx) {
		const user = ctx.state.user;
		if (!user) return ctx.unauthorized();
		if (isAdmin(user)) return super.create(ctx);

		const body = ctx.request.body || {};
		const data = { ...(body.data || {}) };
		const forConnectedPatient = 'patient' in data;
		delete data.patient;
		ctx.request.body = { ...body, data };

		await this.validateQuery(ctx);
		const sanitizedQuery = await this.sanitizeQuery(ctx);
		await this.validateInput(data, ctx);
		const sanitizedInput = await this.sanitizeInput(data, ctx);

		const entity = await strapi.service(UID).create({
			...sanitizedQuery,
			data: { ...sanitizedInput, ...(forConnectedPatient && { patient: user.id }) },
		});
		const sanitizedEntity = await this.sanitizeOutput(entity, ctx);
		ctx.status = 201;
		return this.transformResponse(sanitizedEntity);
	},

	/**
	 * GET /appointments/to-rate-count
	 * Nombre de rendez-vous terminés que le patient connecté n'a pas encore évalués.
	 * Le filtre sur le patient est fait côté serveur : aucun droit de lecture
	 * sur les comptes utilisateurs n'est nécessaire.
	 */
	async toRateCount(ctx) {
		const user = ctx.state.user;
		if (!user) return ctx.unauthorized();

		const count = await strapi.documents(UID).count({
			filters: {
				patient: { id: user.id },
				isOver: true,
				isCancelled: { $ne: true },
				rating: { id: { $null: true } },
			},
		});
		return { data: { count } };
	},
}));
