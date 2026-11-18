import type { AuthMode } from '../../../shared/runtime.ts'
import type { WhiteboardMember } from '../../../shared/whiteboards.ts'
import { getMessages, type I18nMessages } from '../../i18n/index.ts'

export interface MeetingParticipant {
	readonly id: string
	readonly name: string
	readonly initial: string
	readonly hexColor: string
	readonly isSelf: boolean
}

export interface MeetingViewModel {
	readonly title: string
	readonly detail: string
	readonly elapsed: string
	readonly participants: readonly MeetingParticipant[]
	readonly overflowCount: number
	readonly liveDot: boolean
	readonly controlsEnabled: boolean
}

export interface MeetingStateInput {
	readonly presenceActive: boolean
	readonly authMode: AuthMode
	readonly canvasName: string
	readonly members: readonly WhiteboardMember[]
	readonly presenterId: string | null
	readonly selfId: string | null
	readonly selfName?: string
	readonly elapsedSeconds?: number
	readonly messages?: I18nMessages
}

const MAX_VISIBLE_AVATARS = 5

function formatClock(totalSeconds: number): string {
	const safe = Math.max(0, Math.floor(totalSeconds))
	const minutes = Math.floor(safe / 60)
	const seconds = safe % 60
	return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function initialFor(name: string): string {
	const trimmed = name.trim()
	if (!trimmed) return '?'
	const first = Array.from(trimmed)[0]
	return first ? first.toUpperCase() : '?'
}

export function buildMeetingViewModel(input: MeetingStateInput): MeetingViewModel {
	const messages = input.messages ?? getMessages('en')
	const title = input.canvasName.trim() || messages.meeting.localTitle

	if (!input.presenceActive) {
		const selfName = input.selfName?.trim() || messages.common.you
		return {
			title,
			detail:
				input.authMode === 'entra' ? messages.meeting.entraDetail : messages.meeting.localDetail,
			elapsed: formatClock(input.elapsedSeconds ?? 0),
			participants: [
				{
					id: 'self',
					name: selfName,
					initial: initialFor(selfName),
					hexColor: '#00a2e1',
					isSelf: true,
				},
			],
			overflowCount: 0,
			liveDot: false,
			controlsEnabled: false,
		}
	}

	const presenter = input.members.find((member) => member.id === input.presenterId || member.sharer)
	const onlineCount = Math.max(1, input.members.length)
	const detail = !presenter
		? messages.meeting.demoNoPresenter
		: presenter.id === input.selfId
			? messages.meeting.demoYouPresenting(onlineCount)
			: messages.meeting.demoPresenting(onlineCount, presenter.username)

	const ordered = [...input.members].sort((a, b) => {
		if (a.id === input.selfId) return -1
		if (b.id === input.selfId) return 1
		if (a.sharer !== b.sharer) return a.sharer ? -1 : 1
		return 0
	})
	const visible = ordered.slice(0, MAX_VISIBLE_AVATARS)
	const participants: MeetingParticipant[] =
		visible.length > 0
			? visible.map((member) => ({
					id: member.id,
					name: member.username,
					initial: initialFor(member.username),
					hexColor: member.color,
					isSelf: member.id === input.selfId,
				}))
			: [
					{
						id: 'self',
						name: input.selfName?.trim() || messages.common.you,
						initial: initialFor(input.selfName?.trim() || messages.common.you),
						hexColor: '#00a2e1',
						isSelf: true,
					},
				]

	return {
		title,
		detail,
		elapsed: formatClock(input.elapsedSeconds ?? 0),
		participants,
		overflowCount: Math.max(0, ordered.length - MAX_VISIBLE_AVATARS),
		liveDot: input.members.length > 0,
		controlsEnabled: false,
	}
}

export function meetingPreview(): MeetingViewModel {
	return buildMeetingViewModel({
		presenceActive: false,
		authMode: 'none',
		canvasName: '',
		members: [],
		presenterId: null,
		selfId: null,
	})
}
