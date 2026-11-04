import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import {
	closeSync,
	fstatSync,
	lstatSync,
	mkdtempSync,
	openSync,
	readdirSync,
	realpathSync,
	rmSync,
} from 'node:fs'
import { createServer as createNetServer } from 'node:net'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer as createViteServer } from 'vite'
import { createDaemon } from '../src/server/index.ts'
import viteConfig from '../vite.config.ts'

export const EVAL_DAEMON_PORT = 57063
export const EVAL_VITE_PORT = 27063

export function resolveEvalIdentity(value: string | undefined): string {
	if (!value) return randomUUID()
	if (!/^[-a-zA-Z0-9_.]{8,128}$/.test(value)) {
		throw new Error('Eval identity must contain 8-128 letters, digits, dots, underscores or hyphen')
	}
	return value
}

function isOutside(realPath: string, realRoot: string): boolean {
	return realPath !== realRoot && !realPath.startsWith(`${realRoot}${sep}`)
}

function assertNoSymlinksBelowTmp(parent: string): void {
	const rel = relative('/tmp', parent)
	if (rel === '' || rel.startsWith('..')) throw new Error('Eval database parent must be below /tmp')
	let current = '/tmp'
	for (const segment of rel.split(sep)) {
		if (!segment) continue
		current = join(current, segment)
		const stat = lstatSync(current)
		if (stat.isSymbolicLink()) throw new Error(`Eval database parent contains symlink: ${current}`)
	}
}

export function validateEvalDbPath(value: string | undefined, allowExisting = false): string {
	if (!value)
		throw new Error('Usage: node scripts/eval-server.ts <fresh-mkdtemp-directory>/board.sqlite')
	const dbPath = resolve(value)
	if (!dbPath.startsWith('/tmp/') || dbPath === '/tmp') {
		throw new Error('Eval database path must be under /tmp')
	}

	const parent = dirname(dbPath)
	if (parent === '/tmp')
		throw new Error('Eval database must be inside a caller-provided mkdtemp directory')
	assertNoSymlinksBelowTmp(parent)

	let parentStat: ReturnType<typeof lstatSync>
	try {
		parentStat = lstatSync(parent)
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			throw new Error(`Eval database directory does not exist: ${parent}`)
		}
		throw error
	}
	if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) {
		throw new Error(`Eval database parent is not a real directory: ${parent}`)
	}
	if (process.getuid && parentStat.uid !== process.getuid()) {
		throw new Error(`Eval database directory is not owned by the current user: ${parent}`)
	}
	if ((parentStat.mode & 0o077) !== 0) {
		throw new Error(`Eval database directory must be private (0700): ${parent}`)
	}
	try {
		const dbStat = lstatSync(dbPath)
		if (dbStat.isSymbolicLink()) throw new Error(`Eval database path is a symlink: ${dbPath}`)
		if (!allowExisting) throw new Error(`Eval database path already exists: ${dbPath}`)
		if (!dbStat.isFile()) throw new Error(`Eval database path is not a regular file: ${dbPath}`)
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
	}
	if (!allowExisting && readdirSync(parent).length !== 0) {
		throw new Error(`Eval database directory is not fresh: ${parent}`)
	}

	const realTmp = realpathSync('/tmp')
	const realParent = realpathSync(parent)
	if (isOutside(realParent, realTmp)) {
		throw new Error(`Eval database directory resolves outside /tmp: ${parent}`)
	}

	return dbPath
}

export function prepareEvalDbPath(value: string | undefined): string {
	const dbPath = validateEvalDbPath(value)
	const fd = openSync(dbPath, 'wx', 0o600)
	try {
		const descriptorStat = fstatSync(fd)
		const dbStat = lstatSync(dbPath)
		if (!dbStat.isFile() || dbStat.isSymbolicLink()) {
			throw new Error(`Eval database path is not a regular file: ${dbPath}`)
		}
		if (descriptorStat.dev !== dbStat.dev || descriptorStat.ino !== dbStat.ino) {
			throw new Error(`Eval database path changed during exclusive creation: ${dbPath}`)
		}
		validateEvalDbPath(dbPath, true)
	} catch (error) {
		closeSync(fd)
		throw error
	}
	closeSync(fd)
	return dbPath
}

