// ============================================================
//  SHAWERIA ROLEPLAY - BOT UCP (VERSI VERCEL / WEBHOOK)
//  Alur: /daftar bikin entri di tabel WHITELISTS (bukan langsung ke
//  player_ucp) dengan kode verifikasi 5 digit acak. Kode itu dipakai
//  sebagai "password" pertama kali login di SA-MP - dari situ baru
//  gamemode yang bikinkan akun asli di player_ucp.
//
//  Tabel whitelists: id, ucp, nickadmin, adutyname, verify, recovery,
//  date, discordid, allowed
//
//  Tabel player_ucp (dipakai setelah verifikasi selesai): ID, UCP,
//  Password, discord_id, Blocked, Block_Reason, dst.
//
//  Tabel player_characters: Char_UCP (FK ke player_ucp.UCP), Char_Name,
//  Char_Money, Char_BankMoney, Char_Level, Char_Admin.
// ============================================================

const nacl = require('tweetnacl');
const mysql = require('mysql2/promise');

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

// Kode verifikasi 5 digit, selalu tanpa leading zero (10000-99999)
function generateVerifyCode() {
	return Math.floor(Math.random() * 90000) + 10000;
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
	return { type: 4, data: { content, flags: ephemeral ? 64 : 0 } };
}

function replyEmbed(embed, ephemeral = true) {
	return { type: 4, data: { embeds: [embed], flags: ephemeral ? 64 : 0 } };
}

// ============================================================
//  /daftar ucp - bikin entri whitelist (BUKAN player_ucp langsung)
// ============================================================
async function handleDaftar(db, discordId, options) {
	const ucp = getOption(options, 'ucp');

	if (!/^[A-Za-z0-9_]{3,22}$/.test(ucp || '')) {
		return reply('UCP harus 3-22 karakter, huruf/angka/underscore saja (tanpa spasi).');
	}

	// cek belum dipakai di whitelists MAUPUN player_ucp (yang sudah lolos verifikasi)
	const [existingWL] = await db.query(
		'SELECT id FROM whitelists WHERE ucp = ? OR discordid = ? LIMIT 1',
		[ucp, discordId]
	);
	if (existingWL.length > 0) {
		return reply('UCP itu sudah terdaftar di whitelist, atau Discord kamu sudah pernah daftar.');
	}
	const [existingUCP] = await db.query(
		'SELECT ID FROM player_ucp WHERE UCP = ? OR discord_id = ? LIMIT 1',
		[ucp, discordId]
	);
	if (existingUCP.length > 0) {
		return reply('UCP itu sudah aktif dipakai, atau Discord kamu sudah punya akun.');
	}

	const code = generateVerifyCode();
	await db.query(
		'INSERT INTO whitelists (ucp, nickadmin, adutyname, verify, recovery, date, discordid, allowed) VALUES (?, ?, ?, ?, -1, NOW(), ?, 0)',
		[ucp, 'Bot', 'Bot', code, discordId]
	);

	return reply(
		`Kamu berhasil di-whitelist dengan UCP **${ucp}**!\n\nConnect ke server SA-MP, masukkan UCP **${ucp}**, lalu masukkan kode ini sebagai password pertama kali login:\n\n**${code}**\n\n(Simpan kode ini baik-baik sampai kamu selesai login pertama kali)`
	);
}

// ============================================================
//  /akun - cek status: masih di whitelist (belum verifikasi) atau
//  sudah jadi akun aktif di player_ucp
// ============================================================
async function handleAkun(db, discordId) {
	const [ucpRows] = await db.query(
		'SELECT UCP, Blocked, Block_Reason FROM player_ucp WHERE discord_id = ? LIMIT 1',
		[discordId]
	);

	if (ucpRows.length > 0) {
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
			title: `UCP - ${ucp.UCP} (Aktif)`,
			color: 0x2563EB,
			fields: [
				{ name: 'Status', value: ucp.Blocked ? `BANNED (${ucp.Block_Reason || 'tanpa alasan'})` : 'Aktif', inline: true },
				{ name: 'Karakter', value: charList, inline: false },
			],
		});
	}

	const [wlRows] = await db.query(
		'SELECT ucp, verify, allowed FROM whitelists WHERE discordid = ? LIMIT 1',
		[discordId]
	);
	if (wlRows.length > 0) {
		const wl = wlRows[0];
		return reply(
			`UCP **${wl.ucp}** kamu masih berstatus whitelist (belum login pertama kali di server).\nKode verifikasi: **${wl.verify}**\n\nConnect ke server dan login pakai kode itu untuk mengaktifkan akun.`
		);
	}

	return reply('Kamu belum punya akun UCP. Pakai `/daftar` dulu.');
}

// ============================================================
//  /gantipassword - reset kode. Kalau masih whitelist, generate kode
//  verifikasi baru. Kalau sudah akun aktif, ganti Password di player_ucp
//  (catatan: kalau ternyata cara set password aktif beda, kabari saya).
// ============================================================
async function handleGantiPassword(db, discordId, options) {
	const passBaru = getOption(options, 'password_baru');

	const [ucpRows] = await db.query('SELECT UCP FROM player_ucp WHERE discord_id = ? LIMIT 1', [discordId]);
	if (ucpRows.length > 0) {
		if (!passBaru || passBaru.length < 6) {
			return reply('Password minimal 6 karakter.');
		}
		const bcrypt = require('bcryptjs');
		const hash = bcrypt.hashSync(passBaru, 12);
		await db.query('UPDATE player_ucp SET Password = ? WHERE discord_id = ?', [hash, discordId]);
		return reply('Password akun UCP aktif kamu berhasil diganti.');
	}

	const [wlRows] = await db.query('SELECT id FROM whitelists WHERE discordid = ? LIMIT 1', [discordId]);
	if (wlRows.length > 0) {
		const newCode = generateVerifyCode();
		await db.query('UPDATE whitelists SET verify = ? WHERE discordid = ?', [newCode, discordId]);
		return reply(`Kode verifikasi baru kamu: **${newCode}**. Pakai ini untuk login pertama kali di server.`);
	}

	return reply('Kamu belum punya akun UCP atau whitelist. Pakai `/daftar` dulu.');
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
