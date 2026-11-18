import { createHash, randomUUID } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import WebSocket from 'ws'
import {
	joinWhiteboardSchema,
	type LiveTranscriptState,
	PRESENCE_COLORS,
	type PresenterInvite,
	type PresenterView,
	presenceMessageSchema,
	type WhiteboardSession,
} from '../shared/whiteboards.ts'
import { OperationError } from './store.ts'

interface Membership extends WhiteboardSession {
	owner: string
	publicWhiteboardid: string
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
	private readonly rooms = new Map<string, Set<Membership>>()
	private readonly views = new Map<string, PresenterView>()
	private readonly requests = new Map<string, Set<string>>()
	private readonly requestTimers = new Map<string, ReturnType<typeof setTimeout>>()
	private readonly invites = new Map<string, PresenterInvite>()
	private readonly liveTranscripts = new Map<string, LiveTranscriptState>()
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

	private roomMembers(roomId: string): Set<Membership> | undefined {
		return this.rooms.get(roomId)
	}

	private addToRoom(member: Membership) {
		let room = this.rooms.get(member.whiteboardid)
		if (!room) {
			room = new Set()
			this.rooms.set(member.whiteboardid, room)
		}
		room.add(member)
	}

	private removeFromRoom(member: Membership) {
		const room = this.rooms.get(member.whiteboardid)
		if (!room) return
		room.delete(member)
		if (room.size === 0) this.rooms.delete(member.whiteboardid)
	}

	private prune() {
		for (const [token, member] of this.sessions) {
			if (!member.socket && member.expiresAt <= Date.now()) {
				this.sessions.delete(token)
				this.removeFromRoom(member)
			}
		}
	}

	private presenter(whiteboardid: string, except?: Membership) {
		const room = this.roomMembers(whiteboardid)
		if (!room) return undefined
		for (const member of room) {
			if (
				member !== except &&
				member.member.sharer &&
				(member.socket || member.reservedUntil > Date.now())
			) {
				return member
			}
		}
		return undefined
	}