async function assertPortAvailable(port: number): Promise<void> {
	await new Promise<void>((resolveAvailable, rejectAvailable) => {
		const probe = createNetServer()
		probe.unref()
		probe.once('error', () => {
			rejectAvailable(new Error(`Port ${port} is already in use`))
		})
		probe.listen(port, '127.0.0.1', () => {
			probe.close((error) => {
				if (error) rejectAvailable(error)
				else resolveAvailable()
			})
		})
	})
}

export async function startEvalServer(dbPathValue: string | undefined, identityValue?: string) {
	await assertPortAvailable(EVAL_DAEMON_PORT)
	await assertPortAvailable(EVAL_VITE_PORT)
	const dbPath = prepareEvalDbPath(dbPathValue)
	const identity = resolveEvalIdentity(identityValue)

	const cacheDirectory = mkdtempSync(join(realpathSync('/tmp'), 'mico-eval-vite-'))
	const daemon = createDaemon({ port: EVAL_DAEMON_PORT, dbPath })
	let vite: Awaited<ReturnType<typeof createViteServer>>
	try {
		vite = await createViteServer({
			...viteConfig,
			configFile: false,
			cacheDir: resolve(cacheDirectory, 'vite-cache'),
			plugins: [
				...(viteConfig.plugins ?? []),
				{
					name: 'eval-fixture-identity',
					transformIndexHtml() {
						return [
							{
								tag: 'meta',
								attrs: { name: 'mico-eval-identity', content: identity },
							},
						]
					},
					configureServer(server) {
						server.middlewares.use((request, response, next) => {
							const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
							if (pathname === '/__eval_identity') {
								response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
								response.end(JSON.stringify({ identity }))
								return
							}
							next()
						})
					},
				},
			],
			server: {
				...viteConfig.server,
				host: '127.0.0.1',
				port: EVAL_VITE_PORT,
				strictPort: true,
				proxy: {
					'/api': {
						target: `http://127.0.0.1:${EVAL_DAEMON_PORT}`,
						changeOrigin: true,
						ws: true,
					},
				},
			},
		})
	} catch (error) {
		daemon.close()
		rmSync(cacheDirectory, { recursive: true, force: true })
		throw error
	}

	let stopping = false
	const shutdown = async () => {
		if (stopping) return
		stopping = true
		await vite.close()
		for (const client of daemon.wss.clients) client.terminate()
		daemon.close()
		rmSync(cacheDirectory, { recursive: true, force: true })
	}

	process.on('SIGINT', () => void shutdown().then(() => process.exit(0)))
	process.on('SIGTERM', () => void shutdown().then(() => process.exit(0)))
	process.on('SIGHUP', () => void shutdown().then(() => process.exit(0)))

	try {
		daemon.server.listen(EVAL_DAEMON_PORT, '127.0.0.1')
		await once(daemon.server, 'listening')
		await vite.listen()
		console.log(`Eval daemon: http://127.0.0.1:${EVAL_DAEMON_PORT}`)
		console.log(`Eval canvas: http://127.0.0.1:${EVAL_VITE_PORT}`)
		console.log(`Eval identity: ${identity}`)
		console.log(`Eval database: ${dbPath}`)
	} catch (error) {
		await shutdown()
		throw error
	}

	return { dbPath, shutdown }
}

const entry = process.argv[1] ? resolve(process.argv[1]) : undefined
if (entry === fileURLToPath(import.meta.url)) {
	startEvalServer(process.argv[2], process.argv[3]).catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : String(error))
		process.exitCode = 1
	})
}
