'use strict';

/**
 * reporting controller
 *
 * create : le site n'envoie que le rendez-vous, le motif et les précisions.
 * Le patient, le praticien et l'auteur du signalement (from) sont déduits du rendez-vous,
 * et seul un participant du rendez-vous (patient ou praticien) peut le signaler.
 * Les relations sont posées côté serveur : le rôle connecté n'a pas à lire les comptes
 * utilisateurs (sinon Strapi refuse la relation « patient » avec une erreur 400).
 *
 * Suivi du traitement : seul le rôle SuperAdmin modifie un signalement (statut, note interne,
 * réponse à l'auteur) ; chaque changement de statut est daté dans `history`.
 * find / findOne : l'admin voit tout, les autres comptes seulement leurs propres signalements,
 * sans la note interne ni le nom de l'admin.
 */

const { createCoreController } = require('@strapi/strapi').factories;

const UID = 'api::reporting.reporting';
const APPOINTMENT_UID = 'api::appointment.appointment';
const ADMIN_ROLE = 'SuperAdmin';

// Mêmes valeurs que le site (src/app/components/reportReasons.js)
const REASONS = ['no-show', 'late', 'behavior', 'practice', 'billing', 'technical', 'other'];
const NOTE_MAX = 1000;
const STATUSES = ['open', 'in_progress', 'resolved', 'dismissed'];
const CLOSED = ['resolved', 'dismissed'];
const ADMIN_NOTE_MAX = 4000;

const isAdmin = (ctx) => ctx.state.user?.role?.name === ADMIN_ROLE;
const cleanText = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

// Signalements écrits par ce compte (l'auteur est déduit de `from`)
const ownedBy = (userId) => ({
	$or: [
		{ from: 'patient', patient: { id: userId } },
		{ from: 'doctor', doctor: { users_permissions_user: { id: userId } } },
	],
});

// Ce que l'auteur voit de son signalement
const PUBLIC_FIELDS = ['documentId', 'reason', 'from', 'reportStatus', 'resolution', 'history', 'closedAt', 'createdAt'];
const publicView = (report) => {
	const status = report.reportStatus || 'open';
	return {
		documentId: report.documentId,
		reason: report.reason,
		from: report.from,
		reportStatus: status,
		// La réponse de l'équipe n'est transmise qu'une fois le signalement clos
		resolution: CLOSED.includes(status) ? report.resolution || null : null,
		history: (Array.isArray(report.history) ? report.history : []).map(({ status: s, at }) => ({ status: s, at })),
		closedAt: report.closedAt,
		createdAt: report.createdAt,
		appointment: report.appointment ? { documentId: report.appointment.documentId } : null,
	};
};