	async join(body: unknown, owner: string): Promise<WhiteboardSession> {
		const parsed = joinWhiteboardSchema.safeParse(body)
		if (!parsed.success) throw new OperationError(400, 'INVALID_REQUEST', parsed.error.message)
		const input = parsed.data
		const roomId = `${owner}:${input.whiteboardid}`
		this.prune()
		const room = this.roomMembers(roomId)
		const existing = room
			? [...room].find((member) => member.owner === owner && member.clientId === input.clientId)
			: undefined
		if (existing) {
			if (existing.whiteboardid !== roomId)
				throw new OperationError(
					409,
					'SESSION_CONFLICT',
					'Join details changed; open a new session.',
				)
			if (input.sharer && this.presenter(roomId, existing)) {
				throw new OperationError(
					409,
					'PRESENTER_EXISTS',
					'This whiteboard already has a presenter.',
				)
			}
			const wasSharer = existing.member.sharer
			existing.member.username = input.username
			existing.member.sharer = input.sharer
			if (input.sharer) {
				this.requests.get(roomId)?.delete(existing.member.id)
			}
			if (wasSharer && !input.sharer) {
				this.views.delete(roomId)
				for (const voice of existing.voiceSockets) voice.close(1008, 'Presenter stepped down')
				existing.voiceSockets.clear()
			}
			existing.expiresAt = Date.now() + 10000
			existing.reservedUntil = Date.now() + 10000
			if (existing.socket) {
				this.emitPresence(existing.whiteboardid)
			}
			return this.publicSession(existing)
		}
		if (input.sharer && this.presenter(roomId)) {
			throw new OperationError(409, 'PRESENTER_EXISTS', 'This whiteboard already has a presenter.')
		}
		if (this.sessions.size >= 512) {
			throw new OperationError(503, 'ROOMS_FULL', 'Too many whiteboard sessions. Try again later.')
		}
		const count = room?.size ?? 0
		if (count >= 64) {
			throw new OperationError(409, 'ROOM_FULL', 'This whiteboard has reached its 64-person limit.')
		}
		const memberId = createHash('sha256').update(input.clientId).digest('hex')
		const member: Membership = {
			token: randomUUID(),
			whiteboardid: roomId,
			publicWhiteboardid: input.whiteboardid,
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
		this.addToRoom(member)
		return this.publicSession(member)
	}

	private publicSession(member: Membership): WhiteboardSession {
		return {
			token: member.token,
			whiteboardid: member.publicWhiteboardid,
			member: { ...member.member },
		}
	}

	resolve(req: IncomingMessage, url: URL, owner: string): Membership | undefined {
		const token = req.headers['x-mico-whiteboard'] ?? url.searchParams.get('whiteboardsession')
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

	requirePresenter(member: Membership | undefined) {
		if (
			member?.member.sharer &&
			(member.socket?.readyState === WebSocket.OPEN || member.reservedUntil > Date.now())
		)
			return
		throw new OperationError(
			403,
			'WHITEBOARD_READ_ONLY',
			'This action is not allowed in your whiteboard session.',
		)
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
					socket.close(1008, 'Only the presenter can publish a view')
					return
				}
				if (message.type === 'cursor') {
					if (Date.now() - member.lastCursorAt < 15) return
					member.lastCursorAt = Date.now()
					member.member.cursor = message.point
					this.emit(member.whiteboardid, { ...message, memberId: member.member.id })
				} else if (message.type === 'presenter-view') {
					if (Date.now() - member.lastViewAt < 15) return
					member.lastViewAt = Date.now()
					this.views.set(member.whiteboardid, message.viewport)
					this.emit(member.whiteboardid, message)
				} else if (message.type === 'request-presenter') {
					if (member.member.sharer) return
					if (!message.requested) {
						this.requests.get(member.whiteboardid)?.delete(member.member.id)
						if (!this.requests.get(member.whiteboardid)?.size) {
							this.clearRequestTimer(member.whiteboardid)
						}
						this.emitPresence(member.whiteboardid)
						return
					}
					if (!this.presenter(member.whiteboardid, member)) {
						member.member.sharer = true
						this.requests.get(member.whiteboardid)?.delete(member.member.id)
						this.clearRequestTimer(member.whiteboardid)
						this.emitPresence(member.whiteboardid)
						return
					}
					this.requestsFor(member.whiteboardid).add(member.member.id)
					this.scheduleAutoApprove(member.whiteboardid)
					this.emitPresence(member.whiteboardid)
				} else if (message.type === 'transfer-presenter') {
					if (!member.member.sharer) {
						socket.close(1008, 'Only the presenter can transfer presenter role')
						return
					}
					const target = this.findOnlineTarget(member, message.targetMemberId)
					if (!target) return
					this.commitTransfer(member, target)
				} else if (message.type === 'decline-presenter') {
					if (!member.member.sharer) {
						socket.close(1008, 'Only the presenter can decline presenter requests')
						return
					}
					this.requests.get(member.whiteboardid)?.delete(message.targetMemberId)
					if (!this.requests.get(member.whiteboardid)?.size) {
						this.clearRequestTimer(member.whiteboardid)
					}
					this.emitPresence(member.whiteboardid)
				} else if (message.type === 'invite-presenter') {
					if (!member.member.sharer) {
						socket.close(1008, 'Only the presenter can invite another presenter')
						return
					}
					const target = this.findOnlineTarget(member, message.targetMemberId)
					if (!target) return
					this.invites.set(member.whiteboardid, {
						targetMemberId: target.member.id,
						fromMemberId: member.member.id,
					})
					this.emitPresence(member.whiteboardid)
				} else if (message.type === 'respond-presenter-invite') {
					const invite = this.invites.get(member.whiteboardid)
					if (!invite || invite.targetMemberId !== member.member.id) return
					this.invites.delete(member.whiteboardid)
					if (!message.accept) {
						this.emitPresence(member.whiteboardid)
						return
					}
					const currentPresenter = this.presenter(member.whiteboardid, member)
					if (!currentPresenter || currentPresenter.member.id !== invite.fromMemberId) {
						this.emitPresence(member.whiteboardid)
						return
					}
					this.commitTransfer(currentPresenter, member)
				} else if (message.type === 'live-transcript') {
					if (!member.member.sharer) return
					const previous = this.liveTranscripts.get(member.whiteboardid)
					const startedAt = message.active
						? previous?.active && previous.startedAt
							? previous.startedAt
							: Date.now()
						: undefined
					const nextState: LiveTranscriptState = {
						memberId: member.member.id,
						text: message.text,
						active: message.active,
						...(startedAt !== undefined ? { startedAt } : {}),
					}
					if (!message.active && !message.text) {
						this.liveTranscripts.delete(member.whiteboardid)
					} else {
						this.liveTranscripts.set(member.whiteboardid, nextState)
					}
					this.emit(member.whiteboardid, {
						type: 'live-transcript',
						...nextState,
					})
				} else if (message.type === 'selection') {
					const previous = member.member.selectedIds ?? []
					const next = message.selectedIds
					if (
						previous.length === next.length &&
						previous.every((id, index) => id === next[index])
					) {
						return
					}
					member.member.selectedIds = [...next]
					this.emit(member.whiteboardid, {
						type: 'selection',
						memberId: member.member.id,
						selectedIds: member.member.selectedIds,
					})
				}
			} catch {
				socket.close(1008, 'Invalid presence message')
			}
		})
		this.emitPresence(member.whiteboardid)
	}

	private findOnlineTarget(member: Membership, targetMemberId: string): Membership | undefined {
		const room = this.roomMembers(member.whiteboardid)
		if (!room) return undefined
		for (const candidate of room) {
			if (
				candidate !== member &&
				candidate.socket?.readyState === WebSocket.OPEN &&
				candidate.member.id === targetMemberId
			) {
				return candidate
			}
		}
		return undefined
	}

	private commitTransfer(from: Membership, to: Membership) {
		from.member.sharer = false
		for (const voice of from.voiceSockets) voice.close(1008, 'Presenter role transferred')
		from.voiceSockets.clear()
		to.member.sharer = true
		this.views.delete(from.whiteboardid)
		this.invites.delete(from.whiteboardid)
		this.liveTranscripts.delete(from.whiteboardid)
		const requests = this.requests.get(from.whiteboardid)
		requests?.delete(to.member.id)
		requests?.delete(from.member.id)
		if (!requests?.size) this.clearRequestTimer(from.whiteboardid)
		this.emitPresence(from.whiteboardid)
	}

	private clearRequestTimer(whiteboardid: string) {
		const timer = this.requestTimers.get(whiteboardid)
		if (timer) {
			clearTimeout(timer)
			this.requestTimers.delete(whiteboardid)
		}
	}

	private scheduleAutoApprove(whiteboardid: string) {
		this.clearRequestTimer(whiteboardid)
		const timer = setTimeout(() => {
			this.requestTimers.delete(whiteboardid)
			const requests = this.requests.get(whiteboardid)
			if (!requests || requests.size === 0) return
			let target: Membership | undefined
			const room = this.roomMembers(whiteboardid)
			if (room) {
				for (const requesterId of requests) {
					for (const candidate of room) {
						if (
							candidate.socket?.readyState === WebSocket.OPEN &&
							candidate.member.id === requesterId
						) {
							target = candidate
							break
						}
					}
					if (target) break
				}
			}
			if (!target) {
				this.emitPresence(whiteboardid)
				return
			}
			const currentPresenter = this.presenter(whiteboardid, target)
			if (currentPresenter) {
				this.commitTransfer(currentPresenter, target)
			} else {
				target.member.sharer = true
				requests.delete(target.member.id)
				this.emitPresence(whiteboardid)
			}
		}, 20_000)
		timer.unref()
		this.requestTimers.set(whiteboardid, timer)
	}

	private requestsFor(whiteboardid: string): Set<string> {
		let set = this.requests.get(whiteboardid)
		if (!set) {
			set = new Set()
			this.requests.set(whiteboardid, set)
		}
		return set
	}

	private findNextPresenter(leaving: Membership): Membership | undefined {
		const room = this.roomMembers(leaving.whiteboardid)
		if (!room) return undefined
		const online: Membership[] = []
		for (const candidate of room) {
			if (
				candidate !== leaving &&
				candidate.socket?.readyState === WebSocket.OPEN &&
				!candidate.member.sharer
			) {
				online.push(candidate)
			}
		}
		if (online.length === 0) return undefined
		const requests = this.requests.get(leaving.whiteboardid)
		if (requests) {
			for (const requesterId of requests) {
				const match = online.find((candidate) => candidate.member.id === requesterId)
				if (match) return match
			}
		}
		return online[0]
	}

	private disconnect(member: Membership) {
		member.socket = undefined
		for (const voice of member.voiceSockets) voice.close(1008, 'Presenter disconnected')
		member.voiceSockets.clear()
		member.member.cursor = null
		member.member.selectedIds = []
		this.requests.get(member.whiteboardid)?.delete(member.member.id)
		if (member.member.sharer) {
			this.views.delete(member.whiteboardid)
			this.invites.delete(member.whiteboardid)
			this.liveTranscripts.delete(member.whiteboardid)
			const nextPresenter = this.findNextPresenter(member)
			if (nextPresenter) {
				member.member.sharer = false
				nextPresenter.member.sharer = true
				this.requests.get(member.whiteboardid)?.delete(nextPresenter.member.id)
			}
		}
		member.reservedUntil = 0
		member.expiresAt = Date.now() + 60000
		this.emitPresence(member.whiteboardid)
	}

	private emitPresence(whiteboardid: string) {
		const room = this.roomMembers(whiteboardid)
		const members = room
			? [...room].filter((member) => member.socket).map((member) => ({ ...member.member }))
			: []
		const presenter = members.find((member) => member.sharer)
		const eligible = new Set(members.filter((member) => !member.sharer).map((member) => member.id))
		const requests = this.requests.get(whiteboardid)
		const requesterIds: string[] = []
		if (requests) {
			for (const id of requests) {
				if (eligible.has(id)) requesterIds.push(id)
				else requests.delete(id)
			}
			if (requests.size === 0) this.requests.delete(whiteboardid)
		}
		let presenterInvite = this.invites.get(whiteboardid) ?? null
		if (
			presenterInvite &&
			(!presenter ||
				presenterInvite.fromMemberId !== presenter.id ||
				!eligible.has(presenterInvite.targetMemberId))
		) {
			this.invites.delete(whiteboardid)
			presenterInvite = null
		}
		this.emit(whiteboardid, {
			type: 'presence',
			members,
			presenterId: presenter?.id ?? null,
			viewport: presenter ? (this.views.get(whiteboardid) ?? null) : null,
			requesterIds,
			presenterInvite,
			liveTranscript: presenter ? (this.liveTranscripts.get(whiteboardid) ?? null) : null,
		})
	}

	emit(whiteboardid: string, event: unknown) {
		const room = this.roomMembers(whiteboardid)
		if (!room || room.size === 0) return
		let payload: string | undefined
		for (const member of room) {
			if (member.socket?.readyState !== WebSocket.OPEN) continue
			payload ??= JSON.stringify(event)
			member.socket.send(payload)
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
		this.rooms.clear()
		this.views.clear()
		this.requests.clear()
		for (const timer of this.requestTimers.values()) clearTimeout(timer)
		this.requestTimers.clear()
		this.invites.clear()
		this.liveTranscripts.clear()
	}
}
