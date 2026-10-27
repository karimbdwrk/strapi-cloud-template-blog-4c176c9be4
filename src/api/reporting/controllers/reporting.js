'use strict';

/**
 * reporting controller
 *
 * create : le site n'envoie que le rendez-vous, le motif et les précisions.
 * Le patient, le praticien et l'auteur du signalement (from) sont déduits du rendez-vous,
 * et seul un participant du rendez-vous (patient ou praticien) peut le signaler.
 * Les relations sont posées côté serveur : le rôle connecté n'a pas à lire les comptes
 * utilisateurs (sinon Strapi refuse la relation « patient » avec une erreur 400).
 */

const { createCoreController } = require('@strapi/strapi').factories;

const UID = 'api::reporting.reporting';
const APPOINTMENT_UID = 'api::appointment.appointment';
const ADMIN_ROLE = 'SuperAdmin';

// Mêmes valeurs que le site (src/app/components/reportReasons.js)
const REASONS = ['no-show', 'late', 'behavior', 'practice', 'billing', 'technical', 'other'];
const NOTE_MAX = 1000;

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
			},
		});
		ctx.status = 201;
		return { data: { documentId: report.documentId } };
	},
}));
