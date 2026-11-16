import { createHash, randomUUID } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import WebSocket from 'ws'
import {
	joinWhiteboardSchema,
	PRESENCE_COLORS,
	type PresenterView,
	presenceMessageSchema,
	type WhiteboardSession,
} from '../shared/whiteboards.ts'
import { OperationError } from './store.ts'

interface Membership extends WhiteboardSession {
	owner: string
	clientId: string
	socket?: WebSocket
	voiceSockets: Set<WebSocket>
	expiresAt: number
	reservedUntil: number
	alive: boolean
	lastCursorAt: number
	lastViewAt: number
}

export class Whiteboards {
	private readonly sessions = new Map<string, Membership>()
	private readonly views = new Map<string, PresenterView>()
	private readonly timer: ReturnType<typeof setInterval>

	constructor() {
		this.timer = setInterval(() => {
			this.prune()
			for (const member of this.sessions.values()) {
				if (!member.socket) continue
				if (!member.alive) {
					member.socket.terminate()
					this.disconnect(member)
					continue
				}
				member.alive = false
				member.socket.ping()
			}
		}, 15000)
		this.timer.unref()
	}

	private prune() {
		for (const [token, member] of this.sessions) {
			if (!member.socket && member.expiresAt <= Date.now()) this.sessions.delete(token)
		}
	}

	private presenter(whiteboardid: string, except?: Membership) {
		return [...this.sessions.values()].find(
			(member) =>
				member !== except &&
				member.whiteboardid === whiteboardid &&
				member.member.sharer &&
				(member.socket || member.reservedUntil > Date.now()),
		)
	}

	join(body: unknown, owner: string): WhiteboardSession {
		const parsed = joinWhiteboardSchema.safeParse(body)
		if (!parsed.success) throw new OperationError(400, 'INVALID_REQUEST', parsed.error.message)
		const input = parsed.data
		this.prune()
		const existing = [...this.sessions.values()].find(
			(member) => member.owner === owner && member.clientId === input.clientId,
		)
		if (existing) {
			if (input.sharer && this.presenter(input.whiteboardid, existing)) {
				throw new OperationError(
					409,
					'PRESENTER_EXISTS',
					'This whiteboard already has a presenter.',
				)
			}
			const wasSharer = existing.member.sharer
			existing.member.username = input.username
			existing.member.sharer = input.sharer
			if (wasSharer && !input.sharer) {
				this.views.delete(input.whiteboardid)
			}
			existing.expiresAt = Date.now() + 10000
			existing.reservedUntil = Date.now() + 10000
			if (existing.socket) {
				this.emitPresence(existing.whiteboardid)
			}
			return this.publicSession(existing)
		}
		if (input.sharer && this.presenter(input.whiteboardid)) {
			throw new OperationError(409, 'PRESENTER_EXISTS', 'This whiteboard already has a presenter.')
		}
		if (this.sessions.size >= 512) {
			throw new OperationError(503, 'ROOMS_FULL', 'Too many whiteboard sessions. Try again later.')
		}
		const count = [...this.sessions.values()].filter(
			(member) => member.whiteboardid === input.whiteboardid,
		).length
		if (count >= 64) {
			throw new OperationError(409, 'ROOM_FULL', 'This whiteboard has reached its 64-person limit.')
		}
		const memberId = createHash('sha256').update(input.clientId).digest('hex')
		const member: Membership = {
			token: randomUUID(),
			whiteboardid: input.whiteboardid,
			member: {
				id: memberId,
				username: input.username,
				sharer: input.sharer,
				color: PRESENCE_COLORS[Number.parseInt(memberId.slice(0, 8), 16) % PRESENCE_COLORS.length],
				cursor: null,
			},
			owner,
			voiceSockets: new Set(),
			clientId: input.clientId,
			expiresAt: Date.now() + 10000,
			reservedUntil: Date.now() + 10000,
			alive: true,
			lastCursorAt: 0,
			lastViewAt: 0,
		}
		this.sessions.set(member.token, member)
		return this.publicSession(member)
	}

	private publicSession(member: Membership): WhiteboardSession {
		return { token: member.token, whiteboardid: member.whiteboardid, member: { ...member.member } }
	}

	resolve(req: IncomingMessage, url: URL, owner: string): Membership | undefined {
		const token = req.headers['x-mico-whiteboard'] ?? url.searchParams.get('whiteboardSession')
		if (token === null || token === undefined) return
		this.prune()
		const member = typeof token === 'string' ? this.sessions.get(token) : undefined
		if (!member || member.owner !== owner) {
			throw new OperationError(
				401,
				'WHITEBOARD_SESSION_EXPIRED',
				'Whiteboard session expired. Rejoin the whiteboard.',
			)
		}
		return member
	}

	attach(member: Membership, socket: WebSocket) {
		if (member.member.sharer && this.presenter(member.whiteboardid, member)) {
			socket.close(1008, 'This whiteboard already has a presenter')
			return
		}
		member.socket?.close(1000, 'Reconnected')
		member.socket = socket
		member.alive = true
		socket.on('pong', () => {
			member.alive = true
		})
		socket.on('close', () => {
			if (member.socket === socket) this.disconnect(member)
		})
		socket.on('message', (data) => {
			if (member.socket !== socket) return
			try {
				const message = presenceMessageSchema.parse(JSON.parse(data.toString()))
				if (message.type === 'presenter-view' && !member.member.sharer) {
					return
				}
				if (message.type === 'cursor') {
					if (Date.now() - member.lastCursorAt < 15) return
					member.lastCursorAt = Date.now()
					member.member.cursor = message.point
					this.emit(member.whiteboardid, { ...message, memberId: member.member.id })
				} else {
					if (Date.now() - member.lastViewAt < 15) return
					member.lastViewAt = Date.now()
					this.views.set(member.whiteboardid, message.viewport)
					this.emit(member.whiteboardid, message)
				}
			} catch {
				socket.close(1008, 'Invalid presence message')
			}
		})
		this.emitPresence(member.whiteboardid)
	}

	private disconnect(member: Membership) {
		member.socket = undefined
		for (const voice of member.voiceSockets) voice.close(1008, 'Presenter disconnected')
		member.voiceSockets.clear()
		member.member.cursor = null
		if (member.member.sharer) {
			this.views.delete(member.whiteboardid)
		}
		member.reservedUntil = 0
		member.expiresAt = Date.now() + 60000
		this.emitPresence(member.whiteboardid)
	}

	private emitPresence(whiteboardid: string) {
		const members = [...this.sessions.values()]
			.filter((member) => member.whiteboardid === whiteboardid && member.socket)
			.map((member) => ({ ...member.member }))
		const presenter = members.find((member) => member.sharer)
		this.emit(whiteboardid, {
			type: 'presence',
			members,
			presenterId: presenter?.id ?? null,
			viewport: presenter ? (this.views.get(whiteboardid) ?? null) : null,
		})
	}

	private emit(whiteboardid: string, event: unknown) {
		const payload = JSON.stringify(event)
		for (const member of this.sessions.values()) {
			if (member.whiteboardid === whiteboardid && member.socket?.readyState === WebSocket.OPEN) {
				member.socket.send(payload)
			}
		}
	}

	attachVoice(member: Membership, socket: WebSocket) {
		member.voiceSockets.add(socket)
		socket.once('close', () => member.voiceSockets.delete(socket))
	}

	close() {
		clearInterval(this.timer)
		for (const member of this.sessions.values()) {
			member.socket?.terminate()
			for (const voice of member.voiceSockets) voice.terminate()
		}
		this.sessions.clear()
		this.views.clear()
	}
}
