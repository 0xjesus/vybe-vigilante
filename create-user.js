import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

/**
 * Script to create an admin user in the database
 *
 * Usage:
 * node create-admin-user.js
 */

const prisma = new PrismaClient();

// Admin user configuration - password will be hashed before storing
const ADMIN_CONFIG = {
	email: 'admin@vybe.com',
	username: 'admin@vybe.com',
	plainPassword: 'Admin123!', // NEVER stored in database
	firstname: 'Admin',
	lastname: 'User',
	nicename: 'Admin User',
	type: 'Admin',
	status: 'Active',
	language: 'en',
	metas: {
		roles: [ 'admin', 'developer' ],
		permissions: [ 'all' ],
		createdBy: 'setup-script',
	},
};

/**
 * Hash a password using bcrypt
 * @param {string} password - The plain text password
 * @returns {Promise<string>} - The hashed password
 */
async function hashPassword(password) {
	const saltRounds = 10;
	return await bcrypt.hash(password, saltRounds);
}

/**
 * Create the admin user in the database
 */
async function createAdminUser() {
	try {
		console.log('🚀 Starting admin user creation process...');

		// Check if user already exists
		const existingUser = await prisma.user.findFirst({
			where: {
				OR: [
					{ username: ADMIN_CONFIG.username },
					{ email: ADMIN_CONFIG.email },
				],
			},
		});

		if(existingUser) {
			console.log('⚠️ Admin user already exists:');
			console.log(`  Username: ${ existingUser.username }`);
			console.log(`  Email: ${ existingUser.email }`);
			console.log(`  Created: ${ existingUser.created }`);

			// Ask if the user wants to update the existing user
			if(process.env.FORCE_UPDATE !== 'true') {
				console.log('\n❌ Script aborted. To force update password, set FORCE_UPDATE=true');
				return;
			}

			console.log('\n🔄 FORCE_UPDATE is true. Updating existing user password...');

			// Hash the password
			const hashedPassword = await hashPassword(ADMIN_CONFIG.plainPassword);

			// Update only the user's password
			const updatedUser = await prisma.user.update({
				where: { id: existingUser.id },
				data: {
					password: hashedPassword,
					modified: new Date(),
				},
			});

			console.log('✅ Admin user password updated successfully:');
			console.log(`  ID: ${ updatedUser.id }`);
			console.log(`  Username: ${ updatedUser.username }`);
			return;
		}

		// User doesn't exist, create a new one with hashed password

		// Hash the password
		const hashedPassword = await hashPassword(ADMIN_CONFIG.plainPassword);

		// Prepare user data without the plain password
		const userData = {
			...ADMIN_CONFIG,
			password: hashedPassword, // Store only the hashed password
		};

		// Remove the plainPassword field which should never be stored
		delete userData.plainPassword;

		// Create the user
		const newUser = await prisma.user.create({
			data: userData,
		});

		console.log('✅ Admin user created successfully:');
		console.log(`  ID: ${ newUser.id }`);
		console.log(`  Username: ${ newUser.username }`);
		console.log(`  Email: ${ newUser.email }`);
		console.log(`  Created: ${ newUser.created }`);

	} catch(error) {
		console.error('❌ Error creating admin user:');
		console.error(error);
	} finally {
		// Close the Prisma connection
		await prisma.$disconnect();
	}
}

// Run the script
createAdminUser()
	.catch(e => {
		console.error('Unhandled error in script:');
		console.error(e);
		process.exit(1);
	});

// Run the script
createAdminUser()
	.catch(e => {
		console.error('Unhandled error in script:');
		console.error(e);
		process.exit(1);
	});