module.exports = createCoreController(UID, ({ strapi }) => ({
	async create(ctx) {
		const user = ctx.state.user;
		if (!user) return ctx.unauthorized();
		if (user.role?.name === ADMIN_ROLE) return super.create(ctx);

		const data = ctx.request.body?.data || {};
		const ref = data.appointment?.connect?.[0]?.documentId ?? data.appointment?.documentId ?? data.appointment;
		if (!ref || typeof ref !== 'string') return ctx.badRequest('Rendez-vous manquant.');
		if (!REASONS.includes(data.reason)) return ctx.badRequest('Motif de signalement invalide.');
		const note = typeof data.note === 'string' ? data.note.trim().slice(0, NOTE_MAX) : '';
		if (data.reason === 'other' && note.length < 15) return ctx.badRequest('Précisez ce qui s’est passé.');

		const appointment = await strapi.db.query(APPOINTMENT_UID).findOne({
			where: { documentId: ref },
			select: ['id', 'documentId'],
			populate: {
				patient: { select: ['id'] },
				doctor: { select: ['id'], populate: { users_permissions_user: { select: ['id'] } } },
			},
		});
		if (!appointment) return ctx.notFound('Rendez-vous introuvable.');

		const isPatient = appointment.patient?.id === user.id;
		const isDoctor = appointment.doctor?.users_permissions_user?.id === user.id;
		if (!isPatient && !isDoctor) return ctx.forbidden('Vous ne pouvez signaler que vos propres rendez-vous.');
		// Un praticien qui réserve dans son agenda est aussi le « patient » du rendez-vous : il signale en praticien
		const from = isDoctor ? 'doctor' : 'patient';
		if (data.reason === 'practice' && from === 'doctor') return ctx.badRequest('Motif de signalement invalide.');

		const report = await strapi.documents(UID).create({
			data: {
				appointment: appointment.id,
				patient: appointment.patient?.id ?? null,
				doctor: appointment.doctor?.id ?? null,
				from,
				reason: data.reason,
				note,
				reportStatus: 'open',
				history: [{ status: 'open', at: new Date().toISOString() }],
			},
		});
		ctx.status = 201;
		return { data: { documentId: report.documentId } };
	},

	async find(ctx) {
		if (isAdmin(ctx)) return super.find(ctx);
		const user = ctx.state.user;
		if (!user) return ctx.unauthorized();

		// ?appointment=<documentId> : signalements d'un rendez-vous
		const appointment = typeof ctx.query?.appointment === 'string' ? ctx.query.appointment : null;
		const reports = await strapi.db.query(UID).findMany({
			where: { $and: [ownedBy(user.id), ...(appointment ? [{ appointment: { documentId: appointment } }] : [])] },
			select: PUBLIC_FIELDS,
			populate: { appointment: { select: ['documentId'] } },
			orderBy: { createdAt: 'desc' },
			limit: 100,
		});
		return { data: reports.map(publicView) };
	},

	async findOne(ctx) {
		if (isAdmin(ctx)) return super.findOne(ctx);
		const user = ctx.state.user;
		if (!user) return ctx.unauthorized();

		const report = await strapi.db.query(UID).findOne({
			where: { $and: [{ documentId: ctx.params.id }, ownedBy(user.id)] },
			select: PUBLIC_FIELDS,
			populate: { appointment: { select: ['documentId'] } },
		});
		if (!report) return ctx.notFound('Signalement introuvable.');
		return { data: publicView(report) };
	},

	async update(ctx) {
		if (!isAdmin(ctx)) return ctx.forbidden('Seule l’équipe Meyana peut modifier un signalement.');

		const current = await strapi.documents(UID).findOne({
			documentId: ctx.params.id,
			fields: ['reportStatus', 'history', 'closedAt'],
		});
		if (!current) return ctx.notFound('Signalement introuvable.');

		const input = ctx.request.body?.data || {};
		const data = {};
		if ('adminNote' in input) data.adminNote = cleanText(input.adminNote, ADMIN_NOTE_MAX);
		if ('resolution' in input) data.resolution = cleanText(input.resolution, NOTE_MAX);

		const previous = current.reportStatus || 'open';
		const next = input.reportStatus;
		if (next !== undefined && next !== previous) {
			if (!STATUSES.includes(next)) return ctx.badRequest('Statut de signalement invalide.');
			const admin = ctx.state.user;
			const by = [admin.firstname, admin.lastname].filter(Boolean).join(' ') || admin.email;
			data.reportStatus = next;
			data.closedAt = CLOSED.includes(next) ? new Date() : null;
			data.history = [
				// Signalements antérieurs au suivi : l'ouverture n'était pas tracée
				...(Array.isArray(current.history) ? current.history : []),
				{ status: next, at: new Date().toISOString(), by },
			];
		}

		const updated = Object.keys(data).length ? await strapi.documents(UID).update({ documentId: ctx.params.id, data }) : current;
		return {
			data: {
				documentId: ctx.params.id,
				reportStatus: updated.reportStatus || 'open',
				adminNote: updated.adminNote,
				resolution: updated.resolution,
				history: updated.history,
				closedAt: updated.closedAt,
			},
		};
	},

	async delete(ctx) {
		if (!isAdmin(ctx)) return ctx.forbidden('Seule l’équipe Meyana peut supprimer un signalement.');
		return super.delete(ctx);
	},
}));
