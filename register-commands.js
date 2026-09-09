require('dotenv').config();
const fetch = require('node-fetch');

const commands = [
	{
		name: 'daftar',
		description: 'Daftar whitelist Shaweria Roleplay - dapat kode verifikasi buat login pertama kali',
		options: [
			{ name: 'ucp', description: 'Username UCP (3-22 karakter, huruf/angka/underscore)', type: 3, required: true },
		],
	},
	{
		name: 'akun',
		description: 'Cek status whitelist / info akun UCP kamu',
	},
	{
		name: 'gantipassword',
		description: 'Reset kode verifikasi (belum login) atau ganti password (sudah aktif)',
		options: [
			{ name: 'password_baru', description: 'Password baru (hanya untuk akun yang sudah aktif)', type: 3, required: false },
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
