// ============================================================
//  SHAWERIA ROLEPLAY - BOT UCP (VERSI VERCEL / WEBHOOK)
//  Endpoint ini didaftarkan sebagai "Interactions Endpoint URL"
//  di Discord Developer Portal. Discord akan POST ke sini setiap
//  ada yang memakai /daftar, /akun, atau /gantipassword - bot
//  TIDAK perlu nyala 24/7 seperti versi discord.js sebelumnya.
// ============================================================

const nacl = require('tweetnacl');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

// Wajib nonaktifkan body parser bawaan Vercel supaya kita bisa
// verifikasi signature dari RAW body (bukan yang sudah di-parse).
// (config diset di akhir file, setelah module.exports didefinisikan
// sebagai function - lihat baris paling bawah)

// Pool dibuat di luar handler supaya bisa dipakai ulang antar
// invocation "warm" (menghemat koneksi ke database).
let pool;
function getPool() {
	if (!pool) {
		pool = mysql.createPool({
			host: process.env.DB_HOST,
			port: process.env.DB_PORT,
			user: process.env.DB_USER,
			password: process.env.DB_PASS,
			database: process.env.DB_NAME,
			waitForConnections: true,
			connectionLimit: 3,
		});
	}
	return pool;
}

function getRawBody(req) {
	return new Promise((resolve, reject) => {
		let data = '';
		req.on('data', (chunk) => { data += chunk; });
		req.on('end', () => resolve(data));
		req.on('error', reject);
	});
}

function getOption(options, name) {
	const found = (options || []).find((o) => o.name === name);
	return found ? found.value : null;
}

function reply(content, ephemeral = true) {
	return {
		type: 4, // CHANNEL_MESSAGE_WITH_SOURCE
		data: {
			content,
			flags: ephemeral ? 64 : 0, // 64 = EPHEMERAL
		},
	};
}

function replyEmbed(embed, ephemeral = true) {
	return {
		type: 4,
		data: {
			embeds: [embed],
			flags: ephemeral ? 64 : 0,
		},
	};
}

module.exports = async (req, res) => {
	if (req.method !== 'POST') {
		res.status(405).send('Method not allowed');
		return;
	}

	const signature = req.headers['x-signature-ed25519'];
	const timestamp = req.headers['x-signature-timestamp'];
	const rawBody = await getRawBody(req);

	const isValid = signature && timestamp && nacl.sign.detached.verify(
		Buffer.from(timestamp + rawBody),
		Buffer.from(signature, 'hex'),
		Buffer.from(process.env.DISCORD_PUBLIC_KEY, 'hex')
	);

	if (!isValid) {
		res.status(401).send('invalid request signature');
		return;
	}

	const body = JSON.parse(rawBody);

	// Discord PING untuk verifikasi endpoint saat pertama kali disetel
	if (body.type === 1) {
		res.status(200).json({ type: 1 });
		return;
	}

	// Slash command
	if (body.type === 2) {
		const db = getPool();
		const { name, options } = body.data;
		const discordId = body.member?.user?.id || body.user?.id;

		try {
			if (name === 'daftar') {
				const namaIC = getOption(options, 'nama_ic');
				const password = getOption(options, 'password');

				if (!/^[A-Za-z]+_[A-Za-z]+$/.test(namaIC)) {
					res.status(200).json(reply('Format nama IC harus `Nama_Belakang` (contoh: John_Doe).'));
					return;
				}
				if (!password || password.length < 6) {
					res.status(200).json(reply('Password minimal 6 karakter.'));
					return;
				}

				const [existing] = await db.query(
					'SELECT id FROM users WHERE username_ic = ? OR discord_id = ? LIMIT 1',
					[namaIC, discordId]
				);
				if (existing.length > 0) {
					res.status(200).json(reply('Nama IC sudah dipakai, atau Discord kamu sudah punya akun.'));
					return;
				}

				const hash = bcrypt.hashSync(password, 10);
				await db.query(
					'INSERT INTO users (discord_id, username_ic, password_hash) VALUES (?, ?, ?)',
					[discordId, namaIC, hash]
				);

				res.status(200).json(reply(
					`Akun **${namaIC}** berhasil didaftarkan! Silakan login di server SA-MP dengan nama karakter tersebut dan password yang kamu buat barusan.`
				));
				return;
			}

			if (name === 'akun') {
				const [rows] = await db.query(
					'SELECT username_ic, level, money, bank, admin_level, warnings, banned FROM users WHERE discord_id = ? LIMIT 1',
					[discordId]
				);
				if (rows.length === 0) {
					res.status(200).json(reply('Kamu belum punya akun. Pakai `/daftar` dulu.'));
					return;
				}
				const u = rows[0];
				res.status(200).json(replyEmbed({
					title: `UCP - ${u.username_ic}`,
					color: 0x2563EB,
					fields: [
						{ name: 'Level', value: String(u.level), inline: true },
						{ name: 'Uang Tunai', value: `$${u.money}`, inline: true },
						{ name: 'Bank', value: `$${u.bank}`, inline: true },
						{ name: 'Admin Level', value: String(u.admin_level), inline: true },
						{ name: 'Warning', value: String(u.warnings), inline: true },
						{ name: 'Status', value: u.banned ? 'BANNED' : 'Aktif', inline: true },
					],
				}));
				return;
			}

			if (name === 'gantipassword') {
				const passBaru = getOption(options, 'password_baru');
				if (!passBaru || passBaru.length < 6) {
					res.status(200).json(reply('Password minimal 6 karakter.'));
					return;
				}
				const hash = bcrypt.hashSync(passBaru, 10);
				const [result] = await db.query(
					'UPDATE users SET password_hash = ? WHERE discord_id = ?',
					[hash, discordId]
				);
				if (result.affectedRows === 0) {
					res.status(200).json(reply('Kamu belum punya akun.'));
					return;
				}
				res.status(200).json(reply('Password berhasil diganti.'));
				return;
			}

			res.status(200).json(reply('Command tidak dikenali.'));
		} catch (err) {
			console.error(err);
			res.status(200).json(reply('Terjadi error internal, coba lagi nanti.'));
		}
		return;
	}

	res.status(400).send('unhandled interaction type');
};

module.exports.config = {
	api: {
		bodyParser: false,
	},
};
