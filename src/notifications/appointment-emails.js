'use strict';

/**
 * Emails détaillés des rendez-vous :
 * - confirmation au patient ;
 * - nouveau rendez-vous au praticien.
 * Chacun joint un fichier calendrier (.ics). Aucune donnée de santé (ni motif détaillé,
 * ni note) : elles restent sur la page du rendez-vous, accessible après connexion.
 */

const { renderEmail, frontUrl } = require('./email');
const { TIME_ZONE, fullName } = require('./helpers');

const DEFAULT_DURATION = 30;

const dateLong = (iso) =>
	new Date(iso).toLocaleDateString('fr-FR', {
		weekday: 'long',
		day: 'numeric',
		month: 'long',
		year: 'numeric',
		timeZone: TIME_ZONE,
	});

const timeOf = (iso) =>
	new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: TIME_ZONE });

const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** « 45 min », « 1 h », « 1 h 30 » */
const durationLabel = (minutes) => {
	const m = Number(minutes) || DEFAULT_DURATION;
	if (m < 60) return `${m} min`;
	const h = Math.floor(m / 60);
	const rest = m % 60;
	return rest ? `${h} h ${String(rest).padStart(2, '0')}` : `${h} h`;
};

/** Métier affiché, au féminin si le profil l'indique (« Naturopathe », « Diététicienne ») */
const professionOf = (a) => {
	const c = a.category;
	if (!c) return '';
	return (a.doctor?.gender === 'woman' && c.professionNameFeminine) || c.professionName || c.name || '';
};

const addressOf = (a) => {
	const ad = a.appointmentAddress || {};
	return [ad.line, [ad.postcode, ad.city].filter(Boolean).join(' ')].filter(Boolean).join('\n');
};

// « 65 € », « 45,50 € »
const euros = (value) => {
	const n = Number(value);
	const digits = Number.isInteger(n) ? 0 : 2;
	return `${n.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits })} €`;
};

/**
 * Tarif de la consultation : prix du motif choisi à la réservation (le rendez-vous
 * enregistre le titre du motif). À défaut de prix sur ce motif, fourchette du praticien.
 * → [libellé, valeur] ou null
 */
const priceRowOf = (a) => {
	if (a.paymentStatus === 'paid' && a.price) return ['Payé en ligne', euros(a.price)];
	const reason = (a.doctor?.reason || []).find((r) => r.title === a.reason);
	if (reason?.price != null && reason.price !== '') return ['Tarif', euros(reason.price)];

	const { minimum, maximum } = a.doctor?.priceRange || {};
	if (minimum && maximum && Number(minimum) !== Number(maximum))
		return ['Tarif indicatif', `Entre ${euros(minimum)} et ${euros(maximum)}`];
	if (minimum || maximum) return ['Tarif indicatif', euros(minimum || maximum)];
	return null;
};

/** Personne consultée quand le rendez-vous est pris pour un proche */
const relativeOf = (a) => {
	const s = a.someoneElse;
	if (!s?.firstname) return null;
	const name = [s.firstname, s.lastname].filter(Boolean).join(' ');
	return s.age ? `${name}, ${s.age} ans` : name;
};

/* ---------- Fichier calendrier (.ics) ---------- */

