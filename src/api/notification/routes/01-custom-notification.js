'use strict';

/**
 * Routes complémentaires des notifications.
 * Le préfixe « 01- » les charge avant le routeur principal, pour que
 * « unread-count » et « read-all » ne soient pas pris pour un :id.
 */

module.exports = {
	routes: [
		{
			method: 'GET',
			path: '/notifications/unread-count',
			handler: 'notification.unreadCount',
		},
		{
			method: 'PUT',
			path: '/notifications/read-all',
			handler: 'notification.readAll',
		},
		{
			method: 'GET',
			path: '/notifications/email-preferences',
			handler: 'notification.emailPreferences',
		},
		{
			method: 'PUT',
			path: '/notifications/email-preferences',
			handler: 'notification.updateEmailPreferences',
		},
	],
};
