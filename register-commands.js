// Jalankan SEKALI dari komputer lokal kamu tiap kali command berubah:
//   npm install
//   node register-commands.js
//
// Ini TIDAK jalan di Vercel - cuma script bantu one-off untuk daftarkan
// /daftar, /akun, /gantipassword ke Discord API.

require('dotenv').config();
const fetch = require('node-fetch');

const commands = [
	{
		name: 'daftar',
		description: 'Daftar akun UCP Shaweria Roleplay (karakter dibuat di in-game setelah login)',
		options: [
			{ name: 'username', description: 'Username UCP (3-24 karakter, huruf/angka/underscore)', type: 3, required: true },
			{ name: 'password', description: 'Password untuk login UCP', type: 3, required: true },
		],
	},
	{
		name: 'akun',
		description: 'Lihat info akun UCP dan daftar karaktermu',
	},
	{
		name: 'gantipassword',
		description: 'Ganti password UCP',
		options: [
			{ name: 'password_baru', description: 'Password baru', type: 3, required: true },
		],
	},
];

(async () => {
	const appId = process.env.DISCORD_APP_ID;
	const token = process.env.DISCORD_TOKEN;

	if (!appId || !token) {
		console.error('DISCORD_APP_ID dan DISCORD_TOKEN wajib diisi di .env sebelum menjalankan script ini.');
		process.exit(1);
	}

	const res = await fetch(`https://discord.com/api/v10/applications/${appId}/commands`, {
		method: 'PUT',
		headers: {
			'Authorization': `Bot ${token}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(commands),
	});

	if (!res.ok) {
		console.error('Gagal daftarkan command:', res.status, await res.text());
		process.exit(1);
	}

	console.log('Slash commands berhasil didaftarkan ke Discord.');
})();