const icsDate = (date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const icsText = (value) =>
	String(value ?? '')
		.replace(/\\/g, '\\\\')
		.replace(/\n/g, '\\n')
		.replace(/[,;]/g, (c) => `\\${c}`);

const calendarAttachment = (a, { summary, description }) => {
	const start = new Date(a.datetime);
	const end = new Date(start.getTime() + (Number(a.duration) || DEFAULT_DURATION) * 60000);
	const url = `${frontUrl()}/appointment/${a.UUID}`;
	const lines = [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		'PRODID:-//Meyana//Rendez-vous//FR',
		'CALSCALE:GREGORIAN',
		'METHOD:PUBLISH',
		'BEGIN:VEVENT',
		`UID:${a.documentId}@meyana.fr`,
		`DTSTAMP:${icsDate(new Date())}`,
		`DTSTART:${icsDate(start)}`,
		`DTEND:${icsDate(end)}`,
		`SUMMARY:${icsText(summary)}`,
		`LOCATION:${icsText(a.isOnline ? 'Visioconférence (lien sur la page du rendez-vous)' : addressOf(a).replace(/\n/g, ', '))}`,
		`DESCRIPTION:${icsText(`${description}\n${url}`)}`,
		`URL:${url}`,
		'BEGIN:VALARM',
		'TRIGGER:-PT1H',
		'ACTION:DISPLAY',
		`DESCRIPTION:${icsText(summary)}`,
		'END:VALARM',
		'END:VEVENT',
		'END:VCALENDAR',
	];
	return {
		filename: 'rendez-vous-meyana.ics',
		content: Buffer.from(lines.join('\r\n')).toString('base64'),
		contentType: 'text/calendar; charset=utf-8',
	};
};

/* ---------- Emails ---------- */

/** Confirmation envoyée au patient qui a réservé. */
const patientBookedEmail = (a) => {
	const doctor = fullName(a.doctor) || 'votre praticien';
	const profession = professionOf(a);
	const when = `${dateLong(a.datetime)} à ${timeOf(a.datetime)}`;
	const relative = relativeOf(a);

	const { html, text } = renderEmail({
		title: 'Votre rendez-vous est confirmé',
		paragraphs: [
			a.patient?.firstname ? `Bonjour ${a.patient.firstname},` : 'Bonjour,',
			`Votre rendez-vous avec ${doctor}${profession ? `, ${profession.toLowerCase()}` : ''}, est bien enregistré${
				relative ? ` pour ${relative.split(',')[0]}` : ''
			}.`,
		],
		details: [
			['Date', capitalize(dateLong(a.datetime))],
			['Heure', `${timeOf(a.datetime)} · ${durationLabel(a.duration)}`],
			['Praticien', [doctor, profession].filter(Boolean).join('\n')],
			['Consultation', a.isOnline ? 'En visio' : 'Au cabinet'],
			['Adresse', a.isOnline ? null : addressOf(a)],
			['Pour', relative],
			priceRowOf(a),
		],
		link: `/appointment/${a.UUID}`,
		cta: 'Voir mon rendez-vous',
		secondary: a.invoiceUrl ? { url: a.invoiceUrl, label: 'Voir ma facture' } : null,
		notes: [
			a.isOnline
				? 'Le lien de la visio apparaîtra sur la page du rendez-vous : vous recevrez un email dès que votre praticien l’aura ajouté.'
				: 'Présentez-vous quelques minutes avant l’heure du rendez-vous.',
			'Vous pouvez déposer vos documents utiles (ordonnances, analyses, comptes rendus) sur la page du rendez-vous.',
			'Un empêchement ? Annulez depuis votre espace pour libérer le créneau pour un autre patient.',
			'Ajoutez ce rendez-vous à votre agenda avec le fichier joint.',
		],
	});

	return {
		subject: `Rendez-vous confirmé · ${when}`,
		html,
		text,
		attachments: [
			calendarAttachment(a, {
				summary: `Rendez-vous avec ${doctor}`,
				description: [profession, a.isOnline ? 'En visio' : 'Au cabinet'].filter(Boolean).join(' · '),
			}),
		],
	};
};

/** Nouveau rendez-vous, envoyé au praticien. */
const doctorBookedEmail = (a) => {
	const patient = fullName(a.patient) || 'Un patient';
	const relative = relativeOf(a);
	const when = `${dateLong(a.datetime)} à ${timeOf(a.datetime)}`;

	const { html, text } = renderEmail({
		title: 'Nouveau rendez-vous',
		paragraphs: [
			a.doctor?.firstname ? `Bonjour ${a.doctor.firstname},` : 'Bonjour,',
			relative
				? `${patient} vient de réserver un rendez-vous avec vous pour un proche.`
				: `${patient} vient de réserver un rendez-vous avec vous.`,
		],
		details: [
			['Date', capitalize(dateLong(a.datetime))],
			['Heure', `${timeOf(a.datetime)} · ${durationLabel(a.duration)}`],
			['Patient', relative || patient],
			['Réservé par', relative ? patient : null],
			['Consultation', a.isOnline ? 'En visio' : 'Au cabinet'],
			['Adresse', a.isOnline ? null : addressOf(a)],
		],
		link: `/appointment/${a.UUID}`,
		cta: 'Voir le rendez-vous',
		notes: [
			'Le motif, la note du patient, son carnet de santé et ses documents sont sur la page du rendez-vous.',
			a.isOnline
				? 'Ajoutez le lien de la visio sur la page du rendez-vous : le patient est prévenu automatiquement.'
				: null,
			'Un empêchement ? Annulez le rendez-vous depuis sa page : le patient est prévenu par email.',
		].filter(Boolean),
	});

	return {
		subject: `Nouveau rendez-vous · ${when}`,
		html,
		text,
		attachments: [
			calendarAttachment(a, {
				summary: `Rendez-vous Meyana · ${relative ? relative.split(',')[0] : patient}`,
				description: a.isOnline ? 'Consultation en visio' : 'Consultation au cabinet',
			}),
		],
	};
};

/** Confirmation au patient qui vient d'annuler son rendez-vous. */
const patientCancelledOwnEmail = (a) => {
	const doctor = fullName(a.doctor) || 'votre praticien';
	const profession = professionOf(a);
	const when = `${dateLong(a.datetime)} à ${timeOf(a.datetime)}`;

	const { html, text } = renderEmail({
		title: 'Votre rendez-vous est annulé',
		paragraphs: [
			a.patient?.firstname ? `Bonjour ${a.patient.firstname},` : 'Bonjour,',
			`Votre rendez-vous avec ${doctor} du ${when} est bien annulé. Nous avons informé votre praticien.`,
		],
		details: [
			['Date', capitalize(dateLong(a.datetime))],
			['Heure', timeOf(a.datetime)],
			['Praticien', [doctor, profession].filter(Boolean).join('\n')],
			['Consultation', a.isOnline ? 'En visio' : 'Au cabinet'],
			['Pour', relativeOf(a)],
		],
		link: a.doctor?.UUID ? `/doctor/${a.doctor.UUID}` : '/doctor',
		cta: 'Reprendre rendez-vous',
		notes: [
			'Annulé par erreur ? Le créneau est peut-être encore libre : reprenez rendez-vous en quelques clics.',
			'Si vous aviez ajouté ce rendez-vous à votre agenda, pensez à le retirer.',
		],
	});

	return { subject: `Annulation confirmée · ${when}`, html, text };
};

/** Confirmation au praticien qui vient d'annuler un rendez-vous. */
const doctorCancelledOwnEmail = (a) => {
	const patient = fullName(a.patient) || 'votre patient';
	const relative = relativeOf(a);
	const when = `${dateLong(a.datetime)} à ${timeOf(a.datetime)}`;

	const { html, text } = renderEmail({
		title: 'Rendez-vous annulé',
		paragraphs: [
			a.doctor?.firstname ? `Bonjour ${a.doctor.firstname},` : 'Bonjour,',
			`Votre rendez-vous avec ${relative ? relative.split(',')[0] : patient} du ${when} est bien annulé. Nous avons informé ${
				relative ? `${patient}, qui avait réservé` : 'votre patient'
			}.`,
		],
		details: [
			['Date', capitalize(dateLong(a.datetime))],
			['Heure', `${timeOf(a.datetime)} · ${durationLabel(a.duration)}`],
			['Patient', relative || patient],
			['Réservé par', relative ? patient : null],
			['Consultation', a.isOnline ? 'En visio' : 'Au cabinet'],
		],
		link: '/dashboard',
		cta: 'Voir mon agenda',
		notes: [
			'Le créneau est de nouveau proposé à la réservation.',
			'Pour proposer une autre date à ce patient, ajoutez un rendez-vous depuis votre agenda.',
			'Si vous aviez ajouté ce rendez-vous à votre agenda personnel, pensez à le retirer.',
		],
	});

	return { subject: `Annulation confirmée · ${when}`, html, text };
};

/**
 * Rappel envoyé au patient la veille (environ 24 heures avant).
 * @param {string} dayWord « demain » ou « aujourd’hui »
 */
const patientReminderEmail = (a, dayWord) => {
	const doctor = fullName(a.doctor) || 'votre praticien';
	const profession = professionOf(a);
	const time = timeOf(a.datetime);
	const relative = relativeOf(a);
	const paidOnline = a.paymentStatus === 'paid';

	const { html, text } = renderEmail({
		title: `Votre rendez-vous, ${dayWord} à ${time}`,
		paragraphs: [
			a.patient?.firstname ? `Bonjour ${a.patient.firstname},` : 'Bonjour,',
			`Petit rappel : vous avez rendez-vous ${dayWord} à ${time} avec ${doctor}${
				profession ? `, ${profession.toLowerCase()}` : ''
			}${relative ? `, pour ${relative.split(',')[0]}` : ''}.`,
		],
		details: [
			['Date', capitalize(dateLong(a.datetime))],
			['Heure', `${time} · ${durationLabel(a.duration)}`],
			['Praticien', [doctor, profession].filter(Boolean).join('\n')],
			['Consultation', a.isOnline ? 'En visio' : 'Au cabinet'],
			['Adresse', a.isOnline ? null : addressOf(a)],
			['Pour', relative],
			priceRowOf(a),
		],
		link: `/appointment/${a.UUID}`,
		cta: 'Voir mon rendez-vous',
		notes: [
			a.isOnline
				? a.visioLink
					? 'Le lien de la visio est disponible sur la page du rendez-vous.'
					: 'Le lien de la visio apparaîtra sur la page du rendez-vous : vous recevrez un email dès que votre praticien l’aura ajouté.'
				: 'Présentez-vous quelques minutes avant l’heure du rendez-vous.',
			'Pensez à déposer vos documents utiles (ordonnances, analyses, comptes rendus) sur la page du rendez-vous.',
			paidOnline
				? 'Un empêchement ? Annulez depuis votre espace. Une annulation à moins de 24 heures du rendez-vous n’est pas remboursée.'
				: 'Un empêchement ? Annulez depuis votre espace pour libérer le créneau pour un autre patient.',
		],
	});

	return { subject: `Rappel · rendez-vous ${dayWord} à ${time}`, html, text };
};

/**
 * Récapitulatif au praticien des consultations passées qu’il n’a pas encore clôturées.
 * @param {object}   params
 * @param {string}   [params.firstname]
 * @param {object[]} params.appointments  { datetime, patientName, paid }, des plus anciennes aux plus récentes
 * @param {number}   params.awaitingNet   montant net (€) des consultations payées en attente de clôture
 * @param {boolean}  params.beforePayout  relance de la veille du virement du lundi
 */
const doctorToCloseEmail = ({ firstname, appointments, awaitingNet, beforePayout }) => {
	const count = appointments.length;
	const shown = appointments.slice(0, 10);
	const label = count > 1 ? `${count} consultations à clôturer` : '1 consultation à clôturer';
	const amount = awaitingNet > 0 ? euros(awaitingNet) : null;

	const { html, text } = renderEmail({
		title: beforePayout && amount ? `${amount} en attente de clôture` : `Vous avez ${label}`,
		paragraphs: [
			firstname ? `Bonjour ${firstname},` : 'Bonjour,',
			beforePayout && amount
				? `Le virement de demain ne comprend que les consultations clôturées. Clôturez dès aujourd’hui celles qui ont bien eu lieu pour recevoir ${amount} lundi.`
				: `Clôturez chaque rendez-vous qui a bien eu lieu, depuis sa page : votre patient est invité à laisser un avis${
						amount ? ' et la consultation payée en ligne est versée le lundi suivant' : ''
				  }.`,
		],
		details: [
			...shown.map((a) => [
				capitalize(`${dateLong(a.datetime).replace(/ \d{4}$/, '')} · ${timeOf(a.datetime)}`),
				a.paid ? `${a.patientName}\nPayé en ligne` : a.patientName,
			]),
			count > shown.length ? ['Et aussi', `${count - shown.length} autre${count - shown.length > 1 ? 's' : ''}`] : null,
			amount ? ['À verser après clôture', amount] : null,
		],
		link: amount ? '/dashboard/paiements' : '/dashboard',
		cta: amount ? 'Voir mes paiements' : 'Voir mon agenda',
		notes: [
			'Pour clôturer, ouvrez le rendez-vous et choisissez « Clôturer le rendez-vous ».',
		],
	});

	return { subject: beforePayout && amount ? `Avant le virement de lundi · ${label}` : label, html, text };
};

module.exports = {
	patientBookedEmail,
	doctorBookedEmail,
	patientCancelledOwnEmail,
	doctorCancelledOwnEmail,
	patientReminderEmail,
	doctorToCloseEmail,
};
