// ============================================================
//  SHAWERIA ROLEPLAY - BOT UCP (VERSI VERCEL / WEBHOOK)
//  Endpoint ini dIDaftarkan sebagai "Interactions Endpoint URL"
//  di Discord Developer Portal. Discord akan POST ke sini setiap
//  ada yang memakai /daftar, /akun, atau /gantipassword - bot
//  TIDAK perlu nyala 24/7 seperti versi discord.js sebelumnya.
//
//  CATATAN: sengaja TIDAK pakai res.status()/res.json() (helper
//  ala Next.js) karena di sebagian runtime Vercel helper itu tIDak
//  tersedia dan bikin function crash (TypeError: res.status is not
//  a function). Di sini pakai res.writeHead()/res.end() murni,
//  method standar Node.js http yang pasti selalu ada.
// ============================================================

const nacl = require('tweetnacl');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

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
    return bcrypt.hashSync(plain, 12);
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

// ============================================================
//  /daftar UCP password - bikin akun UCP (BUKAN karakter).
//  Karakter dibuat belakangan langsung di in-game setelah login UCP.
// ============================================================
async function handleDaftar(db, discordID, options) {
	const UCP = getOption(options, 'ucp');
	const password = getOption(options, 'password');

	if (!/^[A-Za-z0-9_]{3,24}$/.test(UCP || '')) {
		return reply('UCP UCP harus 3-24 karakter, huruf/angka/underscore saja (tanpa spasi).');
	}
	if (!password || password.length < 6) {
		return reply('Password minimal 6 karakter.');
	}

	const [existing] = await db.query(
		'SELECT ID FROM player_ucp WHERE UCP = ? OR discord_id = ? LIMIT 1',
		[UCP, discordID]
	);
	if (existing.length > 0) {
		return reply('UCP itu sudah dipakai, atau Discord kamu sudah punya akun UCP.');
	}

	const hash = hashPassword(password);
	await db.query(
    	'INSERT INTO player_ucp (discord_id, UCP, PASSWORD) VALUES (?, ?, ?)',
    	[discordID, UCP, hash]
	);

	return reply(
		`Akun UCP **${UCP}** berhasil dibuat! Connect ke server SA-MP, masukkan UCP & password ini saat login, lalu buat karaktermu langsung di dalam game.`
	);
}

// ============================================================
//  /akun - lihat info UCP + daftar karakter yang dipunya
// ============================================================
async function handleAkun(db, discordID) {
	const [ucpRows] = await db.query(
		'SELECT ID, UCP, admin_level, banned FROM player_ucp WHERE discord_id = ? LIMIT 1',
		[discordID]
	);
	if (ucpRows.length === 0) {
		return reply('Kamu belum punya akun UCP. Pakai `/daftar` dulu.');
	}
	const ucp = ucpRows[0];

	const [chars] = await db.query(
		'SELECT char_name, level, money, bank FROM characters WHERE ucp_ID = ? ORDER BY ID ASC',
		[ucp.ID]
	);

	const charList = chars.length === 0
		? '_Belum ada karakter - buat langsung di in-game setelah login._'
		: chars.map(c => `**${c.char_name}** - Level ${c.level}, $${c.money} tunai, $${c.bank} bank`).join('\n');

	return replyEmbed({
		title: `UCP - ${ucp.UCP}`,
		color: 0x2563EB,
		fields: [
			{ name: 'Admin Level', value: String(ucp.admin_level), inline: true },
			{ name: 'Status', value: ucp.banned ? 'BANNED' : 'Aktif', inline: true },
			{ name: 'Karakter', value: charList, inline: false },
		],
	});
}

// ============================================================
//  /gantipassword - ganti password UCP
// ============================================================
async function handleGantiPassword(db, discordID, options) {
	const passBaru = getOption(options, 'password_baru');
	if (!passBaru || passBaru.length < 6) {
		return reply('Password minimal 6 karakter.');
	}
	const hash = hashPassword(passBaru);
	const [result] = await db.query(
    	'UPDATE player_ucp SET PASSWORD = ? WHERE discord_id = ?',
    	[hash, discordID]
	);
	if (result.affectedRows === 0) {
		return reply('Kamu belum punya akun UCP.');
	}
	return reply('Password UCP berhasil diganti.');
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

		let isValID = false;
		try {
			isValID = Boolean(
				signature && timestamp &&
				nacl.sign.detached.verify(
					Buffer.from(timestamp + rawBody),
					Buffer.from(signature, 'hex'),
					Buffer.from(process.env.DISCORD_PUBLIC_KEY, 'hex')
				)
			);
		} catch (verifyErr) {
			console.error('Gagal verifikasi signature:', verifyErr);
			isValID = false;
		}

		if (!isValID) {
			sendText(res, 401, 'invalID request signature');
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
			const discordID = body.member?.user?.id || body.user?.id;

			try {
				if (name === 'daftar') {
					sendJson(res, 200, await handleDaftar(db, discordID, options));
					return;
				}

				if (name === 'akun') {
					sendJson(res, 200, await handleAkun(db, discordID));
					return;
				}

				if (name === 'gantipassword') {
					sendJson(res, 200, await handleGantiPassword(db, discordID, options));
					return;
				}

				sendJson(res, 200, reply('Command tIDak dikenali.'));
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
