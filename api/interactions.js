// ============================================================
//  SHAWERIA ROLEPLAY - BOT UCP (VERSI VERCEL / WEBHOOK)
//  Endpoint ini didaftarkan sebagai "Interactions Endpoint URL"
//  di Discord Developer Portal. Discord akan POST ke sini setiap
//  ada yang memakai /daftar, /akun, atau /gantipassword - bot
//  TIDAK perlu nyala 24/7 seperti versi discord.js sebelumnya.
//
//  CATATAN: sengaja TIDAK pakai res.status()/res.json() (helper
//  ala Next.js) karena di sebagian runtime Vercel helper itu tidak
//  tersedia dan bikin function crash (TypeError: res.status is not
//  a function). Di sini pakai res.writeHead()/res.end() murni,
//  method standar Node.js http yang pasti selalu ada.
// ============================================================

const nacl = require('tweetnacl');
const mysql = require('mysql2/promise');
const crypto = require('crypto');

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

// Sama persis dengan SHA256_PassHash() bawaan SA-MP/open.mp di sisi
// Pawn: sha256(password + salt), di-uppercase-kan karena SHA256_PassHash
// mengembalikan hex huruf besar.
function hashPassword(plain) {
	const salt = crypto.randomBytes(32).toString('hex');
	const hash = crypto.createHash('sha256').update(plain + salt).digest('hex').toUpperCase();
	return { hash, salt };
}

function sendJson(res, statusCode, obj) {
	if (res.headersSent) return;
	res.writeHead(statusCode, { 'Content-Type': 'application/json' });
	res.end(JSON.stringify(obj));
}

function sendText(res, statusCode, text) {
	if (res.headersSent) return;
	res.writeHead(statusCode, { 'Content-Type': 'text/plain' });
	res.end(text);
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
	try {
		if (req.method !== 'POST') {
			sendText(res, 405, 'Method not allowed');
			return;
		}

		if (!process.env.DISCORD_PUBLIC_KEY) {
			console.error('DISCORD_PUBLIC_KEY belum di-set di environment variables Vercel.');
			sendText(res, 500, 'server misconfigured: DISCORD_PUBLIC_KEY missing');
			return;
		}

		const signature = req.headers['x-signature-ed25519'];
		const timestamp = req.headers['x-signature-timestamp'];
		const rawBody = await getRawBody(req);

		let isValid = false;
		try {
			isValid = Boolean(
				signature && timestamp &&
				nacl.sign.detached.verify(
					Buffer.from(timestamp + rawBody),
					Buffer.from(signature, 'hex'),
					Buffer.from(process.env.DISCORD_PUBLIC_KEY, 'hex')
				)
			);
		} catch (verifyErr) {
			console.error('Gagal verifikasi signature:', verifyErr);
			isValid = false;
		}

		if (!isValid) {
			sendText(res, 401, 'invalid request signature');
			return;
		}

		const body = JSON.parse(rawBody);

		// Discord PING untuk verifikasi endpoint saat pertama kali disetel
		if (body.type === 1) {
			sendJson(res, 200, { type: 1 });
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
						sendJson(res, 200, reply('Format nama IC harus `Nama_Belakang` (contoh: John_Doe).'));
						return;
					}
					if (!password || password.length < 6) {
						sendJson(res, 200, reply('Password minimal 6 karakter.'));
						return;
					}

					const [existing] = await db.query(
						'SELECT id FROM users WHERE username_ic = ? OR discord_id = ? LIMIT 1',
						[namaIC, discordId]
					);
					if (existing.length > 0) {
						sendJson(res, 200, reply('Nama IC sudah dipakai, atau Discord kamu sudah punya akun.'));
						return;
					}

					const { hash, salt } = hashPassword(password);
					await db.query(
						'INSERT INTO users (discord_id, username_ic, password_hash, password_salt) VALUES (?, ?, ?, ?)',
						[discordId, namaIC, hash, salt]
					);

					sendJson(res, 200, reply(
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
						sendJson(res, 200, reply('Kamu belum punya akun. Pakai `/daftar` dulu.'));
						return;
					}
					const u = rows[0];
					sendJson(res, 200, replyEmbed({
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
						sendJson(res, 200, reply('Password minimal 6 karakter.'));
						return;
					}
					const { hash, salt } = hashPassword(passBaru);
					const [result] = await db.query(
						'UPDATE users SET password_hash = ?, password_salt = ? WHERE discord_id = ?',
						[hash, salt, discordId]
					);
					if (result.affectedRows === 0) {
						sendJson(res, 200, reply('Kamu belum punya akun.'));
						return;
					}
					sendJson(res, 200, reply('Password berhasil diganti.'));
					return;
				}

				sendJson(res, 200, reply('Command tidak dikenali.'));
			} catch (err) {
				console.error('Error saat proses command:', err);
				sendJson(res, 200, reply('Terjadi error internal, coba lagi nanti.'));
			}
			return;
		}

		sendText(res, 400, 'unhandled interaction type');
	} catch (fatalErr) {
		// Jaring pengaman terakhir - jangan biarkan function crash mentah
		// (itu yang menyebabkan FUNCTION_INVOCATION_FAILED tanpa pesan jelas).
		console.error('FATAL di handler interactions:', fatalErr);
		sendText(res, 500, 'internal error, cek function logs di Vercel');
	}
};

// PENTING: config ini harus di-attach SETELAH module.exports berupa
// function di atas, bukan sebelumnya - kalau ditaruh sebelum baris
// "module.exports = async (req,res) => {...}", config-nya akan
// ketimpa/hilang karena module.exports diganti jadi object baru.
module.exports.config = {
	api: {
		bodyParser: false,
	},
};
