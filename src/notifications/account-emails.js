'use strict';

/**
 * Emails de compte :
 * - praticien : profil envoyé pour validation, profil refusé (avec motif), profil validé ;
 * - patient : bienvenue.
 */

const { renderEmail } = require('./email');
const { TIME_ZONE } = require('./helpers');

const hello = (person) => (person?.firstname ? `Bonjour ${person.firstname},` : 'Bonjour,');

const dateLong = (value) =>
	new Date(value).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: TIME_ZONE });

/** Profil complété par le praticien : en attente de validation. */
const doctorPendingEmail = (doctor, { resubmitted = false } = {}) => {
	const { html, text } = renderEmail({
		title: resubmitted ? 'Votre profil est de nouveau en cours d’examen' : 'Votre profil est en cours de validation',
		paragraphs: [
			hello(doctor),
			resubmitted
				? 'Merci d’avoir mis à jour votre profil. Notre équipe l’examine à nouveau.'
				: 'Merci, votre inscription est complète. Notre équipe examine maintenant votre profil avant sa mise en ligne.',
			'Vous recevrez un email dès que la vérification sera terminée, en général sous quelques jours ouvrés.',
		],
		details: [
			['Statut', 'En attente de validation'],
			['Charte éthique', doctor.charterAcceptedAt ? `Signée le ${dateLong(doctor.charterAcceptedAt)}` : null],
		],
		link: '/onboarding',
		cta: 'Voir mon profil',
		notes: [
			'Nous vérifions votre identité, la présentation de votre activité ainsi que vos diplômes et qualifications.',
			'Vous pouvez encore modifier votre profil pendant la vérification : ajoutez une photo, vos horaires et vos diplômes.',
			'Une question ? Écrivez-nous depuis la page Aide et support de votre espace.',
		],
	});
	return {
		subject: resubmitted ? 'Votre profil Meyana est de nouveau en cours d’examen' : 'Inscription reçue : votre profil est en cours de validation',
		html,
		text,
	};
};

/** Profil refusé par l'équipe, avec le motif. */
const doctorRejectedEmail = (doctor) => {
	const { html, text } = renderEmail({
		title: 'Votre profil n’a pas pu être validé',
		paragraphs: [
			hello(doctor),
			'Merci pour votre inscription sur Meyana. Après examen, nous ne pouvons pas mettre votre profil en ligne en l’état.',
		],
		details: [['Motif', doctor.rejectionReason?.trim() || 'Non précisé']],
		link: '/onboarding',
		cta: 'Modifier mon profil',
		notes: [
			'Vous pouvez corriger votre profil à tout moment : il repart automatiquement en vérification dès que vous l’enregistrez.',
			'Une question sur ce motif ? Écrivez-nous depuis la page Aide et support de votre espace, nous vous répondrons.',
		],
	});
	return { subject: 'Votre profil Meyana n’a pas pu être validé', html, text };
};

/** Profil validé : en ligne. */
const doctorValidatedEmail = (doctor) => {
	const { html, text } = renderEmail({
		title: 'Votre profil est en ligne',
		paragraphs: [
			hello(doctor),
			'Bonne nouvelle : votre profil a été vérifié et il est maintenant visible sur Meyana. Les patients peuvent vous trouver et prendre rendez-vous avec vous.',
		],
		details: [
			['Statut', 'En ligne · profil vérifié'],
			['Votre page', doctor.UUID ? 'Lien ci-dessous, à partager avec vos patients' : null],
		],
		link: doctor.UUID ? `/doctor/${doctor.UUID}` : '/dashboard',
		cta: 'Voir mon profil public',
		notes: [
			'Vérifiez vos horaires et vos lieux de consultation : ce sont eux qui ouvrent vos créneaux.',
			'Une photo et une présentation soignée aident les patients à vous choisir.',
			'Partagez le lien de votre profil : vos patients peuvent réserver en ligne, 24 h/24.',
			'Écrivez un article sur le blog pour présenter votre pratique : il apparaît aussi sur votre profil.',
		],
	});
	return { subject: 'Votre profil Meyana est en ligne', html, text };
};

/** Bienvenue au patient qui vient de créer son compte. */
const patientWelcomeEmail = (user) => {
	const { html, text } = renderEmail({
		title: 'Bienvenue sur Meyana',
		paragraphs: [
			hello(user),
			'Votre compte est créé. Meyana vous permet de trouver des praticiens vérifiés de la santé et du bien-être, et de prendre rendez-vous en ligne, en cabinet ou en visio.',
			'Pour réserver votre première consultation, il vous reste une étape : compléter votre profil.',
		],
		details: [
			['1. Votre profil', 'Coordonnées et carnet de santé, partagés uniquement avec les praticiens que vous consultez'],
			['2. Un praticien', 'Cherchez par spécialité, par ville ou par nom'],
			['3. Votre rendez-vous', 'Réservez un créneau, puis retrouvez-le dans votre espace avec vos documents'],
		],
		link: '/dashboard/update-account',
		cta: 'Compléter mon profil',
		notes: [
			'Tous les praticiens présents sur Meyana ont été vérifiés et ont signé notre charte éthique.',
			'Une question ? Écrivez-nous depuis la page Aide et support de votre espace.',
		],
	});
	return { subject: 'Bienvenue sur Meyana', html, text };
};

module.exports = { doctorPendingEmail, doctorRejectedEmail, doctorValidatedEmail, patientWelcomeEmail };
