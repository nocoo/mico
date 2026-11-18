import { z } from 'zod'
import { CANDY_COLORS, CANDY_LAYOUT } from './palette.ts'
import type { Point } from './types.ts'

const coordinate = z.number().finite().min(-1e9).max(1e9)
export const presenterViewSchema = z
	.object({
		centerX: coordinate,
		centerY: coordinate,
		zoom: z.number().min(0.05).max(3),
	})
	.strict()

export const presenceMessageSchema = z.discriminatedUnion('type', [
	z
		.object({
			type: z.literal('cursor'),
			point: z.object({ x: coordinate, y: coordinate }).strict().nullable(),
		})
		.strict(),
	z.object({ type: z.literal('presenter-view'), viewport: presenterViewSchema }).strict(),
	z.object({ type: z.literal('request-presenter'), requested: z.boolean() }).strict(),
	z
		.object({
			type: z.literal('transfer-presenter'),
			targetMemberId: z.string().min(1).max(128),
		})
		.strict(),
	z
		.object({
			type: z.literal('decline-presenter'),
			targetMemberId: z.string().min(1).max(128),
		})
		.strict(),
	z
		.object({
			type: z.literal('invite-presenter'),
			targetMemberId: z.string().min(1).max(128),
		})
		.strict(),
	z.object({ type: z.literal('respond-presenter-invite'), accept: z.boolean() }).strict(),
	z
		.object({
			type: z.literal('live-transcript'),
			text: z.string().max(240),
			active: z.boolean(),
		})
		.strict(),
	z
		.object({
			type: z.literal('selection'),
			selectedIds: z.array(z.string().min(1).max(128)).max(100),
		})
		.strict(),
])

export const joinWhiteboardSchema = z
	.object({
		whiteboardid: z.string().min(1).max(80).default('demo'),
		username: z
			.string()
			.trim()
			.min(1)
			.max(80)
			.refine(
				(value) =>
					[...value].every(
						(character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
					),
				'Name contains control characters',
			),
		sharer: z.boolean(),
		clientId: z.uuid(),
	})
	.strict()

export type WhiteboardJoin = z.infer<typeof joinWhiteboardSchema>
export type PresenterView = z.infer<typeof presenterViewSchema>
export type PresenceMessage = z.infer<typeof presenceMessageSchema>

export interface WhiteboardMember {
	id: string
	username: string
	sharer: boolean
	color: string
	cursor: Point | null
	selectedIds?: string[]
}

export interface WhiteboardSession {
	token: string
	whiteboardid: string
	member: WhiteboardMember
}

export interface PresenterInvite {
	targetMemberId: string
	fromMemberId: string
}

export interface LiveTranscriptState {
	memberId: string
	text: string
	active: boolean
	startedAt?: number
}

export type PresenceEvent =
	| {
			type: 'presence'
			members: WhiteboardMember[]
			presenterId: string | null
			viewport: PresenterView | null
			requesterIds?: string[]
			presenterInvite?: PresenterInvite | null
			liveTranscript?: LiveTranscriptState | null
	  }
	| { type: 'cursor'; memberId: string; point: Point | null }
	| { type: 'presenter-view'; viewport: PresenterView }
	| {
			type: 'live-transcript'
			memberId: string
			text: string
			active: boolean
			startedAt?: number
	  }
	| { type: 'selection'; memberId: string; selectedIds: string[] }

export const PRESENCE_COLORS = [
	CANDY_COLORS.blue,
	CANDY_LAYOUT.pinkStroke,
	CANDY_LAYOUT.greenStroke,
	CANDY_LAYOUT.yellowStroke,
	CANDY_COLORS.pink,
	CANDY_LAYOUT.blueStroke,
]
