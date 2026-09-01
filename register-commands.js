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
		description: 'Daftar akun UCP Shaweria Roleplay',
		options: [
			{ name: 'nama_ic', description: 'Nama karakter in-game, format: Nama_Belakang', type: 3, required: true },
			{ name: 'password', description: 'Password untuk login in-game', type: 3, required: true },
		],
	},
	{
		name: 'akun',
		description: 'Lihat data karakter kamu',
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
