// Снимает экраны приложения для промо-ролика через Edge по CDP.
// Запуск: node promo/capture.mjs (dev-сервер должен работать на :5173).
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9333;
const BASE = 'http://localhost:5173';
const OUT = new URL('./public/shots/', import.meta.url);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const edge = spawn(EDGE, [
	'--headless=new',
	`--remote-debugging-port=${PORT}`,
	`--user-data-dir=${mkdtempSync(join(tmpdir(), 'flux-promo-'))}`,
	'--no-first-run',
	'about:blank'
]);

let ws;
let id = 0;
const pending = new Map();
const send = (method, params = {}) =>
	new Promise((resolve) => {
		const msgId = ++id;
		pending.set(msgId, resolve);
		ws.send(JSON.stringify({ id: msgId, method, params }));
	});
const evaluate = (expression) =>
	send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });

try {
	let target;
	for (let i = 0; i < 40 && !target; i++) {
		await sleep(250);
		target = await fetch(`http://127.0.0.1:${PORT}/json/list`)
			.then((r) => r.json())
			.then((list) => list.find((t) => t.type === 'page'))
			.catch(() => null);
	}
	ws = new WebSocket(target.webSocketDebuggerUrl);
	await new Promise((r) => ws.addEventListener('open', r));
	ws.addEventListener('message', (e) => {
		const msg = JSON.parse(e.data);
		pending.get(msg.id)?.(msg.result);
		pending.delete(msg.id);
	});

	await send('Emulation.setDeviceMetricsOverride', {
		width: 390,
		height: 844,
		deviceScaleFactor: 3,
		mobile: true
	});

	const go = async (path) => {
		await send('Page.navigate', { url: BASE + path });
		await sleep(4500);
	};

	await go('/');
	await evaluate(
		`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Пропустить')?.click()`
	);
	await sleep(2500);
	// Сид демо-данных срабатывает после первой загрузки; перезаход даёт заполненный экран.
	await go('/');

	const shots = [
		['home', '/', 0],
		['home-food', '/', 900],
		['habits', '/habits', 0],
		['analytics', '/analytics', 0],
		['calendar', '/calendar', 0]
	];
	for (const [name, path, scroll] of shots) {
		await go(path);
		await evaluate(`scrollTo(0, ${scroll})`);
		await sleep(900);
		const { data } = await send('Page.captureScreenshot', { format: 'png' });
		writeFileSync(new URL(`${name}.png`, OUT), Buffer.from(data, 'base64'));
		console.log('saved', name);
	}
} finally {
	ws?.close();
	edge.kill();
}
