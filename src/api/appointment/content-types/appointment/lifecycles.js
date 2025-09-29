module.exports = {
	async afterCreate(event) {
		const { result } = event;

		try {
			await strapi.plugins["email"].services.email.send({
				to: "krimobadworker@gmail.com",
				from: "karim@badwork.fr",
				subject: "You have a new appointment",
				text: `New appointment UUID : ${result.UUID}`,
			});
		} catch (error) {
			console.log("error email send :", error);
		}
	},
};
