import { z } from 'zod'
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
])

export const joinWhiteboardSchema = z
	.object({
		whiteboardid: z.string().min(1).max(80),
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
}

export interface WhiteboardSession {
	token: string
	whiteboardid: string
	member: WhiteboardMember
}

export type PresenceEvent =
	| {
			type: 'presence'
			members: WhiteboardMember[]
			presenterId: string | null
			viewport: PresenterView | null
	  }
	| { type: 'cursor'; memberId: string; point: Point | null }
	| { type: 'presenter-view'; viewport: PresenterView }

export const PRESENCE_COLORS = ['#6844bd', '#006f91', '#ad353d', '#287447', '#925500', '#9c3481']
