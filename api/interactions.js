// ============================================================
//  SHAWERIA ROLEPLAY (base AKRP-V5) - BOT UCP (VERSI VERCEL / WEBHOOK)
//  Disesuaikan dengan skema database ASLI AKRP-V5:
//  - Tabel akun UCP: player_ucp (kolom: ID, UCP, Password, discord_id, Blocked, dst)
//  - Tabel karakter: player_characters (kolom: Char_UCP <- FK ke player_ucp.UCP,
//    Char_Name, Char_Money, Char_BankMoney, Char_Level, Char_Admin)
//
//  CATATAN: TIDAK pakai res.status()/res.json() (helper ala Next.js)
//  karena di sebagian runtime Vercel helper itu tidak tersedia dan
//  bikin function crash. Di sini pakai res.writeHead()/res.end()
//  murni, method standar Node.js http yang pasti selalu ada.
// ============================================================

const nacl = require('tweetnacl');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

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

// Password di tabel player_ucp formatnya bcrypt ($2y$12$...) - ini
// sudah cocok dipakai dengan bcryptjs di Node, cost 12.
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

function reply(content, ephemeral = true) {
	return {
		type: 4,
		data: { content, flags: ephemeral ? 64 : 0 },
	};
}

function replyEmbed(embed, ephemeral = true) {
	return {
		type: 4,
		data: { embeds: [embed], flags: ephemeral ? 64 : 0 },
	};
}

// ============================================================
//  /daftar ucp password - bikin akun UCP di tabel player_ucp
// ============================================================
async function handleDaftar(db, discordId, options) {
	const ucp = getOption(options, 'ucp');
	const password = getOption(options, 'password');

	if (!/^[A-Za-z0-9_]{3,22}$/.test(ucp || '')) {
		return reply('UCP harus 3-22 karakter, huruf/angka/underscore saja (tanpa spasi).');
	}
	if (!password || password.length < 6) {
		return reply('Password minimal 6 karakter.');
	}

	const [existing] = await db.query(
		'SELECT ID FROM player_ucp WHERE UCP = ? OR discord_id = ? LIMIT 1',
		[ucp, discordId]
	);
	if (existing.length > 0) {
		return reply('UCP itu sudah dipakai, atau Discord kamu sudah punya akun UCP.');
	}

	const hash = hashPassword(password);
	await db.query(
		'INSERT INTO player_ucp (discord_id, UCP, Password, Register_Date) VALUES (?, ?, ?, NOW())',
		[discordId, ucp, hash]
	);

	return reply(
		`Akun UCP **${ucp}** berhasil dibuat! Connect ke server SA-MP, masukkan UCP & password ini saat login, lalu buat karaktermu langsung di dalam game.`
	);
}

// ============================================================
//  /akun - lihat info UCP + daftar karakter (admin level per karakter,
//  karena di skema ini Char_Admin nempel ke karakter, bukan ke UCP)
// ============================================================
async function handleAkun(db, discordId) {
	const [ucpRows] = await db.query(
		'SELECT UCP, Blocked, Block_Reason FROM player_ucp WHERE discord_id = ? LIMIT 1',
		[discordId]
	);
	if (ucpRows.length === 0) {
		return reply('Kamu belum punya akun UCP. Pakai `/daftar` dulu.');
	}
	const ucp = ucpRows[0];

	const [chars] = await db.query(
		'SELECT Char_Name, Char_Level, Char_Money, Char_BankMoney, Char_Admin FROM player_characters WHERE Char_UCP = ? ORDER BY pID ASC',
		[ucp.UCP]
	);

	const charList = chars.length === 0
		? '_Belum ada karakter - buat langsung di in-game setelah login._'
		: chars.map(c => {
			const adminTag = c.Char_Admin > 0 ? ` [Admin Lv.${c.Char_Admin}]` : '';
			return `**${c.Char_Name}**${adminTag} - Level ${c.Char_Level}, $${c.Char_Money} tunai, $${c.Char_BankMoney} bank`;
		}).join('\n');

	return replyEmbed({
		title: `UCP - ${ucp.UCP}`,
		color: 0x2563EB,
		fields: [
			{ name: 'Status', value: ucp.Blocked ? `BANNED (${ucp.Block_Reason || 'tanpa alasan'})` : 'Aktif', inline: true },
			{ name: 'Karakter', value: charList, inline: false },
		],
	});
}

// ============================================================
//  /gantipassword - ganti password UCP
// ============================================================
async function handleGantiPassword(db, discordId, options) {
	const passBaru = getOption(options, 'password_baru');
	if (!passBaru || passBaru.length < 6) {
		return reply('Password minimal 6 karakter.');
	}
	const hash = hashPassword(passBaru);
	const [result] = await db.query(
		'UPDATE player_ucp SET Password = ? WHERE discord_id = ?',
		[hash, discordId]
	);
	if (result.affectedRows === 0) {
		return reply('Kamu belum punya akun UCP.');
	}
	return reply('Password UCP berhasil diganti.');
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

		if (body.type === 1) {
			sendJson(res, 200, { type: 1 });
			return;
		}

		if (body.type === 2) {
			const db = getPool();
			const { name, options } = body.data;
			const discordId = body.member?.user?.id || body.user?.id;

			try {
				if (name === 'daftar') {
					sendJson(res, 200, await handleDaftar(db, discordId, options));
					return;
				}
				if (name === 'akun') {
					sendJson(res, 200, await handleAkun(db, discordId));
					return;
				}
				if (name === 'gantipassword') {
					sendJson(res, 200, await handleGantiPassword(db, discordId, options));
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
		console.error('FATAL di handler interactions:', fatalErr);
		sendText(res, 500, 'internal error, cek function logs di Vercel');
	}
};

module.exports.config = {
	api: {
		bodyParser: false,
	},
};
