'use strict';

/** Accorde une action à un rôle users-permissions (« public », « authenticated »), une seule fois. */
const ensurePermission = async (strapi, roleType, action) => {
	const role = await strapi.query('plugin::users-permissions.role').findOne({ where: { type: roleType } });
	if (!role) return;
	const permissions = strapi.query('plugin::users-permissions.permission');
	if (!(await permissions.findOne({ where: { action, role: role.id } }))) {
		await permissions.create({ data: { action, role: role.id } });
	}
};

module.exports = { ensurePermission };
